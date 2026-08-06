"""CLI boundary parsing behavior."""

from __future__ import annotations

from pathlib import Path

from platform_infra.cli import CommandName, parse_request


def test_parse_setup_without_stack(tmp_path: Path) -> None:
    request = parse_request(["--project-root", str(tmp_path), "setup"])

    assert request.command is CommandName.SETUP
    assert request.stack is None
    assert request.project_root == tmp_path.resolve()


def test_parse_install_defaults(tmp_path: Path) -> None:
    request = parse_request(
        [
            "--project-root",
            str(tmp_path),
            "install",
            "--stack",
            "gitlab-runners/frontend",
        ]
    )

    assert request.command is CommandName.INSTALL
    assert request.stack == "gitlab-runners/frontend"
    assert request.inventory == "inventory/localhost.yml"
    assert request.ask_become_password


def test_parse_remote_register_options(tmp_path: Path) -> None:
    request = parse_request(
        [
            "--project-root",
            str(tmp_path),
            "register",
            "--stack",
            "gitlab-runners/frontend",
            "--inventory",
            "inventory/hosts.yml",
            "--no-ask-become-pass",
        ]
    )

    assert request.command is CommandName.REGISTER
    assert request.inventory == "inventory/hosts.yml"
    assert not request.ask_become_password
