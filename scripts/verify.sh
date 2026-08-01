#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/lib/stack.sh"

resolve_stack_request "${1:-}" "${2:-}"
require_stack_config

"${PROJECT_ROOT}/tests/verify-network.sh" "${STACK_NAME}" "${2:-}"
"${PROJECT_ROOT}/tests/verify-podman.sh" "${STACK_NAME}" "${2:-}"
"${PROJECT_ROOT}/tests/verify-runner.sh" "${STACK_NAME}" "${2:-}"
info "All verification checks passed for ${2:-${STACK_NAME}}."
