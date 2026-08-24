"""Contract tests for Ansible roles."""

from pathlib import Path
from typing import cast

import yaml


def test_pacman_tasks_separate_package_installation_from_system_upgrade() -> None:
    """Pacman forbids combining package names with a full-system upgrade."""
    repository_root = Path(__file__).parents[1]
    role_tasks_path = repository_root / "roles" / "packages" / "tasks" / "main.yml"
    tasks = cast(
        list[dict[str, object]],
        yaml.safe_load(role_tasks_path.read_text(encoding="utf-8")),
    )
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
