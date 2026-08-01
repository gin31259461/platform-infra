#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/lib/stack.sh"

resolve_stack_request "${1:-}" "${2:-}"
require_stack_config

runner_user="$(yaml_value runner.user)"
service_name="$(yaml_value runner.service_name)"
container_name="$(yaml_value runner.container_name)"
vpn_interface="$(yaml_value network.vpn_interface)"
gitlab_hostname="$(yaml_value gitlab.hostname)"
health_url="$(yaml_value gitlab.health_url)"
private_ca_enabled="$(yaml_value tls.private_ca_enabled)"
config_path="/home/${runner_user}/gitlab-runner/config/config.toml"

printf 'Stack ID: %s\n' "$(yaml_value stack.id)"
printf 'Runner user: %s\n' "${runner_user}"

if runner_uid="$(id -u "${runner_user}" 2>/dev/null)"; then
  printf 'Runner UID: %s\n' "${runner_uid}"
else
  printf 'Runner UID: unavailable\n'
  exit 1
fi

ip link show "${vpn_interface}" >/dev/null 2>&1 &&
  printf 'VPN interface: up (%s)\n' "${vpn_interface}" ||
  printf 'VPN interface: unavailable (%s)\n' "${vpn_interface}"
getent hosts "${gitlab_hostname}" >/dev/null 2>&1 &&
  printf 'GitLab DNS resolution: ok\n' ||
  printf 'GitLab DNS resolution: failed\n'
status_curl=(curl --fail --silent --show-error --location)
if [[ ${private_ca_enabled} == true ]]; then
  status_curl+=(--cacert "/home/${runner_user}/gitlab-runner/config/certs/ca.crt")
fi
as_root "${status_curl[@]}" "${health_url}" >/dev/null 2>&1 &&
  printf 'GitLab health status: ok\n' ||
  printf 'GitLab health status: failed\n'

podman_version="$(as_runner_user "${runner_user}" "${runner_uid}" podman --version 2>/dev/null || true)"
printf 'Podman version: %s\n' "${podman_version:-unavailable}"
podman_socket_status="$(as_runner_user "${runner_user}" "${runner_uid}" \
  systemctl --user is-active podman.socket 2>/dev/null || true)"
printf 'Podman socket status: %s\n' "${podman_socket_status:-inactive}"
runner_service_status="$(as_runner_user "${runner_user}" "${runner_uid}" \
  systemctl --user is-active "${service_name}.service" 2>/dev/null || true)"
printf 'Runner service status: %s\n' "${runner_service_status:-inactive}"
container_status="$(as_runner_user "${runner_user}" "${runner_uid}" \
  podman inspect --format '{{.State.Status}}' "${container_name}" 2>/dev/null || true)"
printf 'Runner container status: %s\n' "${container_status:-unavailable}"
if as_runner_user "${runner_user}" "${runner_uid}" \
  podman exec "${container_name}" gitlab-runner verify >/dev/null 2>&1; then
  printf 'Runner verification status: ok\n'
else
  printf 'Runner verification status: failed or not registered\n'
fi
printf 'Runner config path: %s\n' "${config_path}"
printf 'Runner log command: sudo -u %q XDG_RUNTIME_DIR=/run/user/%q journalctl --user -u %q.service\n' \
  "${runner_user}" "${runner_uid}" "${service_name}"
