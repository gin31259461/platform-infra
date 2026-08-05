"""Runner registration behavior."""

from __future__ import annotations

from pathlib import Path

from platform_infra.adapters.yaml_configuration import parse_stack_configuration
from platform_infra.application.runner import RegisterRunner
from tests.fakes import RecordingRegistrar, StaticTokenReader


def test_registration_reads_token_and_delegates_to_automation(
    valid_stack_path: Path,
) -> None:
    configuration = parse_stack_configuration(
        valid_stack_path.read_text(encoding="utf-8"),
        valid_stack_path,
        reject_placeholders=True,
    )
    registrar = RecordingRegistrar()
    token = "glrt-super-secret-token"
    use_case = RegisterRunner(StaticTokenReader(token), registrar)

    use_case.execute(
        configuration,
        "inventory/hosts.yml",
        ask_become_password=False,
    )

    assert registrar.calls == [(configuration, "inventory/hosts.yml", token, False)]
