"""Contract tests for Ansible roles."""

import base64
import re
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


def _mapping_field(
    mapping: dict[str, object],
    field_name: str,
) -> dict[str, object]:
    return cast(dict[str, object], mapping[field_name])


def _task_named(
    tasks: list[dict[str, object]],
    task_name: str,
) -> dict[str, object]:
    return next(task for task in tasks if task.get("name") == task_name)


def _render_native(expression: str, variables: dict[str, object]) -> object:
    environment = NativeEnvironment(undefined=StrictUndefined)
    return environment.from_string(expression).render(variables)


def _decode_base64(value: str) -> str:
    return base64.b64decode(value).decode("utf-8")


def _regex_findall(value: str, pattern: str) -> list[str]:
    return re.findall(pattern, value)


def _render_runner_manager_fact(
    expression: str,
    variables: dict[str, object],
) -> object:
    environment = NativeEnvironment(undefined=StrictUndefined)
    environment.filters["b64decode"] = _decode_base64
    environment.filters["regex_findall"] = _regex_findall
    return environment.from_string(expression).render(variables)


def test_local_inventory_uses_system_python_for_become_user_tasks() -> None:
    """Runner accounts cannot execute a controller virtualenv under a private home."""
    repository_root = Path(__file__).parents[1]
    inventory_path = repository_root / "inventory" / "localhost.yml"
    inventory = cast(
        dict[str, object],
        yaml.safe_load(inventory_path.read_text(encoding="utf-8")),
    )
    all_group = _mapping_field(inventory, "all")
    children = _mapping_field(all_group, "children")
    runner_hosts = _mapping_field(children, "runner_hosts")
    hosts = _mapping_field(runner_hosts, "hosts")
    localhost = _mapping_field(hosts, "localhost")

    assert localhost.get("ansible_python_interpreter") == "/usr/bin/python3"


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


@pytest.mark.parametrize(
    ("variable_file", "expected_executable"),
    [
        ("Archlinux.yml", "/usr/lib/podman/aardvark-dns"),
        ("Debian.yml", "aardvark-dns"),
        ("RedHat.yml", "aardvark-dns"),
    ],
)
def test_aardvark_dns_uses_distribution_executable(
    variable_file: str,
    expected_executable: str,
) -> None:
    """Use the aardvark-dns path supplied by each distribution package."""
    repository_root = Path(__file__).parents[1]
    variable_path = repository_root / "roles" / "packages" / "vars" / variable_file
    distribution_variables = cast(
        dict[str, object],
        yaml.safe_load(variable_path.read_text(encoding="utf-8")),
    )
    task = _task_named(
        _load_role_tasks("rootless_podman"),
        "Read aardvark-dns version",
    )
    command_arguments = cast(dict[str, object], task["ansible.builtin.command"])
    argv = cast(list[str], command_arguments["argv"])

    assert argv[0] == "{{ runner_aardvark_dns_executable }}"
    assert (
        distribution_variables["runner_aardvark_dns_executable"] == expected_executable
    )


def test_unregistered_config_has_empty_registration_metadata() -> None:
    """Missing metadata must not require a regex backreference match."""
    task = _task_named(
        _load_role_tasks("runner_manager"),
        "Extract existing Runner registration metadata",
    )
    set_fact_arguments = cast(dict[str, str], task["ansible.builtin.set_fact"])
    encoded_config = base64.b64encode(b"concurrent = 1\n").decode("ascii")
    variables: dict[str, object] = {
        "existing_runner_config_file": {"stat": {"exists": True}},
        "existing_runner_config": {"content": encoded_config},
    }

    for expression in set_fact_arguments.values():
        assert "regex_search" not in expression
        assert _render_runner_manager_fact(expression, variables) == ""


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
