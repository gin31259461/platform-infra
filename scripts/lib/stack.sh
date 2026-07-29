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
