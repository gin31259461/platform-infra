#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/../scripts/lib/stack.sh"

resolve_stack "${1:-}"
require_stack_config

"${PROJECT_ROOT}/scripts/install.sh" "${STACK_NAME}"
idempotency_log="$(mktemp)"
trap 'rm -f -- "${idempotency_log}"' EXIT

ansible-playbook \
  -i "${PROJECT_ROOT}/inventory/localhost.yml" \
  "${PROJECT_ROOT}/playbooks/gitlab-runner.yml" \
  --extra-vars "stack_config=${STACK_CONFIG} stack_name=${STACK_NAME}" |
  tee "${idempotency_log}"

grep -Eq 'changed=0[[:space:]]+unreachable=0[[:space:]]+failed=0' "${idempotency_log}" ||
  die "Second install reported changed or failed tasks."

info "Idempotency verification passed."
