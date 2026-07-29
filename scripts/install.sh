#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/lib/stack.sh"

resolve_stack "${1:-}"
require_stack_config

become_args=()
if [[ ${EUID} -ne 0 ]]; then
  [[ -t 0 ]] || die "Installation requires an interactive terminal for the sudo password."
  become_args+=(--ask-become-pass)
fi

ansible-playbook \
  -i "${PROJECT_ROOT}/inventory/localhost.yml" \
  "${PROJECT_ROOT}/playbooks/gitlab-runner.yml" \
  "${become_args[@]}" \
  --extra-vars "stack_config=${STACK_CONFIG} stack_name=${STACK_NAME}"
