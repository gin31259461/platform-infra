#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/lib/stack.sh"

resolve_stack_request "${1:-}" "${2:-}"
require_stack_config
"${PROJECT_ROOT}/tests/validate-stack.sh" "${STACK_NAME}" "${2:-}"

ansible-playbook \
  -i "${PROJECT_ROOT}/inventory/localhost.yml" \
  "${PROJECT_ROOT}/playbooks/gitlab-runner.yml" \
  --tags preflight \
  --extra-vars "stack_config=${STACK_CONFIG} stack_name=${STACK_NAME}"
