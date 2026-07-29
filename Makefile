SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

.PHONY: help bootstrap check install register verify status uninstall idempotency validate validate-all lint

help:
	@echo "Usage: make <target> STACK=gitlab-runners/frontend"
	@echo "Targets: bootstrap check install register verify status uninstall idempotency validate validate-all lint"

bootstrap:
	sudo ./scripts/bootstrap.sh

check:
	./scripts/check.sh "$(STACK)"

install:
	./scripts/install.sh "$(STACK)"

register:
	./scripts/register-runner.sh "$(STACK)"

verify:
	./scripts/verify.sh "$(STACK)"

status:
	./scripts/status.sh "$(STACK)"

uninstall:
	./scripts/uninstall.sh "$(STACK)"

idempotency:
	./tests/verify-idempotency.sh "$(STACK)"

validate:
	./tests/validate-stack.sh "$(STACK)"

validate-all:
	./tests/validate-all.sh

lint:
	./tests/lint.sh

