# PathPulse — demo deployment (AWS App Runner, us-east-1)
#
#   make deploy            build+push both images, sync API env from .env, roll both services
#   make deploy-api        backend only
#   make deploy-web        web only
#   make env               sync API env vars from .env (no rebuild)
#   make status            deployed image + status of both services
#   make verify            hit the live health / routing endpoints
#   make rollback-api TAG=v5
#   make rollback-web TAG=v4
#
# Flags:  ENV_FILE=.env  CHECK=0 (skip local typecheck/build/test)  TAG=<override>
#         NETWORK=mainnet  deploys the same two services on mainnet from .env.mainnet
#                          (STELLAR_MAINNET_ALLOW is never synced — set it by hand after sign-off)

SHELL       := bash
.SHELLFLAGS := -c
.DEFAULT_GOAL := help
.SILENT:

REGION   := us-east-1
ACCOUNT   = $(shell aws sts get-caller-identity --query Account --output text 2>/dev/null)
ECR       = $(ACCOUNT).dkr.ecr.$(REGION).amazonaws.com
API_ARN   = $(shell aws apprunner list-services --region $(REGION) --query "ServiceSummaryList[?ServiceName=='pathpulse-demo-api'].ServiceArn | [0]" --output text 2>/dev/null)
WEB_ARN   = $(shell aws apprunner list-services --region $(REGION) --query "ServiceSummaryList[?ServiceName=='pathpulse-demo-web'].ServiceArn | [0]" --output text 2>/dev/null)
API_URL  := https://demo-api.pathpulse.ai
WEB_URL  := https://demo.pathpulse.ai

NETWORK  ?= testnet
ifeq ($(NETWORK),mainnet)
ENV_FILE ?= .env.mainnet
else
ENV_FILE ?= .env
endif
PLATFORM ?= linux/amd64
CHECK    ?= 1

# image tag: git short sha (+ -dirty), overridable with TAG=
GIT_SHA  := $(shell git rev-parse --short=8 HEAD 2>/dev/null || echo nogit)
DIRTY    := $(shell git diff --quiet 2>/dev/null || echo -dirty)
TAG      ?= $(GIT_SHA)$(DIRTY)

