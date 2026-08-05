"""Ansible orchestration behavior."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from platform_infra.adapters.yaml_configuration import parse_stack_configuration
from platform_infra.application.ansible import AnsibleAutomation
from platform_infra.application.ansible_variables import AnsibleVariables
from platform_infra.domain.errors import CommandExecutionError
from platform_infra.domain.models import CommandResult
from tests.fakes import RecordingExecutor


def test_install_serializes_normalized_configuration(
    tmp_path: Path,
    valid_stack_path: Path,
) -> None:
    configuration = parse_stack_configuration(
        valid_stack_path.read_text(encoding="utf-8"),
        valid_stack_path,
        reject_placeholders=True,
    )
    executor = RecordingExecutor()
    automation = AnsibleAutomation(tmp_path, executor)

    automation.install(
        configuration,
        "inventory/localhost.yml",
        ask_become_password=False,
    )

    command = executor.commands[0]
    extra_vars_index = command.arguments.index("--extra-vars") + 1
    payload = cast(
        AnsibleVariables,
        json.loads(command.arguments[extra_vars_index]),
    )
    assert payload["runner"]["home"] == "/var/lib/gitlab-runner-test"
    assert payload["runner"]["subuid_start"] == 100000
    assert "stack_config_path" not in payload


def test_idempotency_accepts_zero_change_second_pass(
    tmp_path: Path,
    valid_stack_path: Path,
) -> None:
    configuration = parse_stack_configuration(
        valid_stack_path.read_text(encoding="utf-8"),
        valid_stack_path,
        reject_placeholders=True,
    )
    executor = RecordingExecutor(
        results=[
            CommandResult(0, "", ""),
            CommandResult(0, "localhost : ok=10 changed=0 unreachable=0 failed=0", ""),
        ]
    )
    automation = AnsibleAutomation(tmp_path, executor)

    automation.assert_idempotent(
        configuration,
        "inventory/localhost.yml",
        ask_become_password=False,
    )

    assert len(executor.commands) == 2


def test_idempotency_rejects_changed_second_pass(
    tmp_path: Path,
    valid_stack_path: Path,
) -> None:
    configuration = parse_stack_configuration(
        valid_stack_path.read_text(encoding="utf-8"),
        valid_stack_path,
        reject_placeholders=True,
    )
    executor = RecordingExecutor(
        results=[
            CommandResult(0, "", ""),
            CommandResult(0, "localhost : ok=10 changed=1 unreachable=0 failed=0", ""),
        ]
    )
    automation = AnsibleAutomation(tmp_path, executor)

    with pytest.raises(CommandExecutionError, match="idempotency failed"):
        automation.assert_idempotent(
            configuration,
            "inventory/localhost.yml",
            ask_become_password=False,
        )


def test_registration_keeps_token_out_of_process_arguments(
    tmp_path: Path,
    valid_stack_path: Path,
) -> None:
    configuration = parse_stack_configuration(
        valid_stack_path.read_text(encoding="utf-8"),
        valid_stack_path,
        reject_placeholders=True,
    )
    executor = RecordingExecutor()
    automation = AnsibleAutomation(tmp_path, executor)
    token = "glrt-super-secret-token"

    automation.register(
        configuration,
        "inventory/hosts.yml",
        token,
        ask_become_password=False,
    )

    command = executor.commands[0]
    assert token not in command.arguments
    assert command.environment == (("PLATFORM_INFRA_RUNNER_TOKEN", token),)
    assert "playbooks/gitlab-runner-register.yml" in command.arguments
