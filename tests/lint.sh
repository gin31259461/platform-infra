#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

mapfile -t shell_files < <(find "${PROJECT_ROOT}/scripts" "${PROJECT_ROOT}/tests" \
  -type f -name '*.sh' -print | sort)
mapfile -t yaml_files < <(find "${PROJECT_ROOT}" -type f \
  \( -name '*.yml' -o -name '*.yaml' \) \
  ! -path '*/node_modules/*' \
  ! -path '*/.venv/*' \
  ! -path '*/.next/*' \
  ! -path '*/secrets/*' \
  ! -name 'pnpm-lock.yaml' \
  ! -path '*/stacks/*/config.yml' -print | sort)

command -v shellcheck >/dev/null 2>&1 ||
  {
    echo "shellcheck is required." >&2
    exit 1
  }
command -v uv >/dev/null 2>&1 ||
  {
    echo "uv is required." >&2
    exit 1
  }

for script in "${shell_files[@]}"; do
  bash -n "${script}"
  grep -q '^set -Eeuo pipefail$' "${script}" ||
    {
      echo "Missing strict Bash mode: ${script}" >&2
      exit 1
    }
done

PROJECT_ROOT="${PROJECT_ROOT}" uv run --locked python - <<'PY'
import os
from pathlib import Path

import yaml

for path in Path(os.environ["PROJECT_ROOT"]).glob("roles/**/*.yml"):
    with path.open(encoding="utf-8") as stream:
        content = yaml.safe_load(stream)
    if not isinstance(content, list):
        continue
    for task in content:
        if not isinstance(task, dict):
            continue
        command = task.get("ansible.builtin.command", {})
        argv = command.get("argv", []) if isinstance(command, dict) else []
        if argv and argv[0] == "runuser":
            chdir = task.get("args", {}).get("chdir")
            if chdir != "/home/{{ runner.user }}":
                name = task.get("name", "<unnamed task>")
                raise SystemExit(
                    f"{path}: runuser task lacks Runner-home chdir: {name}"
                )

manager_tasks = (
    Path(os.environ["PROJECT_ROOT"])
    / "roles/gitlab_runner/runner_manager/tasks/main.yml"
)
with manager_tasks.open(encoding="utf-8") as stream:
    for task in yaml.safe_load(stream):
        command = task.get("ansible.builtin.command", {})
        argv = command.get("argv", []) if isinstance(command, dict) else []
        if "enable" in argv:
            raise SystemExit(
                f"{manager_tasks}: generated Quadlet services cannot be enabled"
            )
PY

shellcheck -x "${shell_files[@]}"
uv run --locked yamllint \
  -d '{extends: default, rules: {document-start: disable, line-length: {max: 140}, truthy: disable}}' \
  "${yaml_files[@]}"

uv run --locked ansible-lint "${PROJECT_ROOT}/playbooks/gitlab-runner.yml"

if rg --hidden --glob '!SPEC.md' --glob '!stacks/**/config.yml' \
  'glrt-[A-Za-z0-9_-]{12,}' "${PROJECT_ROOT}"; then
  echo "Possible Runner authentication token found." >&2
  exit 1
fi

if rg --hidden --glob '!SPEC.md' --glob '!docs/**' --glob '!tests/lint.sh' \
  --glob '!stacks/**/config.yml' \
  'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' "${PROJECT_ROOT}"; then
  echo "Possible private key found." >&2
  exit 1
fi

echo "Lint checks passed."
