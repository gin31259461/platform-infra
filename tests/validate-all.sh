#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
found=false

while IFS= read -r example; do
  found=true
  stack_name="${example#"${PROJECT_ROOT}/stacks/"}"
  stack_name="${stack_name%/config.example.yml}"
  "${PROJECT_ROOT}/tests/validate-stack.sh" "${stack_name}"
done < <(find "${PROJECT_ROOT}/stacks" -mindepth 3 -maxdepth 3 \
  -name config.example.yml -type f -print | sort)

[[ ${found} == true ]] || {
  echo "No stacks found." >&2
  exit 1
}

PROJECT_ROOT="${PROJECT_ROOT}" python - <<'PY'
import os
from pathlib import Path

import yaml

root = Path(os.environ["PROJECT_ROOT"])
seen = {}
for path in sorted(root.glob("stacks/*/*/config.example.yml")):
    with path.open(encoding="utf-8") as stream:
        config = yaml.safe_load(stream)
    user = config["runner"]["user"]
    if user in seen:
        raise SystemExit(f"Runner user {user} is shared by {seen[user]} and {path}")
    seen[user] = path
PY

echo "All stacks are valid."