# web build args are baked into the image; client id read from the live API config
NEXT_PUBLIC_API_URL          ?= https://demo-api.pathpulse.ai
NEXT_PUBLIC_STELLAR_NETWORK  ?= $(NETWORK)
NEXT_PUBLIC_GOOGLE_CLIENT_ID ?= $(shell aws apprunner describe-service --region $(REGION) --service-arn $(API_ARN) --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.GOOGLE_CLIENT_ID' --output text 2>/dev/null)

# .env keys pushed to the API service (merged onto existing, never replaces).
# Excludes env-specific keys (DATABASE_URL, SESSION_SECRET, SEP10_*, *_URL, KMS,
# SIGNER_BACKEND, STELLAR_NETWORK) and localhost-only keys (SDP_BASE_URL, REDIS_URL).
ENV_ALLOW := STELLAR_NETWORK STELLAR_MAINNET_ALLOW HORIZON_URL FRIENDBOT_URL NETWORK_PASSPHRASE SIGNER_BACKEND KMS_KEY_ID KEY_ENCRYPTION_KEY_CIPHERTEXT PARTNER_REVENUE_PUBLIC DRIVER_POOL_PUBLIC TREASURY_PUBLIC SETTLEMENT_DEPOSIT_SENDERS TREASURY_SIGNER_1_PUBLIC TREASURY_SIGNER_2_PUBLIC TREASURY_SIGNER_3_PUBLIC TREASURY_THRESHOLD_LOW TREASURY_THRESHOLD_MED TREASURY_THRESHOLD_HIGH SESSION_SECRET OPS_PASSCODE ACCOUNT_FUNDING GOOGLE_CLIENT_ID OFFRAMP_PROVIDER ROUTING_ASSETS SOROBAN_RPC_URL AQUA_ROUTER_CONTRACT ROUTING_QUOTE_TIMEOUT_MS ROUTING_SETTLEMENT_ASSET STELLARBROKER_PARTNER_KEY STELLARBROKER_API_URL CARRET_API_KEY CARRET_ACCOUNT_ID CARRET_BASE_URL CARRET_BANK_ID CARRET_WEBHOOK_SECRET CARRET_CHAIN CARRET_CRYPTO CARRET_FIAT CARRET_INDICATIVE_RATE CARRET_HTTPS_PROXY CARRET_ALLOW_TESTNET CARRET_USDC_ISSUER RAMP_API_KEY RAMP_WEBHOOK_PUBLIC_KEY RAMP_WIDGET_URL RAMP_HOST_APP_NAME OFFRAMP_CRYPTO OFFRAMP_ASSET_ID OFFRAMP_FIAT OFFRAMP_INDICATIVE_RATE SDP_API_KEY SDP_WALLET_ID SDP_ASSET_ID SDP_TENANT_NAME SDP_CONTACT_DOMAIN SDP_REGISTRATION_CONTACT_TYPE SDP_VERIFICATION_FIELD SDP_RETRY_ATTEMPTS SDP_RETRY_BASE_DELAY_MS SENTRY_DSN SENTRY_ENVIRONMENT SENTRY_RELEASE SENTRY_TRACES_SAMPLE_RATE PATHPULSE_INTERNAL_SCORER PULSEGEN_PILOT_SYNTHETIC

MAINNET_ENV_ALLOW := STELLAR_NETWORK HORIZON_URL NODE_ENV DATABASE_URL SESSION_SECRET OPS_PASSCODE OPS_OPERATORS OPS_TOTP_SECRETS GOV_PARTNERS OPS_APPROVAL_THRESHOLD GOV_PARTNER_PASSCODE SEP10_SIGNING_SECRET SEP10_HOME_DOMAIN SIGNER_BACKEND KMS_KEY_ID AWS_REGION KEY_ENCRYPTION_KEY_CIPHERTEXT ACCOUNT_FUNDING PARTNER_REVENUE_PUBLIC DRIVER_POOL_PUBLIC TREASURY_PUBLIC TREASURY_SIGNERS SDP_BASE_URL ALERT_WEBHOOK_URL SENTRY_DSN SPONSOR_MAX_ACCOUNTS_PER_HOUR SPONSOR_MAX_FEE_BUMPS_PER_HOUR SPONSOR_MIN_BALANCE_XLM OPS_ROLE_TTL_SECONDS
ifeq ($(NETWORK),mainnet)
ENV_ALLOW += $(MAINNET_ENV_ALLOW)
endif

# PulseGen syncs only when its endpoint is reachable from App Runner. A loopback
# URL is a local stub: pushing it would leave the deployed service advertising an
# endpoint it cannot reach, while scores silently fall back to delivered batches.
PULSEGEN_URL   := $(shell grep -m1 '^PULSEGEN_BASE_URL=' $(ENV_FILE) 2>/dev/null | cut -d= -f2-)
PULSEGEN_LOCAL := $(shell printf '%s' '$(PULSEGEN_URL)' | grep -Eqi '127\.0\.0\.1|localhost|\[::1\]' && echo 1)
ENV_ALLOW_EFF  := $(ENV_ALLOW)$(if $(PULSEGEN_URL),$(if $(PULSEGEN_LOCAL),, PULSEGEN_BASE_URL PULSEGEN_API_KEY))

SECRET_KEYS := DATABASE_URL SESSION_SECRET OPS_PASSCODE OPS_TOTP_SECRETS GOV_PARTNER_PASSCODE SEP10_SIGNING_SECRET KEY_ENCRYPTION_KEY_CIPHERTEXT CARRET_API_KEY CARRET_WEBHOOK_SECRET SDP_API_KEY STELLARBROKER_PARTNER_KEY RAMP_API_KEY PULSEGEN_API_KEY ALERT_WEBHOOK_URL SENTRY_DSN FIREBASE_PRIVATE_KEY APNS_PRIVATE_KEY

UPD := python3 scripts/apprunner-update.py --region $(REGION) --secret-keys '$(SECRET_KEYS)'$(if $(UNSET), --unset '$(UNSET)')

.PHONY: help check login deploy deploy-api deploy-web env status verify verify-api verify-web rollback-api rollback-web _wait-api _wait-web _pulsegen-notice _network-guard uptime-monitor

_network-guard:
	if [ -n "$$(git status --porcelain)" ]; then \
	  echo "Refusing to deploy from a working tree with uncommitted or untracked changes — commit first so the image maps to a commit."; \
	  exit 1; \
	fi; \
	if [ "$(NETWORK)" = "mainnet" ]; then \
	  git fetch -q origin main && git merge-base --is-ancestor HEAD origin/main || { echo "Mainnet deploys must be built from a commit already on origin/main."; exit 1; }; \
	fi
	live=$$(aws apprunner describe-service --region $(REGION) --service-arn '$(API_ARN)' --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.STELLAR_NETWORK' --output text 2>/dev/null); \
	if [ "$$live" = "mainnet" ] && [ "$(NETWORK)" != "mainnet" ]; then \
	  echo "The API service is on mainnet. Deploy with NETWORK=mainnet, or switch it back to testnet deliberately"; \
	  echo "with an ENV_FILE holding the testnet STELLAR_NETWORK, DATABASE_URL, SIGNER_BACKEND and distribution keys."; \
	  exit 1; \
	fi; \
	if [ "$(NETWORK)" = "mainnet" ] && ! grep -q '^STELLAR_NETWORK=mainnet' '$(ENV_FILE)'; then \
	  echo "NETWORK=mainnet but $(ENV_FILE) does not set STELLAR_NETWORK=mainnet"; exit 1; \
	fi

_pulsegen-notice:
	if [ -n '$(PULSEGEN_LOCAL)' ]; then \
	  echo "pulsegen  : NOT synced — $(PULSEGEN_URL) is loopback, unreachable from App Runner."; \
	  echo "            deployed scores resolve from delivered batches. Set a reachable"; \
	  echo "            PULSEGEN_BASE_URL in $(ENV_FILE) to sync it."; \
	elif [ -n '$(PULSEGEN_URL)' ]; then \
	  echo "pulsegen  : syncing PULSEGEN_BASE_URL + PULSEGEN_API_KEY"; \
	else \
	  echo "pulsegen  : no PULSEGEN_BASE_URL set — deployed scores resolve from delivered batches."; \
	fi

help:
	grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

check: ## typecheck + build + test locally
	@if [ "$(CHECK)" != 1 ]; then \
	  echo "check: skipped (CHECK=0)"; \
	else \
	  corepack pnpm -r --if-present run typecheck && corepack pnpm -r --if-present run build && (cd backend && corepack pnpm test); \
	fi

login:
	aws ecr get-login-password --region $(REGION) | docker login --username AWS --password-stdin $(ECR) >/dev/null && echo "ecr: logged in"

deploy: _network-guard ## build+push both, sync env, roll both services
	echo ">> deploying backend + web ($(TAG), $(NETWORK)) to $(WEB_URL) / $(API_URL) — Ctrl-C within 3s to abort" && sleep 3
	$(MAKE) deploy-api
	$(MAKE) deploy-web
	echo ">> done"

deploy-api: _network-guard check login ## backend: build, push, sync env, roll
	echo ">> backend $(ECR)/pathpulse-backend:$(TAG)"
	docker buildx build --platform $(PLATFORM) --provenance=false --sbom=false -f backend/Dockerfile -t $(ECR)/pathpulse-backend:$(TAG) --load .
	docker push $(ECR)/pathpulse-backend:$(TAG)
	$(MAKE) _pulsegen-notice
	$(UPD) --arn '$(API_ARN)' --image $(ECR)/pathpulse-backend:$(TAG) --env-file '$(ENV_FILE)' --allow '$(ENV_ALLOW_EFF)'
	$(MAKE) _wait-api
	$(MAKE) verify-api

deploy-web: _network-guard login ## web: build (with build args), push, roll
	echo ">> web $(ECR)/pathpulse-web:$(TAG)  (API=$(NEXT_PUBLIC_API_URL))"
	if [ -z "$(NEXT_PUBLIC_GOOGLE_CLIENT_ID)" ]; then echo "NEXT_PUBLIC_GOOGLE_CLIENT_ID is empty — pass it or check AWS creds"; exit 1; fi
	docker buildx build --platform $(PLATFORM) --provenance=false --sbom=false -f web/Dockerfile --build-arg NEXT_PUBLIC_API_URL='$(NEXT_PUBLIC_API_URL)' --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID='$(NEXT_PUBLIC_GOOGLE_CLIENT_ID)' --build-arg NEXT_PUBLIC_STELLAR_NETWORK='$(NEXT_PUBLIC_STELLAR_NETWORK)' -t $(ECR)/pathpulse-web:$(TAG) --load .
	docker push $(ECR)/pathpulse-web:$(TAG)
	$(UPD) --arn '$(WEB_ARN)' --image $(ECR)/pathpulse-web:$(TAG)
	$(MAKE) _wait-web
	$(MAKE) verify-web

env: _network-guard ## sync API env vars from $(ENV_FILE) only (no rebuild)
	$(MAKE) _pulsegen-notice
	$(UPD) --arn '$(API_ARN)' --env-file '$(ENV_FILE)' --allow '$(ENV_ALLOW_EFF)'
	$(MAKE) _wait-api
	$(MAKE) verify-api

rollback-api: ## make rollback-api TAG=v5
	if [ -z "$(TAG)" ]; then echo "usage: make rollback-api TAG=v5"; exit 1; fi
	$(UPD) --arn '$(API_ARN)' --image $(ECR)/pathpulse-backend:$(TAG)
	$(MAKE) _wait-api

rollback-web: ## make rollback-web TAG=v4
	if [ -z "$(TAG)" ]; then echo "usage: make rollback-web TAG=v4"; exit 1; fi
	$(UPD) --arn '$(WEB_ARN)' --image $(ECR)/pathpulse-web:$(TAG)
	$(MAKE) _wait-web

status: ## deployed image + status of both services
	aws apprunner describe-service --region $(REGION) --service-arn '$(API_ARN)' --query 'Service.{name:ServiceName,status:Status,image:SourceConfiguration.ImageRepository.ImageIdentifier}' --output table
	aws apprunner describe-service --region $(REGION) --service-arn '$(WEB_ARN)' --query 'Service.{name:ServiceName,status:Status,image:SourceConfiguration.ImageRepository.ImageIdentifier}' --output table

verify: verify-api verify-web ## hit the live endpoints

verify-api:
	echo "== $(API_URL) ==" && curl -fsS $(API_URL)/health && echo && curl -fsS $(API_URL)/v1/routing/assets && echo && \
	  code=$$(curl -sS -o /dev/null -w '%{http_code}' $(API_URL)/v1/routing/treasury/plan) && \
	  echo "routing/treasury/plan  $$code (operator-only, expect 401)" && [ "$$code" = 401 ]

verify-web:
	echo "== $(WEB_URL) ==" && curl -fsS -o /dev/null -w "home    %{http_code}\n" $(WEB_URL)/ && curl -fsS -o /dev/null -w "signin  %{http_code}\n" $(WEB_URL)/signin

_wait-api:
	printf ">> waiting for pathpulse-demo-api "; until [ "$$(aws apprunner describe-service --region $(REGION) --service-arn '$(API_ARN)' --query 'Service.Status' --output text)" = RUNNING ]; do printf .; sleep 15; done; echo " RUNNING"
	echo -n ">> last op: " && aws apprunner list-operations --region $(REGION) --service-arn '$(API_ARN)' --query 'OperationSummaryList[0].Status' --output text

_wait-web:
	printf ">> waiting for pathpulse-demo-web "; until [ "$$(aws apprunner describe-service --region $(REGION) --service-arn '$(WEB_ARN)' --query 'Service.Status' --output text)" = RUNNING ]; do printf .; sleep 15; done; echo " RUNNING"
	echo -n ">> last op: " && aws apprunner list-operations --region $(REGION) --service-arn '$(WEB_ARN)' --query 'OperationSummaryList[0].Status' --output text

uptime-monitor: ## one-off: Route 53 health check on $(API_URL)/health + alarm emailing ALERT_EMAIL (about 1 USD/month)
	if [ -z "$(ALERT_EMAIL)" ]; then echo "usage: make uptime-monitor ALERT_EMAIL=you@example.com"; exit 1; fi
	host=$$(printf '%s' '$(API_URL)' | sed -E 's#^https?://##; s#/.*$$##'); \
	hc=$$(aws route53 create-health-check --caller-reference "pathpulse-api-$$(date +%s)" \
	  --health-check-config "Type=HTTPS,FullyQualifiedDomainName=$$host,ResourcePath=/health,Port=443,RequestInterval=30,FailureThreshold=3" \
	  --query 'HealthCheck.Id' --output text) && \
	aws route53 change-tags-for-resource --resource-type healthcheck --resource-id "$$hc" --add-tags Key=Name,Value=pathpulse-api && \
	topic=$$(aws sns create-topic --region us-east-1 --name pathpulse-uptime --query TopicArn --output text) && \
	aws sns subscribe --region us-east-1 --topic-arn "$$topic" --protocol email --notification-endpoint '$(ALERT_EMAIL)' >/dev/null && \
	aws cloudwatch put-metric-alarm --region us-east-1 --alarm-name pathpulse-api-down \
	  --namespace AWS/Route53 --metric-name HealthCheckStatus --dimensions Name=HealthCheckId,Value=$$hc \
	  --statistic Minimum --period 60 --evaluation-periods 2 --threshold 1 --comparison-operator LessThanThreshold \
	  --treat-missing-data breaching --alarm-actions "$$topic" --ok-actions "$$topic" && \
	echo "health check $$hc + alarm pathpulse-api-down → $(ALERT_EMAIL) (confirm the SNS subscription email)"
