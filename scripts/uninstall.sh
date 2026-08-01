#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/lib/stack.sh"

resolve_stack_request "${1:-}" "${2:-}"
require_stack_config
instance_id=${2:-}
target=${instance_id:-${STACK_NAME}}

[[ -t 0 ]] || die "Uninstall requires an interactive terminal for exact confirmation."
printf 'Type %s to permanently remove this local Runner Stack and Linux user: ' \
  "REMOVE ${target}"
read -r confirmation
[[ ${confirmation} == "REMOVE ${target}" ]] || die "Uninstall cancelled."
if [[ -n ${instance_id} ]]; then
  require_command pnpm
fi

runner_user="$(yaml_value runner.user)"
service_name="$(yaml_value runner.service_name)"
container_name="$(yaml_value runner.container_name)"
quadlet="/home/${runner_user}/.config/containers/systemd/${service_name}.container"

if runner_uid="$(id -u "${runner_user}" 2>/dev/null)"; then
  as_runner_user "${runner_user}" "${runner_uid}" \
    systemctl --user stop gitlab-runner-platform-agent.timer >/dev/null 2>&1 || true
  as_runner_user "${runner_user}" "${runner_uid}" \
    systemctl --user stop gitlab-runner-platform-agent.service >/dev/null 2>&1 || true
  as_runner_user "${runner_user}" "${runner_uid}" \
    systemctl --user stop "${service_name}.service" >/dev/null 2>&1 || true
  as_runner_user "${runner_user}" "${runner_uid}" \
    podman rm --force "${container_name}" >/dev/null 2>&1 || true
  as_root rm -f -- "${quadlet}"
  as_root loginctl disable-linger "${runner_user}" >/dev/null 2>&1 || true
  as_root loginctl terminate-user "${runner_user}" >/dev/null 2>&1 || true
  as_root userdel --remove "${runner_user}"
else
  info "Runner user does not exist; local user cleanup is already complete."
fi

if [[ -n ${instance_id} ]]; then
  provisioned_directory="$(dirname -- "${STACK_CONFIG}")"
  expected_directory="${PROJECT_ROOT}/secrets/provisioned-stacks/${instance_id}"
  [[ ${provisioned_directory} == "${expected_directory}" ]] ||
    die "Provisioned Runner Stack cleanup path is unsafe."
  as_root rm -f -- "${STACK_CONFIG}"
  as_root rmdir -- "${provisioned_directory}"

  (
    cd -- "${PROJECT_ROOT}"
    pnpm --silent --filter @gitlab-runner-platform/web \
      runner:decommission -- --stack-id "${instance_id}"
  )
fi

info "Removed local Runner Stack ${target}, Linux user, installed configuration, cache, and container storage."
if [[ -z ${instance_id} ]]; then
  info "The repository Stack config was preserved so the Stack can be installed again."
fi
if [[ -n ${instance_id} ]]; then
  info "The provisioned Runner Stack was removed from the active Control Plane fleet; its history was preserved."
fi
info "The GitLab Runner Record was preserved; pause or delete it manually in GitLab when appropriate."
