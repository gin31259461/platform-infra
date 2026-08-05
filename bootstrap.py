#!/usr/bin/env python3
"""Standalone, standard-library-only control-node bootstrap."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

UV_VERSION = "0.12.1"


@dataclass(frozen=True)
class OperatingSystem:
    """Normalized operating-system release identity."""

    __slots__ = ("identifier", "similar_to")

    identifier: str
    similar_to: tuple[str, ...]


@dataclass(frozen=True)
class BootstrapPaths:
    """Filesystem locations used by the standalone bootstrap."""

    __slots__ = ("os_release", "project_root", "virtual_environment")

    project_root: Path
    virtual_environment: Path
    os_release: Path


class CommandRunner(Protocol):
    """Execute one external command."""

    def run(self, arguments: tuple[str, ...], working_directory: Path) -> None:
        """Run arguments without shell evaluation."""
        ...


class SubprocessCommandRunner:
    """Standard-library command runner."""

    __slots__ = ()

    def run(self, arguments: tuple[str, ...], working_directory: Path) -> None:
        completed = subprocess.run(
            arguments,
            cwd=working_directory,
            check=False,
        )
        if completed.returncode != 0:
            rendered = " ".join(arguments)
            raise RuntimeError(
                f"Command failed with exit code {completed.returncode}: {rendered}"
            )


def main() -> int:
    """Compose bootstrap dependencies and translate failures to an exit code."""

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logger = logging.getLogger("platform_infra.bootstrap")
    project_root = Path(__file__).resolve().parent
    paths = BootstrapPaths(
        project_root=project_root,
        virtual_environment=project_root / ".bootstrap-venv",
        os_release=Path("/etc/os-release"),
    )
    try:
        bootstrap_control_node(
            paths,
            SubprocessCommandRunner(),
            effective_user_id=os.geteuid(),
            executable_locator=shutil.which,
        )
    except (OSError, RuntimeError, ValueError) as exc:
        logger.error("Bootstrap failed: %s", exc)
        return 1

    logger.info("Bootstrap completed")
    logger.info("Commit the generated uv.lock, then run the quality commands")
    return 0


def bootstrap_control_node(
    paths: BootstrapPaths,
    runner: CommandRunner,
    *,
    effective_user_id: int,
    executable_locator: Callable[[str], str | None],
) -> None:
    """Install native prerequisites, uv, project dependencies, and collections."""

    operating_system = read_operating_system(paths.os_release)
    sudo_executable = executable_locator("sudo")
    install_operating_system_packages(
        operating_system,
        runner,
        project_root=paths.project_root,
        effective_user_id=effective_user_id,
        sudo_executable=sudo_executable,
    )
    python_executable = executable_locator("python3") or executable_locator("python")
    if python_executable is None:
        raise RuntimeError("Python was not installed successfully")
    uv_executable = install_uv(
        runner,
        paths,
        python_executable=python_executable,
    )
    runner.run((str(uv_executable), "lock"), paths.project_root)
    runner.run(
        (str(uv_executable), "sync", "--locked", "--all-groups"),
        paths.project_root,
    )
    runner.run(
        (
            str(uv_executable),
            "run",
            "--locked",
            "platform-infra",
            "setup",
        ),
        paths.project_root,
    )


def read_operating_system(os_release_path: Path) -> OperatingSystem:
    """Read normalized values from an os-release file."""

    values: dict[str, str] = {}
    try:
        lines = os_release_path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise OSError(f"Unable to read {os_release_path}: {exc}") from exc

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, raw_value = stripped.split("=", 1)
        values[key] = raw_value.strip().strip('"')

    identifier = values.get("ID", "").lower()
    if not identifier:
        raise ValueError(f"{os_release_path} does not define ID")
    similar_to = tuple(
        member.lower() for member in values.get("ID_LIKE", "").split() if member
    )
    return OperatingSystem(identifier=identifier, similar_to=similar_to)


def install_operating_system_packages(
    operating_system: OperatingSystem,
    runner: CommandRunner,
    *,
    project_root: Path,
    effective_user_id: int,
    sudo_executable: str | None,
) -> None:
    """Install the minimal control-node toolchain with the native package manager."""

    commands = package_install_commands(operating_system)
    if effective_user_id == 0:
        for command in commands:
            runner.run(command, project_root)
        return

    if sudo_executable is None:
        raise RuntimeError("sudo is required when bootstrap is not run as root")
    for command in commands:
        runner.run((sudo_executable, *command), project_root)


def package_install_commands(
    operating_system: OperatingSystem,
) -> tuple[tuple[str, ...], ...]:
    """Return native package-manager commands for one supported family."""

    identities = {operating_system.identifier, *operating_system.similar_to}
    if "arch" in identities:
        return (
            (
                "pacman",
                "-Syu",
                "--needed",
                "--noconfirm",
                "ca-certificates",
                "git",
                "openssh",
                "python",
            ),
        )
    if identities.intersection({"debian", "ubuntu"}):
        return (
            ("apt-get", "update"),
            (
                "apt-get",
                "install",
                "--yes",
                "--no-install-recommends",
                "ca-certificates",
                "git",
                "openssh-client",
                "python3",
                "python3-pip",
                "python3-venv",
            ),
        )
    if identities.intersection({"fedora", "rhel", "rocky", "almalinux", "centos"}):
        return (
            (
                "dnf",
                "install",
                "--assumeyes",
                "ca-certificates",
                "git",
                "openssh-clients",
                "python3",
                "python3-pip",
            ),
        )
    raise ValueError(
        "Unsupported control-node distribution. Supported families: "
        "Arch, Debian, and RedHat."
    )


def install_uv(
    runner: CommandRunner,
    paths: BootstrapPaths,
    *,
    python_executable: str,
) -> Path:
    """Install pinned uv in an isolated bootstrap virtual environment."""

    if not paths.virtual_environment.exists():
        runner.run(
            (
                python_executable,
                "-m",
                "venv",
                str(paths.virtual_environment),
            ),
            paths.project_root,
        )
    pip_executable = paths.virtual_environment / "bin" / "pip"
    uv_executable = paths.virtual_environment / "bin" / "uv"
    runner.run(
        (
            str(pip_executable),
            "install",
            "--disable-pip-version-check",
            f"uv=={UV_VERSION}",
        ),
        paths.project_root,
    )
    return uv_executable


if __name__ == "__main__":
    sys.exit(main())
