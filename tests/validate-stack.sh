#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stack.sh
source "${SCRIPT_DIR}/../scripts/lib/stack.sh"

resolve_stack "${1:-}"
config_to_validate="${STACK_EXAMPLE_CONFIG}"
reject_placeholders=false
if [[ -f ${STACK_CONFIG} ]]; then
  config_to_validate="${STACK_CONFIG}"
  reject_placeholders=true
fi

CONFIG_TO_VALIDATE="${config_to_validate}" \
REJECT_PLACEHOLDERS="${reject_placeholders}" python - <<'PY'
import os
import ipaddress
import re
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required for stack validation.")

path = os.environ["CONFIG_TO_VALIDATE"]
with open(path, encoding="utf-8") as stream:
    config = yaml.safe_load(stream)

def require(path_string, expected_type=None):
    value = config
    for key in path_string.split("."):
        if not isinstance(value, dict) or key not in value:
            raise SystemExit(f"{path}: missing {path_string}")
        value = value[key]
    if expected_type is not None and not isinstance(value, expected_type):
        raise SystemExit(f"{path}: {path_string} has the wrong type")
    return value

required_strings = [
    "stack.type", "stack.id", "stack.description", "gitlab.url",
    "gitlab.hostname", "gitlab.health_url", "runner.name", "runner.user",
    "runner.container_name", "runner.service_name", "runner.image",
    "runner.memory", "runner.pull_policy", "runner.default_job_image",
    "network.vpn_interface",
    "frontend.package_name", "frontend.node_image",
    "frontend.playwright_image", "frontend.curl_image",
    "frontend.pnpm_version",
]
for field in required_strings:
    value = require(field, str)
    if not value:
        raise SystemExit(f"{path}: {field} must not be empty")

if require("stack.type") != "gitlab-runner":
    raise SystemExit(f"{path}: unsupported stack.type")
if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", require("stack.id")):
    raise SystemExit(f"{path}: unsafe stack.id")
if not require("gitlab.url").startswith("https://"):
    raise SystemExit(f"{path}: gitlab.url must use HTTPS")
if not require("gitlab.health_url").startswith("https://"):
    raise SystemExit(f"{path}: gitlab.health_url must use HTTPS")
if require("runner.concurrent") != 1:
    raise SystemExit(f"{path}: runner.concurrent must equal 1")
if require("runner.privileged") is not False:
    raise SystemExit(f"{path}: runner.privileged must be false")
if require("network.use_host_network_for_runner_manager") is not True:
    raise SystemExit(f"{path}: Runner manager must use host networking")
vpn_dns = require("network.vpn_dns", str)
if vpn_dns:
    try:
        ipaddress.ip_address(vpn_dns)
    except ValueError as error:
        raise SystemExit(f"{path}: network.vpn_dns must be an IP address") from error

image_pattern = re.compile(r"^[a-z0-9.-]+/[^\s]+:[^\s]+$")
fixed_images = [
    require("runner.image"),
    require("runner.default_job_image"),
    require("frontend.node_image"),
    require("frontend.playwright_image"),
    require("frontend.curl_image"),
]
for image in fixed_images:
    if not image_pattern.fullmatch(image):
        raise SystemExit(f"{path}: image is not registry-qualified: {image}")
    if image.endswith((":latest", ":alpine")) or "*" in image:
        raise SystemExit(f"{path}: image is not pinned: {image}")

allowed = require("runner.allowed_images", list)
expected_allowed = [
    "docker.io/library/node:*",
    "mcr.microsoft.com/playwright:*",
    "docker.io/curlimages/curl:*",
]
if allowed != expected_allowed:
    raise SystemExit(f"{path}: allowed_images does not match the frontend allowlist")
for image in allowed:
    if not image_pattern.fullmatch(image):
        raise SystemExit(f"{path}: allowed image is not registry-qualified")

for forbidden_key in (
    "token", "runner_token", "registration_token", "vpn_private_key",
    "private_key",
):
    if forbidden_key in config or forbidden_key in config.get("runner", {}):
        raise SystemExit(f"{path}: forbidden secret key: {forbidden_key}")

if os.environ["REJECT_PLACEHOLDERS"] == "true":
    rendered = yaml.safe_dump(config)
    if "REPLACE_" in rendered:
        raise SystemExit(f"{path}: replace all REPLACE_* placeholders before use")

print(f"Stack schema valid: {path}")
PY

if command -v ansible-playbook >/dev/null 2>&1; then
  ansible-playbook \
    -i "${PROJECT_ROOT}/inventory/localhost.yml" \
    "${PROJECT_ROOT}/playbooks/gitlab-runner.yml" \
    --syntax-check \
    --extra-vars "stack_config=${config_to_validate} stack_name=${STACK_NAME}"
else
  info "ansible-playbook not installed; schema validation completed, syntax check skipped."
fi
