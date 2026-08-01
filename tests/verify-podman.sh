#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/../scripts/lib/stack.sh"

resolve_stack_request "${1:-}" "${2:-}"
require_stack_config

runner_user="$(yaml_value runner.user)"
runner_uid="$(id -u "${runner_user}" 2>/dev/null)" ||
  die "Runner user does not exist."
socket="/run/user/${runner_uid}/podman/podman.sock"
modules_load_file="/etc/modules-load.d/platform-infra-podman.conf"
required_modules=(bridge veth br_netfilter)

as_root test -f "/var/lib/systemd/linger/${runner_user}" ||
  die "systemd lingering is not enabled."
as_root test -f /sys/fs/cgroup/cgroup.controllers ||
  die "cgroup v2 is not active."
as_runner_user "${runner_user}" "${runner_uid}" \
  systemctl --user is-active --quiet podman.socket ||
  die "Podman socket is inactive."
as_root test -S "${socket}" || die "Podman socket is missing: ${socket}"

[[ -r ${modules_load_file} ]] ||
  die "Persistent Podman kernel module configuration is missing."
for module in "${required_modules[@]}"; do
  [[ -d /sys/module/${module} ]] ||
    die "Required kernel module is not loaded: ${module}"
  grep -Fxq "${module}" "${modules_load_file}" ||
    die "Kernel module is missing from ${modules_load_file}: ${module}"
done

rootless="$(as_runner_user "${runner_user}" "${runner_uid}" \
  podman info --format '{{.Host.Security.Rootless}}')"
[[ ${rootless} == true ]] || die "Podman is not rootless."

info "Rootless Podman verification passed."
