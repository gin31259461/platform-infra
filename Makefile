SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

.PHONY: help bootstrap check install install-agent register verify status uninstall idempotency validate validate-all lint test-agent

help:
	@echo "Usage: make <target> STACK=gitlab-runners/frontend"
	@echo "Targets: bootstrap check install install-agent register verify status uninstall idempotency validate validate-all lint test-agent"

bootstrap:
	sudo ./scripts/bootstrap.sh

check:
	./scripts/check.sh "$(STACK)" "$(STACK_INSTANCE_ID)"

install:
	./scripts/install.sh "$(STACK)" "$(STACK_INSTANCE_ID)"

install-agent:
	./scripts/install-agent.sh

register:
	./scripts/register-runner.sh "$(STACK)" "$(STACK_INSTANCE_ID)"

verify:
	./scripts/verify.sh "$(STACK)" "$(STACK_INSTANCE_ID)"

status:
	./scripts/status.sh "$(STACK)" "$(STACK_INSTANCE_ID)"

uninstall:
	./scripts/uninstall.sh "$(STACK)" "$(STACK_INSTANCE_ID)"

idempotency:
	./tests/verify-idempotency.sh "$(STACK)" "$(STACK_INSTANCE_ID)"

validate:
	./tests/validate-stack.sh "$(STACK)" "$(STACK_INSTANCE_ID)"

validate-all:
	./tests/validate-all.sh

lint:
	./tests/lint.sh

test-agent:
	uv run --locked python -m unittest discover -s agent/tests -v
