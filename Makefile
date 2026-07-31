SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

.PHONY: help bootstrap check install install-agent register verify status uninstall idempotency validate validate-all lint test-agent

help:
	@echo "Usage: make <target> STACK=gitlab-runners/frontend"
	@echo "Targets: bootstrap check install install-agent register verify status uninstall idempotency validate validate-all lint test-agent"

bootstrap:
	sudo ./scripts/bootstrap.sh

check:
	./scripts/check.sh "$(STACK)"

install:
	./scripts/install.sh "$(STACK)"

install-agent:
	./scripts/install-agent.sh

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

test-agent:
	python -m unittest discover -s agent/tests -v
