#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/lib/stack.sh"

resolve_stack "${1:-}"
require_stack_config
purge=false
[[ ${2:-} == --purge ]] && purge=true
[[ -z ${2:-} || ${2:-} == --purge ]] || die "Usage: $0 STACK [--purge]"

runner_user="$(yaml_value runner.user)"
service_name="$(yaml_value runner.service_name)"
container_name="$(yaml_value runner.container_name)"
quadlet="/home/${runner_user}/.config/containers/systemd/${service_name}.container"

if runner_uid="$(id -u "${runner_user}" 2>/dev/null)"; then
  as_runner_user "${runner_user}" "${runner_uid}" \
    systemctl --user stop "${service_name}.service" >/dev/null 2>&1 || true
  as_runner_user "${runner_user}" "${runner_uid}" \
    podman rm --force "${container_name}" >/dev/null 2>&1 || true
  as_root rm -f -- "${quadlet}"
  as_runner_user "${runner_user}" "${runner_uid}" systemctl --user daemon-reload
else
  info "Runner user does not exist; service cleanup skipped."
fi

if [[ ${purge} == true ]]; then
  printf 'Type %s to permanently remove the runner user, config, cache, and container storage: ' \
    "PURGE ${STACK_NAME}"
  read -r confirmation
  [[ ${confirmation} == "PURGE ${STACK_NAME}" ]] || die "Purge cancelled."
  if id "${runner_user}" >/dev/null 2>&1; then
    as_root loginctl disable-linger "${runner_user}" || true
    as_root userdel --remove "${runner_user}"
  fi
  info "Purged local data for ${STACK_NAME}. This cannot be recovered by this repository."
else
  info "Uninstalled ${STACK_NAME}; runner config and cache were preserved."
fi

info "Remove or pause the Project Runner in the GitLab UI when appropriate."
