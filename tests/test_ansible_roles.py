"""Contract tests for Ansible roles."""

import base64
from pathlib import Path
from typing import cast

import pytest
import yaml
from ansible.parsing.dataloader import DataLoader  # type: ignore[import-untyped]
from ansible.template import Templar  # type: ignore[import-untyped]
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


def _render_ansible(expression: str, variables: dict[str, object]) -> object:
    templar = Templar(loader=DataLoader(), variables=variables)
    return templar.template(expression)


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
        assert _render_ansible(expression, variables) == ""


def test_registered_config_preserves_registration_metadata_in_ansible() -> None:
    """Metadata expressions must use Ansible's actual regex escaping rules."""
    task = _task_named(
        _load_role_tasks("runner_manager"),
        "Extract existing Runner registration metadata",
    )
    set_fact_arguments = cast(dict[str, str], task["ansible.builtin.set_fact"])
    encoded_config = base64.b64encode(
        b"[[runners]]\n"
        b"  id = 123\n"
        b'  token = "credential-marker"\n'
        b"  token_obtained_at = 2026-08-24T00:00:00Z\n"
        b"  token_expires_at = 0001-01-01T00:00:00Z\n"
    ).decode("ascii")
    variables: dict[str, object] = {
        "existing_runner_config_file": {"stat": {"exists": True}},
        "existing_runner_config": {"content": encoded_config},
    }

    expected = {
        "runner_existing_id": "123",
        "runner_existing_token": "credential-marker",
        "runner_existing_token_obtained_at": "2026-08-24T00:00:00Z",
        "runner_existing_token_expires_at": "0001-01-01T00:00:00Z",
    }
    assert {
        name: _render_ansible(expression, variables)
        for name, expression in set_fact_arguments.items()
    } == expected


def test_registration_uses_persisted_credential_instead_of_display_name() -> None:
    """A matching registration may use a GitLab-managed display name."""
    tasks = _load_role_tasks("runner_registration")
    metadata_task = _task_named(
        tasks,
        "Derive persisted registration metadata without exposing token output",
    )
    state_task = _task_named(
        tasks,
        "Derive existing registration state without exposing token output",
    )
    metadata_arguments = cast(
        dict[str, str],
        metadata_task["ansible.builtin.set_fact"],
    )
    state_arguments = cast(dict[str, str], state_task["ansible.builtin.set_fact"])
    encoded_config = base64.b64encode(
        b"[[runners]]\n"
        b'  name = "arch"\n'
        b'  token = "credential-marker"\n'
        b'  executor = "docker"\n'
    ).decode("ascii")
    variables: dict[str, object] = {
        "runner": {"name": "A-frontend-podman"},
        "runner_registration_token": "credential-marker",
        "runner_registration_config_file": {"stat": {"exists": True}},
        "runner_registration_config": {"content": encoded_config},
    }
    metadata = {
        name: _render_ansible(expression, variables)
        for name, expression in metadata_arguments.items()
    }
    variables.update(metadata)

    assert metadata == {
        "runner_registration_count": "1",
        "runner_registration_tokens": ["credential-marker"],
    }
    assert {
        name: _render_ansible(expression, variables)
        for name, expression in state_arguments.items()
    } == {
        "runner_registration_present": True,
        "runner_registration_compatible": True,
    }


def test_runner_lint_is_guarded_by_cli_feature_detection() -> None:
    """Pinned Runner releases may not provide the lint command."""
    tasks = _load_role_tasks("runner_validation")
    help_task = _task_named(tasks, "Read Runner CLI commands")
    help_command = cast(dict[str, object], help_task["ansible.builtin.command"])
    help_argv = cast(list[str], help_command["argv"])
    lint_task = _task_named(tasks, "Lint Runner configuration when supported")

    assert help_argv[-2:] == ["gitlab-runner", "--help"]
    assert help_task["register"] == "runner_cli_help"
    assert "runner_cli_help.stdout_lines" in cast(str, lint_task["when"])


def test_runner_validation_requires_persisted_registration_before_verify() -> None:
    """Connectivity verification must not depend on CLI list output formatting."""
    tasks = _load_role_tasks("runner_validation")
    count_task = _task_named(
        tasks,
        "Derive persisted Runner registration count",
    )
    verify_task = _task_named(tasks, "Verify registered Runner connectivity")
    set_fact_arguments = cast(
        dict[str, str],
        count_task["ansible.builtin.set_fact"],
    )
    encoded_config = base64.b64encode(
        b'[[runners]]\n  token = "credential-marker"\n'
    ).decode("ascii")
    variables: dict[str, object] = {
        "runner_validation_config_file": {"stat": {"exists": True}},
        "runner_validation_config": {"content": encoded_config},
    }

    assert (
        _render_ansible(
            set_fact_arguments["runner_validation_registration_count"],
            variables,
        )
        == "1"
    )
    assert "when" not in verify_task
    assert not any(task.get("name") == "List registered Runners" for task in tasks)


def test_runner_status_detects_registration_independently_of_display_name() -> None:
    """A valid dedicated registration may retain its GitLab display name."""
    task = _task_named(
        _load_role_tasks("runner_status"),
        "Derive registration status without exposing token output",
    )
    set_fact_arguments = cast(dict[str, str], task["ansible.builtin.set_fact"])
    encoded_config = base64.b64encode(
        b'[[runners]]\n  name = "group-runner"\n  executor = "docker"\n'
    ).decode("ascii")
    variables: dict[str, object] = {
        "runner": {"name": "A-frontend-podman"},
        "runner_status_config_file": {"stat": {"exists": True}},
        "runner_status_config": {"content": encoded_config},
    }

    assert (
        _render_ansible(
            set_fact_arguments["runner_status_registered"],
            variables,
        )
        is True
    )


def test_runner_status_uses_persisted_registration_when_probe_is_unavailable() -> None:
    """Registration state must not depend on a running manager container."""
    tasks = _load_role_tasks("runner_status")
    task = _task_named(
        tasks,
        "Derive registration status without exposing token output",
    )
    read_task = _task_named(tasks, "Read persisted Runner configuration")
    set_fact_arguments = cast(dict[str, str], task["ansible.builtin.set_fact"])
    encoded_config = base64.b64encode(
        b'concurrent = 1\n\n[[runners]]\n  executor = "docker"\n'
    ).decode("ascii")
    variables: dict[str, object] = {
        "runner_status_config_file": {"stat": {"exists": True}},
        "runner_status_config": {"content": encoded_config},
    }

    assert read_task["no_log"] is True
    assert task["no_log"] is True
    assert (
        _render_ansible(
            set_fact_arguments["runner_status_registered"],
            variables,
        )
        is True
    )


def test_runner_status_reports_missing_configuration_as_unregistered() -> None:
    """A host without persisted Runner configuration is not registered."""
    task = _task_named(
        _load_role_tasks("runner_status"),
        "Derive registration status without exposing token output",
    )
    set_fact_arguments = cast(dict[str, str], task["ansible.builtin.set_fact"])

    assert (
        _render_ansible(
            set_fact_arguments["runner_status_registered"],
            {"runner_status_config_file": {"stat": {"exists": False}}},
        )
        is False
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
