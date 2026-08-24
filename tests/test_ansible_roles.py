"""Contract tests for Ansible roles."""

from pathlib import Path
from typing import cast

import pytest
import yaml
from jinja2 import StrictUndefined
from jinja2.nativetypes import NativeEnvironment


def _load_role_tasks(role_name: str) -> list[dict[str, object]]:
    repository_root = Path(__file__).parents[1]
    role_tasks_path = repository_root / "roles" / role_name / "tasks" / "main.yml"
    return cast(
        list[dict[str, object]],
        yaml.safe_load(role_tasks_path.read_text(encoding="utf-8")),
    )


def _task_named(
    tasks: list[dict[str, object]],
    task_name: str,
) -> dict[str, object]:
    return next(task for task in tasks if task.get("name") == task_name)


def _render_native(expression: str, variables: dict[str, object]) -> object:
    environment = NativeEnvironment(undefined=StrictUndefined)
    return environment.from_string(expression).render(variables)


def test_pacman_tasks_separate_package_installation_from_system_upgrade() -> None:
    """Pacman forbids combining package names with a full-system upgrade."""
    tasks = _load_role_tasks("packages")
    pacman_arguments = [
        cast(dict[str, object], task["community.general.pacman"])
        for task in tasks
        if "community.general.pacman" in task
    ]

    assert any("name" in arguments for arguments in pacman_arguments)
    assert any("upgrade" in arguments for arguments in pacman_arguments)
    assert all(
        not {"name", "upgrade"}.issubset(arguments) for arguments in pacman_arguments
    )


def test_missing_runner_account_skips_existing_home_assertion() -> None:
    """A missing getent entry must not be treated as an existing account."""
    task = _task_named(
        _load_role_tasks("runner_user"),
        "Require an existing account to use the configured home",
    )
    condition_value = task["when"]
    conditions = (
        [condition_value]
        if isinstance(condition_value, str)
        else cast(list[str], condition_value)
    )
    variables: dict[str, object] = {
        "ansible_facts": {"getent_passwd": {"missing-runner": None}},
        "runner_account_user": "missing-runner",
    }

    assert all(
        _render_native(f"{{{{ {condition} }}}}", variables) is False
        for condition in conditions
    )


def test_missing_runner_account_has_no_removal_identity() -> None:
    """Removal facts must represent a missing getent entry as absent."""
    task = _task_named(
        _load_role_tasks("runner_remove"),
        "Store removal account facts",
    )
    set_fact_arguments = cast(dict[str, str], task["ansible.builtin.set_fact"])
    variables: dict[str, object] = {
        "ansible_facts": {"getent_passwd": {"missing-runner": None}},
        "removal_runner_user": "missing-runner",
    }

    assert (
        _render_native(set_fact_arguments["removal_runner_exists"], variables) is False
    )
    assert _render_native(set_fact_arguments["removal_runner_uid"], variables) == ""


@pytest.mark.parametrize(
    ("task_name", "runner_start_variable"),
    [
        ("Reject overlapping subordinate UID allocations", "runner_subuid_start"),
        ("Reject overlapping subordinate GID allocations", "runner_subgid_start"),
    ],
)
def test_subordinate_range_compares_string_boundaries_numerically(
    task_name: str,
    runner_start_variable: str,
) -> None:
    """Ansible may preserve computed task variables as unsafe text."""
    task = _task_named(_load_role_tasks("runner_user"), task_name)
    assert_arguments = cast(dict[str, object], task["ansible.builtin.assert"])
    conditions = cast(list[str], assert_arguments["that"])
    variables: dict[str, object] = {
        "desired_range_end": "165535",
        "existing_range_start": "1000",
        "existing_range_end": "2000",
        runner_start_variable: 100000,
    }

    assert all(
        _render_native(f"{{{{ {condition} }}}}", variables) is True
        for condition in conditions
    )

    overlapping_variables = variables | {
        "existing_range_start": "120000",
        "existing_range_end": "130000",
    }
    assert all(
        _render_native(f"{{{{ {condition} }}}}", overlapping_variables) is False
        for condition in conditions
    )
