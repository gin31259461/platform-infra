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
service_name="$(yaml_value runner.service_name)"
container_name="$(yaml_value runner.container_name)"
runner_image="$(yaml_value runner.image)"
config_path="/home/${runner_user}/gitlab-runner/config/config.toml"
socket_source="/run/user/${runner_uid}/podman/podman.sock"
socket_destination="/run/podman/podman.sock"

as_runner_user "${runner_user}" "${runner_uid}" \
  systemctl --user is-active --quiet "${service_name}.service" ||
  die "Runner service is inactive."

running="$(as_runner_user "${runner_user}" "${runner_uid}" \
  podman inspect --format '{{.State.Running}}' "${container_name}")"
[[ ${running} == true ]] || die "Runner manager container is not running."

actual_image="$(as_runner_user "${runner_user}" "${runner_uid}" \
  podman inspect --format '{{.Config.Image}}' "${container_name}")"
[[ ${actual_image} == "${runner_image}" ]] || die "Runner manager image mismatch."

network_mode="$(as_runner_user "${runner_user}" "${runner_uid}" \
  podman inspect --format '{{.HostConfig.NetworkMode}}' "${container_name}")"
[[ ${network_mode} == host ]] || die "Runner manager is not using host networking."

mounts="$(as_runner_user "${runner_user}" "${runner_uid}" \
  podman inspect \
    --format '{{range .Mounts}}{{printf "%s|%s\n" .Source .Destination}}{{end}}' \
    "${container_name}")"
grep -Fxq "${socket_source}|${socket_destination}" <<<"${mounts}" ||
  die "Runner manager does not mount the expected Podman socket."

mode="$(as_root stat --format '%a' "${config_path}")"
[[ ${mode} == 600 ]] || die "Runner config permissions must be 0600."

as_root env \
  CONFIG_PATH="${config_path}" \
  STACK_CONFIG="${STACK_CONFIG}" \
  python - <<'PY'
import os
import sys
import tomllib
import yaml

with open(os.environ["CONFIG_PATH"], "rb") as stream:
    config = tomllib.load(stream)
with open(os.environ["STACK_CONFIG"], encoding="utf-8") as stream:
    stack_config = yaml.safe_load(stream)

if config.get("concurrent") != 1:
    sys.exit("Runner concurrent must equal 1.")
runners = config.get("runners", [])
if len(runners) != 1:
    sys.exit("Exactly one registered Runner is required.")
runner = runners[0]
docker = runner.get("docker", {})
if runner.get("executor") != "docker":
    sys.exit("Runner executor must be docker.")
if docker.get("host") != "unix:///run/podman/podman.sock":
    sys.exit("Runner runtime endpoint is incorrect.")
if docker.get("privileged") is not False:
    sys.exit("Privileged mode must be false.")
expected = stack_config["runner"]["allowed_images"]
if docker.get("allowed_images") != expected:
    sys.exit("Runner allowed_images is incorrect.")
for volume in docker.get("volumes", []):
    if "podman.sock" in volume or "docker.sock" in volume:
        sys.exit("A container runtime socket is exposed to CI jobs.")
if "FF_NETWORK_PER_BUILD=1" not in runner.get("environment", []):
    sys.exit("Per-build networking is not enabled.")
PY

as_runner_user "${runner_user}" "${runner_uid}" \
  podman exec "${container_name}" gitlab-runner verify >/dev/null 2>&1 ||
  die "GitLab Runner verification failed."

if systemctl is-active --quiet docker.service 2>/dev/null; then
  die "Docker daemon must not be active."
fi

info "GitLab Runner verification passed."
