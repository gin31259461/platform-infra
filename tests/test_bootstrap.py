"""Standard-library bootstrap behavior."""

from __future__ import annotations

from pathlib import Path

import pytest

from bootstrap import (
    BootstrapPaths,
    OperatingSystem,
    bootstrap_control_node,
    package_install_commands,
    read_operating_system,
)
from tests.fakes import RecordingBootstrapRunner


def test_read_operating_system(tmp_path: Path) -> None:
    os_release = tmp_path / "os-release"
    os_release.write_text(
        'ID="ubuntu"\nID_LIKE="debian"\n',
        encoding="utf-8",
    )

    operating_system = read_operating_system(os_release)

    assert operating_system == OperatingSystem("ubuntu", ("debian",))


def test_debian_refreshes_metadata_before_installing_packages() -> None:
    commands = package_install_commands(OperatingSystem("ubuntu", ("debian",)))

    assert commands[0] == ("apt-get", "update")
    assert commands[1][0] == "apt-get"
    assert "python3-venv" in commands[1]


def test_select_redhat_package_manager() -> None:
    commands = package_install_commands(OperatingSystem("almalinux", ("rhel",)))

    assert commands[0][0] == "dnf"
    assert "python3" in commands[0]


def test_bootstrap_injects_sudo_and_executable_locations(tmp_path: Path) -> None:
    os_release = tmp_path / "os-release"
    os_release.write_text('ID="debian"\n', encoding="utf-8")
    virtual_environment = tmp_path / ".bootstrap-venv"
    (virtual_environment / "bin").mkdir(parents=True)
    runner = RecordingBootstrapRunner()
    executable_paths = {
        "sudo": "/usr/bin/sudo",
        "python3": "/usr/bin/python3",
    }

    bootstrap_control_node(
        BootstrapPaths(tmp_path, virtual_environment, os_release),
        runner,
        effective_user_id=1000,
        executable_locator=executable_paths.get,
    )

    assert runner.calls[0][0][:3] == (
        "/usr/bin/sudo",
        "apt-get",
        "update",
    )
    assert runner.calls[-1][0][-2:] == (
        "platform-infra",
        "setup",
    )


def test_reject_unsupported_control_node_distribution() -> None:
    with pytest.raises(ValueError, match="Unsupported"):
        package_install_commands(OperatingSystem("alpine", ()))
