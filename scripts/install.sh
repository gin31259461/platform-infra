#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/lib/stack.sh"

resolve_stack_request "${1:-}" "${2:-}"
require_stack_config

if [[ ${EUID} -ne 0 ]]; then
  [[ -t 0 ]] || die "Installation requires an interactive terminal for the sudo password."
  sudo -v
fi

ansible-playbook \
  -i "${PROJECT_ROOT}/inventory/localhost.yml" \
  "${PROJECT_ROOT}/playbooks/gitlab-runner.yml" \
  --extra-vars "stack_config=${STACK_CONFIG} stack_name=${STACK_NAME}"
