#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/../scripts/lib/stack.sh"

resolve_stack "${1:-}"
require_stack_config

runner_user="$(yaml_value runner.user)"
runner_uid="$(id -u "${runner_user}" 2>/dev/null)" ||
  die "Runner user does not exist."
vpn_interface="$(yaml_value network.vpn_interface)"
gitlab_hostname="$(yaml_value gitlab.hostname)"
health_url="$(yaml_value gitlab.health_url)"
curl_image="$(yaml_value frontend.curl_image)"
private_ca_enabled="$(yaml_value tls.private_ca_enabled)"
installed_ca="/home/${runner_user}/gitlab-runner/config/certs/ca.crt"

ip link show "${vpn_interface}" >/dev/null
getent hosts "${gitlab_hostname}" >/dev/null

host_curl=(curl --fail --show-error --silent --location)
container_curl=(
  podman run --rm --network host --pull=missing
)
if [[ ${private_ca_enabled} == true ]]; then
  as_root test -f "${installed_ca}" || die "Installed private CA certificate is missing."
  host_curl+=(--cacert "${installed_ca}")
  container_curl+=(
    --volume "${installed_ca}:/tmp/gitlab-ca.crt:ro"
    "${curl_image}" --cacert /tmp/gitlab-ca.crt
  )
else
  container_curl+=("${curl_image}")
fi

as_root "${host_curl[@]}" "${health_url}" >/dev/null
as_runner_user "${runner_user}" "${runner_uid}" \
  "${container_curl[@]}" --fail --show-error --silent --location \
  "${health_url}" >/dev/null

info "Network verification passed."
