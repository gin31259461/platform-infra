#!/usr/bin/env bash
set -Eeuo pipefail

# shellcheck source=scripts/lib/stack.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/stack.sh"

resolve_stack_request "${STACK:-}" "${STACK_INSTANCE_ID:-}"
require_stack_config

runner_stack_id=${RUNNER_STACK_ID:-}
credential_id=${CREDENTIAL_ID:-}
control_plane_url=${CONTROL_PLANE_URL:-}
allow_plaintext_loopback=${ALLOW_PLAINTEXT_LOOPBACK:-false}

[[ ${runner_stack_id} =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$ ]] || die "RUNNER_STACK_ID is invalid."
[[ ${credential_id} =~ ^hac_[A-Za-z0-9_-]{12,64}$ ]] || die "CREDENTIAL_ID is invalid."
[[ ${allow_plaintext_loopback} == true || ${allow_plaintext_loopback} == false ]] ||
  die "ALLOW_PLAINTEXT_LOOPBACK must be true or false."
[[ ! -t 0 ]] || die "The Host Agent secret must be streamed over standard input."

credential_secret=""
IFS= read -r credential_secret || [[ -n ${credential_secret} ]]
trap 'credential_secret=""' EXIT
[[ ${credential_secret} =~ ^[A-Za-z0-9_-]{43,128}$ ]] || die "The Host Agent secret format is invalid."

runner_user="$(yaml_value runner.user)"
runner_service="$(yaml_value runner.service_name).service"
gitlab_hostname="$(yaml_value gitlab.hostname)"
vpn_interface="$(yaml_value network.vpn_interface)"
workload="${STACK_NAME#gitlab-runners/}"
runner_home="/home/${runner_user}"
agent_venv="${runner_home}/.local/share/gitlab-runner-platform/venv"
runner_uid="$(id -u "${runner_user}" 2>/dev/null)" || die "Runner user does not exist; run make install first."

case ${workload} in
  frontend | dotnet) ;;
  *) die "Unsupported Host Agent workload: ${workload}" ;;
esac

agent_config="$({
  AGENT_ALLOW_PLAINTEXT_LOOPBACK="${allow_plaintext_loopback}" \
  AGENT_CONTROL_PLANE_URL="${control_plane_url}" \
  AGENT_CREDENTIAL_ID="${credential_id}" \
  AGENT_GITLAB_HOSTNAME="${gitlab_hostname}" \
  AGENT_HOST_ID="${HOST_ID:-}" \
  AGENT_RUNNER_SERVICE="${runner_service}" \
  AGENT_RUNNER_STACK_ID="${runner_stack_id}" \
  AGENT_STACK_NAME="${STACK_NAME}" \
  AGENT_VPN_INTERFACE="${vpn_interface}" \
  AGENT_WORKLOAD="${workload}" \
  CONFIG_PATH="${STACK_CONFIG}" \
  PYTHONPATH="${PROJECT_ROOT}" \
  python - <<'PY'
import json
import os

import yaml

from agent.gitlab_runner_agent import parse_config, parse_gitlab_health_url

with open(os.environ["CONFIG_PATH"], encoding="utf-8") as stream:
    stack_config = yaml.safe_load(stream)

gitlab_hostname, gitlab_health_path = parse_gitlab_health_url(stack_config["gitlab"]["health_url"])
if gitlab_hostname != os.environ["AGENT_GITLAB_HOSTNAME"]:
    raise ValueError("GitLab health URL hostname does not match gitlab.hostname")

value = {
    "allowPlaintextLoopback": os.environ["AGENT_ALLOW_PLAINTEXT_LOOPBACK"] == "true",
    "contractVersion": "1.0",
    "controlPlaneUrl": os.environ["AGENT_CONTROL_PLANE_URL"],
    "credentialId": os.environ["AGENT_CREDENTIAL_ID"],
    "hostId": os.environ["AGENT_HOST_ID"],
    "requestTimeoutSeconds": 10,
    "stack": {
        "gitlabHealthPath": gitlab_health_path,
        "gitlabHostname": gitlab_hostname,
        "id": os.environ["AGENT_RUNNER_STACK_ID"],
        "runnerService": os.environ["AGENT_RUNNER_SERVICE"],
        "stackName": os.environ["AGENT_STACK_NAME"],
        "tags": stack_config["runner"]["tags"],
        "vpnInterface": os.environ["AGENT_VPN_INTERFACE"],
        "workload": os.environ["AGENT_WORKLOAD"],
    },
}
parse_config(value)
print(json.dumps(value, indent=2, sort_keys=True))
PY
})" || die "Host Agent configuration is invalid."

as_root install -d -o "${runner_user}" -g "${runner_user}" -m 0700 \
  "${runner_home}/.config/gitlab-runner-platform" \
  "${runner_home}/.local/state/gitlab-runner-platform"
as_root install -d -o "${runner_user}" -g "${runner_user}" -m 0755 \
  "${runner_home}/.local/lib/gitlab-runner-platform" \
  "${runner_home}/.local/share/gitlab-runner-platform" \
  "${runner_home}/.config/systemd/user"
if [[ ! -x ${agent_venv}/bin/python ]]; then
  as_runner_user "${runner_user}" "${runner_uid}" \
    /usr/bin/python -m venv --without-pip "${agent_venv}"
fi
as_runner_user "${runner_user}" "${runner_uid}" \
  "${agent_venv}/bin/python" -I -c \
  'import pathlib, sys; expected = pathlib.Path(sys.argv[1]).resolve(); assert pathlib.Path(sys.prefix).resolve() == expected' \
  "${agent_venv}" || die "Host Agent virtual environment is invalid."
as_root install -o "${runner_user}" -g "${runner_user}" -m 0755 \
  "${PROJECT_ROOT}/agent/gitlab_runner_agent.py" \
  "${runner_home}/.local/lib/gitlab-runner-platform/gitlab_runner_agent.py"
as_root install -o "${runner_user}" -g "${runner_user}" -m 0644 \
  "${PROJECT_ROOT}/agent/systemd/gitlab-runner-platform-agent.service" \
  "${runner_home}/.config/systemd/user/gitlab-runner-platform-agent.service"
as_root install -o "${runner_user}" -g "${runner_user}" -m 0644 \
  "${PROJECT_ROOT}/agent/systemd/gitlab-runner-platform-agent.timer" \
  "${runner_home}/.config/systemd/user/gitlab-runner-platform-agent.timer"
printf '%s\n' "${agent_config}" | as_root install -o "${runner_user}" -g "${runner_user}" -m 0600 \
  /dev/stdin "${runner_home}/.config/gitlab-runner-platform/agent.json"
printf '%s' "${credential_secret}" | as_root install -o "${runner_user}" -g "${runner_user}" -m 0600 \
  /dev/stdin "${runner_home}/.config/gitlab-runner-platform/credential"
credential_secret=""

as_runner_user "${runner_user}" "${runner_uid}" systemctl --user daemon-reload
as_runner_user "${runner_user}" "${runner_uid}" systemctl --user enable --now \
  gitlab-runner-platform-agent.timer

info "Host Agent installed for ${STACK_NAME}."
