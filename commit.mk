TRAILER := Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

define commit_group
	@git add -A -- $(2)
	@git diff --cached --quiet || { git commit -q -m "$(1)" -m "$(TRAILER)" && echo "committed: $(1)"; }
endef

.PHONY: commit-all deps config stellar routing services routes scripts web ios deploy rest

commit-all: deps config stellar routing services routes scripts web ios deploy rest
	@git log --oneline -n 12

deps:
	$(call commit_group,Add Sentry dependencies,backend/package.json web/package.json pnpm-lock.yaml)

config:
	$(call commit_group,Harden mainnet config and middleware,backend/src/config backend/src/middleware backend/src/index.ts backend/src/server.ts backend/src/db backend/src/crypto)

stellar:
	$(call commit_group,Add deposits and mainnet stellar guards,backend/src/stellar)

routing:
	$(call commit_group,Add guarded StellarBroker execution,backend/src/routing)

services:
	$(call commit_group,Add alerts health and payouts,backend/src/services)

routes:
	$(call commit_group,Add payouts CSV export route,backend/src/routes packages)

scripts:
	$(call commit_group,Add mainnet setup script,backend/scripts)

web:
	$(call commit_group,Add status page and exports,web)

ios:
	$(call commit_group,Update iOS mainnet support,ios)

deploy:
	$(call commit_group,Update deploy Makefile,Makefile)

rest:
	$(call commit_group,Add remaining changes,. ":!commit.mk")
