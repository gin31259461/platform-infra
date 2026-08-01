#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_TMPDIR="$(mktemp -d)"
trap 'rm -rf -- "${TEST_TMPDIR}"' EXIT

PROJECT_ROOT="${PROJECT_ROOT}" TEST_TMPDIR="${TEST_TMPDIR}" uv run --locked python - <<'PY'
import os
import subprocess
import sys
import tomllib
from pathlib import Path

import jinja2

root = Path(os.environ["PROJECT_ROOT"])
tmpdir = Path(os.environ["TEST_TMPDIR"])

template_path = (
    root
    / "roles/gitlab_runner/runner_manager/templates/runner.container.j2"
)
environment = jinja2.Environment(
    loader=jinja2.FileSystemLoader(template_path.parent),
    keep_trailing_newline=True,
)
environment.filters["bool"] = bool
template = environment.get_template(template_path.name)
template_vars = {
    "stack": {"description": "Test Runner"},
    "runner": {
        "image": "docker.io/gitlab/gitlab-runner:v18.10.1",
        "container_name": "test-runner",
        "user": "gitlab-runner-test",
    },
    "runner_uid": 1001,
    "gitlab_runner_timezone": "Asia/Taipei",
    "network": {
        "use_host_network_for_runner_manager": True,
        "vpn_dns": "100.100.100.100",
    },
}

rendered = template.render(**template_vars)
if "DNS=100.100.100.100" not in rendered.splitlines():
    raise SystemExit("Runner manager Quadlet does not render the configured VPN DNS.")

template_vars["network"]["vpn_dns"] = ""
rendered_without_dns = template.render(**template_vars)
if any(line.startswith("DNS=") for line in rendered_without_dns.splitlines()):
    raise SystemExit("Runner manager Quadlet renders DNS when vpn_dns is empty.")

reconciler = root / "scripts/reconcile-runner-config.py"
config_path = tmpdir / "config.toml"
original_token = "test-token-that-must-be-preserved"
config_path.write_text(
    f"""concurrent = 1

[[runners]]
  name = "test"
  token = "{original_token}"
  executor = "docker"
  [runners.docker]
    image = "docker.io/library/node:22.22.0-bookworm"
    dns = ["192.168.18.1"]
    privileged = false
""",
    encoding="utf-8",
)
config_path.chmod(0o600)

first = subprocess.run(
    [
        sys.executable,
        str(reconciler),
        "--config",
        str(config_path),
        "--dns",
        "100.100.100.100",
    ],
    check=True,
    capture_output=True,
    text=True,
)
if first.stdout.strip() != "changed":
    raise SystemExit("Runner DNS reconciliation did not report a change.")

with config_path.open("rb") as stream:
    config = tomllib.load(stream)
runner = config["runners"][0]
if runner["token"] != original_token:
    raise SystemExit("Runner DNS reconciliation changed the token.")
if runner["docker"]["dns"] != ["100.100.100.100"]:
    raise SystemExit("Runner job DNS was not reconciled.")
if config_path.stat().st_mode & 0o777 != 0o600:
    raise SystemExit("Runner config permissions changed during reconciliation.")

second = subprocess.run(
    [
        sys.executable,
        str(reconciler),
        "--config",
        str(config_path),
        "--dns",
        "100.100.100.100",
    ],
    check=True,
    capture_output=True,
    text=True,
)
if second.stdout.strip() != "unchanged":
    raise SystemExit("Runner DNS reconciliation is not idempotent.")
PY

echo "VPN DNS regression tests passed."
