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

if not isinstance(config, dict):
    raise SystemExit(f"{path}: configuration must be a mapping")


def require(path_string, expected_type=None):
    value = config
    for key in path_string.split("."):
        if not isinstance(value, dict) or key not in value:
            raise SystemExit(f"{path}: missing {path_string}")
        value = value[key]
    if expected_type is not None and not isinstance(value, expected_type):
        raise SystemExit(f"{path}: {path_string} has the wrong type")
    return value


def require_string(path_string):
    value = require(path_string, str)
    if not value:
        raise SystemExit(f"{path}: {path_string} must not be empty")
    return value


def validate_fixed_images(images):
    for image in images:
        if not image_pattern.fullmatch(image):
            raise SystemExit(f"{path}: image is not registry-qualified: {image}")
        tag = image.rsplit(":", maxsplit=1)[1]
        if tag in {"latest", "alpine"} or tag.endswith("-latest") or "*" in image:
            raise SystemExit(f"{path}: image is not pinned: {image}")


def validate_image_allowlist(actual, expected, field):
    if actual != expected:
        raise SystemExit(f"{path}: {field} does not match the {stack_id} allowlist")
    for image in actual:
        if not isinstance(image, str) or not image_pattern.fullmatch(image):
            raise SystemExit(f"{path}: allowed image is not registry-qualified")


required_strings = [
    "stack.type", "stack.id", "stack.description", "gitlab.url",
    "gitlab.hostname", "gitlab.health_url", "runner.name", "runner.user",
    "runner.container_name", "runner.service_name", "runner.image",
    "runner.memory", "runner.pull_policy", "runner.default_job_image",
    "network.vpn_interface",
]
for field in required_strings:
    require_string(field)

if require("stack.type") != "gitlab-runner":
    raise SystemExit(f"{path}: unsupported stack.type")
stack_id = require("stack.id")
if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", stack_id):
    raise SystemExit(f"{path}: unsafe stack.id")
network_config = require("network", dict)
network_validation_image = network_config.get("validation_image")
if network_validation_image is None and stack_id == "frontend":
    network_validation_image = config.get("frontend", {}).get("curl_image")
    if network_validation_image is not None:
        print(
            f"{path}: frontend.curl_image is deprecated; "
            "move it to network.validation_image",
            file=sys.stderr,
        )
if network_validation_image is None:
    network_validation_image = "docker.io/curlimages/curl:8.12.1"
    print(
        f"{path}: add network.validation_image; using the migration default",
        file=sys.stderr,
    )
if not isinstance(network_validation_image, str) or not network_validation_image:
    raise SystemExit(f"{path}: missing network.validation_image")
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
common_fixed_images = [
    require("runner.image"),
    require("runner.default_job_image"),
    network_validation_image,
]
validate_fixed_images(common_fixed_images)
if not network_validation_image.startswith("docker.io/curlimages/curl:"):
    raise SystemExit(f"{path}: network.validation_image must use the curlimages repository")

if stack_id == "frontend":
    validate_image_allowlist(
        require("runner.allowed_images", list),
        [
            "docker.io/library/node:*",
            "mcr.microsoft.com/playwright:*",
            "docker.io/curlimages/curl:*",
        ],
        "runner.allowed_images",
    )
elif stack_id == "dotnet":
    if not require("runner.default_job_image").startswith(
        "mcr.microsoft.com/dotnet/sdk:"
    ):
        raise SystemExit(f"{path}: default job image must use the .NET SDK repository")
    validate_image_allowlist(
        require("runner.allowed_images", list),
        [
            "mcr.microsoft.com/dotnet/sdk:*",
            "mcr.microsoft.com/dotnet/runtime:*",
            "mcr.microsoft.com/dotnet/aspnet:*",
        ],
        "runner.allowed_images",
    )
    validate_image_allowlist(
        require("runner.allowed_services", list),
        ["mcr.microsoft.com/mssql/server:*"],
        "runner.allowed_services",
    )
else:
    raise SystemExit(f"{path}: unsupported stack.id: {stack_id}")

forbidden_keys = {
    "token", "runner_token", "registration_token", "vpn_private_key",
    "private_key", "password",
}


def reject_forbidden_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).lower() in forbidden_keys:
                raise SystemExit(f"{path}: forbidden secret key: {key}")
            reject_forbidden_keys(child)
    elif isinstance(value, list):
        for child in value:
            reject_forbidden_keys(child)


reject_forbidden_keys(config)

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
