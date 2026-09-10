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

SHELL       := bash
.SHELLFLAGS := -c
.DEFAULT_GOAL := help
.SILENT:

REGION   := us-east-1
ACCOUNT  := 691650376162
ECR      := $(ACCOUNT).dkr.ecr.$(REGION).amazonaws.com
API_ARN  := arn:aws:apprunner:$(REGION):$(ACCOUNT):service/pathpulse-demo-api/36dfb0f85c7a424f92726291399a79a9
WEB_ARN  := arn:aws:apprunner:$(REGION):$(ACCOUNT):service/pathpulse-demo-web/17f4b8a23a9345bd8d849faacf1631f5
API_URL  := https://demo-api.pathpulse.ai
WEB_URL  := https://demo.pathpulse.ai

ENV_FILE ?= .env
PLATFORM ?= linux/amd64
CHECK    ?= 1

# image tag: git short sha (+ -dirty), overridable with TAG=
GIT_SHA  := $(shell git rev-parse --short=8 HEAD 2>/dev/null || echo nogit)
DIRTY    := $(shell git diff --quiet 2>/dev/null || echo -dirty)
TAG      ?= $(GIT_SHA)$(DIRTY)

# web build args are baked into the image; client id read from the live API config
NEXT_PUBLIC_API_URL          ?= https://demo-api.pathpulse.ai
NEXT_PUBLIC_GOOGLE_CLIENT_ID ?= $(shell aws apprunner describe-service --region $(REGION) --service-arn $(API_ARN) --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.GOOGLE_CLIENT_ID' --output text 2>/dev/null)

# .env keys pushed to the API service (merged onto existing, never replaces).
# Excludes env-specific keys (DATABASE_URL, SESSION_SECRET, SEP10_*, *_URL, KMS,
# SIGNER_BACKEND, STELLAR_NETWORK) and localhost-only keys (SDP_BASE_URL, REDIS_URL).
ENV_ALLOW := OFFRAMP_PROVIDER ROUTING_PROVIDERS ROUTING_ASSETS ROUTING_QUOTE_TIMEOUT_MS ROUTING_SETTLEMENT_ASSET STELLARBROKER_PARTNER_KEY STELLARBROKER_API_URL CARRET_API_KEY CARRET_ACCOUNT_ID CARRET_BASE_URL CARRET_BANK_ID CARRET_WEBHOOK_SECRET CARRET_CHAIN CARRET_CRYPTO CARRET_FIAT CARRET_INDICATIVE_RATE RAMP_API_KEY RAMP_WEBHOOK_PUBLIC_KEY RAMP_WIDGET_URL RAMP_HOST_APP_NAME OFFRAMP_CRYPTO OFFRAMP_ASSET_ID OFFRAMP_FIAT OFFRAMP_INDICATIVE_RATE SDP_API_KEY SDP_WALLET_ID SDP_ASSET_ID SDP_TENANT_NAME SDP_CONTACT_DOMAIN SDP_REGISTRATION_CONTACT_TYPE SDP_VERIFICATION_FIELD SDP_RETRY_ATTEMPTS SDP_RETRY_BASE_DELAY_MS

UPD := python3 scripts/apprunner-update.py --region $(REGION)

.PHONY: help check login deploy deploy-api deploy-web env status verify verify-api verify-web rollback-api rollback-web _wait-api _wait-web

help:
	grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

check: ## typecheck + build + test locally
	if [ "$(CHECK)" != 1 ]; then echo "check: skipped (CHECK=0)"; exit 0; fi
	corepack pnpm -r --if-present run typecheck && corepack pnpm -r --if-present run build && (cd backend && corepack pnpm test)

login:
	aws ecr get-login-password --region $(REGION) | docker login --username AWS --password-stdin $(ECR) >/dev/null && echo "ecr: logged in"

deploy: ## build+push both, sync env, roll both services
	echo ">> deploying backend + web ($(TAG)) to $(WEB_URL) / $(API_URL) — Ctrl-C within 3s to abort" && sleep 3
	$(MAKE) deploy-api
	$(MAKE) deploy-web
	echo ">> done"

deploy-api: check login ## backend: build, push, sync env, roll
	echo ">> backend $(ECR)/pathpulse-backend:$(TAG)"
	docker buildx build --platform $(PLATFORM) --provenance=false --sbom=false -f backend/Dockerfile -t $(ECR)/pathpulse-backend:$(TAG) --load .
	docker push $(ECR)/pathpulse-backend:$(TAG)
	$(UPD) --arn '$(API_ARN)' --image $(ECR)/pathpulse-backend:$(TAG) --env-file '$(ENV_FILE)' --allow '$(ENV_ALLOW)'
	$(MAKE) _wait-api
	$(MAKE) verify-api

deploy-web: login ## web: build (with build args), push, roll
	echo ">> web $(ECR)/pathpulse-web:$(TAG)  (API=$(NEXT_PUBLIC_API_URL))"
	if [ -z "$(NEXT_PUBLIC_GOOGLE_CLIENT_ID)" ]; then echo "NEXT_PUBLIC_GOOGLE_CLIENT_ID is empty — pass it or check AWS creds"; exit 1; fi
	docker buildx build --platform $(PLATFORM) --provenance=false --sbom=false -f web/Dockerfile --build-arg NEXT_PUBLIC_API_URL='$(NEXT_PUBLIC_API_URL)' --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID='$(NEXT_PUBLIC_GOOGLE_CLIENT_ID)' -t $(ECR)/pathpulse-web:$(TAG) --load .
	docker push $(ECR)/pathpulse-web:$(TAG)
	$(UPD) --arn '$(WEB_ARN)' --image $(ECR)/pathpulse-web:$(TAG)
	$(MAKE) _wait-web
	$(MAKE) verify-web

env: ## sync API env vars from $(ENV_FILE) only (no rebuild)
	$(UPD) --arn '$(API_ARN)' --env-file '$(ENV_FILE)' --allow '$(ENV_ALLOW)'
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
	echo "== $(API_URL) ==" && curl -fsS $(API_URL)/health && echo && curl -fsS $(API_URL)/v1/routing/assets && echo && curl -fsS -o /dev/null -w "routing/treasury/plan  %{http_code}\n" $(API_URL)/v1/routing/treasury/plan

verify-web:
	echo "== $(WEB_URL) ==" && curl -fsS -o /dev/null -w "home    %{http_code}\n" $(WEB_URL)/ && curl -fsS -o /dev/null -w "signin  %{http_code}\n" $(WEB_URL)/signin

_wait-api:
	printf ">> waiting for pathpulse-demo-api "; until [ "$$(aws apprunner describe-service --region $(REGION) --service-arn '$(API_ARN)' --query 'Service.Status' --output text)" = RUNNING ]; do printf .; sleep 15; done; echo " RUNNING"
	echo -n ">> last op: " && aws apprunner list-operations --region $(REGION) --service-arn '$(API_ARN)' --query 'OperationSummaryList[0].Status' --output text

_wait-web:
	printf ">> waiting for pathpulse-demo-web "; until [ "$$(aws apprunner describe-service --region $(REGION) --service-arn '$(WEB_ARN)' --query 'Service.Status' --output text)" = RUNNING ]; do printf .; sleep 15; done; echo " RUNNING"
	echo -n ">> last op: " && aws apprunner list-operations --region $(REGION) --service-arn '$(WEB_ARN)' --query 'OperationSummaryList[0].Status' --output text
