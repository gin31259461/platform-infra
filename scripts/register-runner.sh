#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/lib/stack.sh"

resolve_stack_request "${1:-}" "${2:-}"
require_stack_config
runner_token=""
IFS= read -r runner_token || [[ -n ${runner_token} ]]
trap 'runner_token=""' EXIT
[[ ${runner_token} =~ ^glrt-[^[:space:]]{20,512}$ ]] || die "Runner authentication token format is invalid."

runner_user="$(yaml_value runner.user)"
container_name="$(yaml_value runner.container_name)"
runner_name="$(yaml_value runner.name)"
gitlab_url="$(yaml_value gitlab.url)"
default_image="$(yaml_value runner.default_job_image)"
cpus="$(yaml_value runner.cpus)"
memory="$(yaml_value runner.memory)"
shm_size="$(yaml_value runner.shm_size_bytes)"
pull_policy="$(yaml_value runner.pull_policy)"
vpn_dns="$(yaml_value network.vpn_dns)"
runner_uid="$(id -u "${runner_user}" 2>/dev/null)" || die "Runner user does not exist; run make install first."
config_path="/home/${runner_user}/gitlab-runner/config/config.toml"

as_runner_user "${runner_user}" "${runner_uid}" \
  podman container exists "${container_name}" ||
  die "Runner manager container does not exist; run make install first."

running="$(as_runner_user "${runner_user}" "${runner_uid}" \
  podman inspect --format '{{.State.Running}}' "${container_name}")"
[[ ${running} == true ]] || die "Runner manager container is not running."

if as_root test -s "${config_path}" &&
  as_root grep -Eq '^[[:space:]]*token[[:space:]]*=[[:space:]]*"[^"]+"' "${config_path}"; then
  if as_runner_user "${runner_user}" "${runner_uid}" \
    podman exec "${container_name}" gitlab-runner verify >/dev/null 2>&1; then
    info "Runner is already registered and verified; no changes made."
    exit 0
  fi
  die "A registration already exists but verification failed. It was preserved for manual diagnosis."
fi

register_args=(
  gitlab-runner register
  --non-interactive
  --url "${gitlab_url}"
  --name "${runner_name}"
  --executor docker
  --docker-host "unix:///run/podman/podman.sock"
  --docker-image "${default_image}"
  --docker-privileged=false
  --docker-disable-cache=false
  --docker-cpus "${cpus}"
  --docker-memory "${memory}"
  --docker-shm-size "${shm_size}"
  --docker-pull-policy "${pull_policy}"
  --docker-volumes /cache
  --env FF_NETWORK_PER_BUILD=1
)

while IFS= read -r allowed_image; do
  register_args+=(--docker-allowed-images "${allowed_image}")
done < <(yaml_list runner.allowed_images)

while IFS= read -r allowed_service; do
  register_args+=(--docker-allowed-services "${allowed_service}")
done < <(yaml_list_optional runner.allowed_services)

if [[ -n ${vpn_dns} ]]; then
  register_args+=(--docker-dns "${vpn_dns}")
fi

# Stream the token to a short-lived shell inside the manager. The value never
# appears in Podman arguments, command output, or a temporary file.
if ! printf '%s\n' "${runner_token}" |
  as_runner_user "${runner_user}" "${runner_uid}" \
    podman exec --interactive "${container_name}" sh -c '
      IFS= read -r CI_SERVER_TOKEN
      export CI_SERVER_TOKEN
      exec "$@"
    ' sh "${register_args[@]}" >/dev/null 2>&1; then
  die "Runner registration failed; the token and command output were not displayed."
fi
runner_token=""

as_root chmod 0600 "${config_path}"
as_runner_user "${runner_user}" "${runner_uid}" \
  podman exec "${container_name}" gitlab-runner verify >/dev/null

info "Runner registration completed and verified."
