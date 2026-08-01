#!/usr/bin/env bash
set -Eeuo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

resolve_stack() {
  local requested=${1:-}
  [[ -n ${requested} ]] || die "STACK is required (example: STACK=gitlab-runners/frontend)."
  [[ ${requested} =~ ^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$ ]] ||
    die "Invalid stack name: ${requested}"

  STACK_NAME=${requested}
  STACK_DIR="$(realpath -m -- "${PROJECT_ROOT}/stacks/${STACK_NAME}")"
  local stacks_root
  stacks_root="$(realpath -m -- "${PROJECT_ROOT}/stacks")"
  [[ ${STACK_DIR} == "${stacks_root}/"* ]] || die "Stack path escapes stacks directory."
  [[ -d ${STACK_DIR} ]] || die "Unknown stack: ${STACK_NAME}"

  STACK_CONFIG="${STACK_DIR}/config.yml"
  STACK_EXAMPLE_CONFIG="${STACK_DIR}/config.example.yml"
  [[ -f ${STACK_EXAMPLE_CONFIG} ]] || die "Missing stack example config: ${STACK_EXAMPLE_CONFIG}"
}

resolve_stack_request() {
  local requested=${1:-}
  local instance_id=${2:-}
  resolve_stack "${requested}"
  [[ -z ${instance_id} ]] && return 0

  local workload=${STACK_NAME#gitlab-runners/}
  [[ ${STACK_NAME} == "gitlab-runners/${workload}" ]] ||
    die "Provisioned instances require a supported GitLab Runner Template."
  [[ ${instance_id} =~ ^(frontend|dotnet)-[a-f0-9]{12}$ ]] ||
    die "Invalid provisioned Runner Stack ID."
  [[ ${instance_id} == "${workload}-"* ]] ||
    die "Provisioned Runner Stack ID does not match its Template."

  local provisioned_root
  provisioned_root="$(realpath -m -- "${PROJECT_ROOT}/secrets/provisioned-stacks")"
  STACK_CONFIG="$(realpath -m -- "${provisioned_root}/${instance_id}/config.yml")"
  [[ ${STACK_CONFIG} == "${provisioned_root}/${instance_id}/config.yml" ]] ||
    die "Provisioned Runner Stack path escapes its fixed directory."
  [[ -f ${STACK_CONFIG} && ! -L ${STACK_CONFIG} ]] ||
    die "Missing or unsafe provisioned Runner Stack configuration."
  [[ $(stat --format='%a' -- "${STACK_CONFIG}") == 600 ]] ||
    die "Provisioned Runner Stack configuration must have mode 0600."
}

require_stack_config() {
  [[ -f ${STACK_CONFIG} ]] ||
    die "Missing ${STACK_CONFIG}. Copy config.example.yml to config.yml and edit the placeholders."
}

yaml_value() {
  local dotted_path=$1
  require_command python
  CONFIG_PATH="${STACK_CONFIG}" YAML_DOTTED_PATH="${dotted_path}" python - <<'PY'
import os
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required; run sudo make bootstrap first.")

with open(os.environ["CONFIG_PATH"], encoding="utf-8") as stream:
    value = yaml.safe_load(stream)

for key in os.environ["YAML_DOTTED_PATH"].split("."):
    if not isinstance(value, dict) or key not in value:
        sys.exit(f"Missing config value: {os.environ['YAML_DOTTED_PATH']}")
    value = value[key]

if isinstance(value, bool):
    print(str(value).lower())
elif value is None:
    print("")
elif isinstance(value, (dict, list)):
    sys.exit(f"Config value is not scalar: {os.environ['YAML_DOTTED_PATH']}")
else:
    print(value)
PY
}

yaml_value_optional() {
  local dotted_path=$1
  require_command python
  CONFIG_PATH="${STACK_CONFIG}" YAML_DOTTED_PATH="${dotted_path}" python - <<'PY'
import os
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required; run sudo make bootstrap first.")

with open(os.environ["CONFIG_PATH"], encoding="utf-8") as stream:
    value = yaml.safe_load(stream)

for key in os.environ["YAML_DOTTED_PATH"].split("."):
    if not isinstance(value, dict) or key not in value:
        sys.exit(0)
    value = value[key]

if isinstance(value, bool):
    print(str(value).lower())
elif value is None:
    print("")
elif isinstance(value, (dict, list)):
    sys.exit(f"Config value is not scalar: {os.environ['YAML_DOTTED_PATH']}")
else:
    print(value)
PY
}

yaml_list() {
  local dotted_path=$1
  require_command python
  CONFIG_PATH="${STACK_CONFIG}" YAML_DOTTED_PATH="${dotted_path}" python - <<'PY'
import os
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required; run sudo make bootstrap first.")

with open(os.environ["CONFIG_PATH"], encoding="utf-8") as stream:
    value = yaml.safe_load(stream)

for key in os.environ["YAML_DOTTED_PATH"].split("."):
    if not isinstance(value, dict) or key not in value:
        sys.exit(f"Missing config value: {os.environ['YAML_DOTTED_PATH']}")
    value = value[key]

if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
    sys.exit(f"Config value is not a string list: {os.environ['YAML_DOTTED_PATH']}")
for item in value:
    print(item)
PY
}

yaml_list_optional() {
  local dotted_path=$1
  require_command python
  CONFIG_PATH="${STACK_CONFIG}" YAML_DOTTED_PATH="${dotted_path}" python - <<'PY'
import os
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required; run sudo make bootstrap first.")

with open(os.environ["CONFIG_PATH"], encoding="utf-8") as stream:
    value = yaml.safe_load(stream)

for key in os.environ["YAML_DOTTED_PATH"].split("."):
    if not isinstance(value, dict) or key not in value:
        sys.exit(0)
    value = value[key]

if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
    sys.exit(f"Config value is not a string list: {os.environ['YAML_DOTTED_PATH']}")
for item in value:
    print(item)
PY
}
