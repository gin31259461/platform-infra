#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/lib/stack.sh"

resolve_stack "${1:-}"
require_stack_config

"${PROJECT_ROOT}/tests/verify-network.sh" "${STACK_NAME}"
"${PROJECT_ROOT}/tests/verify-podman.sh" "${STACK_NAME}"
"${PROJECT_ROOT}/tests/verify-runner.sh" "${STACK_NAME}"
info "All verification checks passed for ${STACK_NAME}."
