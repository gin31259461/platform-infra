"""Command-line entry point and dependency composition root."""

from __future__ import annotations

import argparse
import getpass
import logging
import os
import sys
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import cast

from platform_infra.adapters.filesystem import LocalFileSystem
from platform_infra.adapters.process import SubprocessExecutor
from platform_infra.adapters.token_input import EnvironmentOrPromptTokenReader
from platform_infra.adapters.yaml_configuration import YamlStackConfigurationParser
from platform_infra.application.ansible import AnsibleAutomation
from platform_infra.application.ports import TokenReader
from platform_infra.application.runner import RegisterRunner
from platform_infra.application.stacks import StackRepository
from platform_infra.domain.errors import PlatformInfraError


class ParsedArguments(argparse.Namespace):
    """Typed view of values produced by the CLI parser."""

    command: str
    project_root: Path
    verbose: bool
    stack: str | None
    inventory: str
    no_ask_become_pass: bool
    purge: bool
    yes: bool


class CommandName(StrEnum):
    """Supported public CLI operations."""

    SETUP = "setup"
    VALIDATE = "validate"
    VALIDATE_ALL = "validate-all"
    CHECK = "check"
    INSTALL = "install"
    REGISTER = "register"
    VERIFY = "verify"
    STATUS = "status"
    UNINSTALL = "uninstall"
    IDEMPOTENCY = "idempotency"


@dataclass(frozen=True, slots=True)
class CliRequest:
    """Validated command-line input."""

    command: CommandName
    project_root: Path
    verbose: bool
    stack: str | None
    inventory: str
    ask_become_password: bool
    purge: bool
    confirmed: bool


def build_parser() -> argparse.ArgumentParser:
    """Build the public CLI parser."""

    parser = argparse.ArgumentParser(
        prog="platform-infra",
        description="Deploy isolated GitLab Runners with Ansible and rootless Podman.",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path.cwd(),
        help="Repository root. Defaults to the current directory.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable debug logging without exposing secret values.",
    )
    parser.set_defaults(
        stack=None,
        inventory="inventory/localhost.yml",
        no_ask_become_pass=False,
        purge=False,
        yes=False,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser(CommandName.SETUP, help="Install pinned Ansible collections.")

    validate = subparsers.add_parser(CommandName.VALIDATE, help="Validate one stack.")
    _add_stack_argument(validate)

    subparsers.add_parser(
        CommandName.VALIDATE_ALL,
        help="Validate every local or example stack.",
    )

    for command_name in (
        CommandName.CHECK,
        CommandName.INSTALL,
        CommandName.REGISTER,
        CommandName.VERIFY,
        CommandName.STATUS,
        CommandName.IDEMPOTENCY,
    ):
        command_parser = subparsers.add_parser(
            command_name,
            help=f"Run the {command_name} workflow.",
        )
        _add_stack_argument(command_parser)
        _add_inventory_argument(command_parser)
        _add_become_argument(command_parser)

    uninstall = subparsers.add_parser(
        CommandName.UNINSTALL,
        help="Remove a Runner host stack.",
    )
    _add_stack_argument(uninstall)
    _add_inventory_argument(uninstall)
    _add_become_argument(uninstall)
    uninstall.add_argument(
        "--purge",
        action="store_true",
        help="Also remove the Runner account, home, cache, and registration.",
    )
    uninstall.add_argument(
        "--yes",
        action="store_true",
        help="Confirm the destructive operation non-interactively.",
    )
    return parser


def parse_request(arguments: list[str] | None = None) -> CliRequest:
    """Parse untyped argparse output into a validated request model."""

    parsed = cast(
        ParsedArguments,
        build_parser().parse_args(arguments),
    )
    return CliRequest(
        command=CommandName(parsed.command),
        project_root=parsed.project_root.resolve(),
        verbose=parsed.verbose,
        stack=parsed.stack,
        inventory=parsed.inventory,
        ask_become_password=not parsed.no_ask_become_pass,
        purge=parsed.purge,
        confirmed=parsed.yes,
    )


def main(arguments: list[str] | None = None) -> int:
    """Compose dependencies and translate expected failures to exit codes."""

    logger = logging.getLogger("platform_infra")
    try:
        request = parse_request(arguments)
        logging.basicConfig(
            level=logging.DEBUG if request.verbose else logging.INFO,
            format="%(levelname)s %(message)s",
        )
        filesystem = LocalFileSystem()
        executor = SubprocessExecutor(os.environ)
        token_reader = EnvironmentOrPromptTokenReader(os.environ, getpass.getpass)
        return dispatch_request(
            request,
            logger,
            StackRepository(
                request.project_root,
                filesystem,
                YamlStackConfigurationParser(),
            ),
            AnsibleAutomation(request.project_root, executor),
            token_reader,
        )
    except PlatformInfraError as exc:
        logger.error("%s", exc)
        return 1
    except KeyboardInterrupt:
        logger.error("Operation cancelled")
        return 130


def dispatch_request(
    request: CliRequest,
    logger: logging.Logger,
    repository: StackRepository,
    ansible: AnsibleAutomation,
    token_reader: TokenReader,
) -> int:
    """Dispatch one validated CLI request through injected dependencies."""

    register_runner = RegisterRunner(token_reader, ansible)

    if request.command is CommandName.SETUP:
        ansible.install_collections()
        logger.info("Pinned Ansible collections installed")
        return 0
    if request.command is CommandName.VALIDATE_ALL:
        configurations = repository.validate_all()
        for configuration in configurations:
            ansible.syntax_check(configuration)
        logger.info("Validated %d stack configurations", len(configurations))
        return 0

    stack_reference = _required_stack(request)
    require_local = request.command is not CommandName.VALIDATE
    configuration = repository.load(
        stack_reference,
        require_local=require_local,
        reject_placeholders=require_local,
    )

    if request.command is CommandName.VALIDATE:
        ansible.syntax_check(configuration)
        logger.info("Stack configuration is valid: %s", configuration.source_path)
    elif request.command is CommandName.REGISTER:
        register_runner.execute(
            configuration,
            request.inventory,
            ask_become_password=request.ask_become_password,
        )
        logger.info("Runner registration completed")
    elif request.command is CommandName.STATUS:
        ansible.status(
            configuration,
            request.inventory,
            ask_become_password=request.ask_become_password,
        )
    elif request.command is CommandName.CHECK:
        ansible.check(
            configuration,
            request.inventory,
            ask_become_password=request.ask_become_password,
        )
    elif request.command is CommandName.INSTALL:
        ansible.install(
            configuration,
            request.inventory,
            ask_become_password=request.ask_become_password,
        )
    elif request.command is CommandName.VERIFY:
        ansible.verify(
            configuration,
            request.inventory,
            ask_become_password=request.ask_become_password,
        )
    elif request.command is CommandName.IDEMPOTENCY:
        ansible.assert_idempotent(
            configuration,
            request.inventory,
            ask_become_password=request.ask_become_password,
        )
    elif request.command is CommandName.UNINSTALL:
        if not request.confirmed:
            raise PlatformInfraError("Pass --yes to confirm uninstall")
        ansible.uninstall(
            configuration,
            request.inventory,
            ask_become_password=request.ask_become_password,
            purge=request.purge,
        )
    else:
        raise PlatformInfraError(f"Unsupported command: {request.command}")
    return 0


def _required_stack(request: CliRequest) -> str:
    if request.stack is None:
        raise PlatformInfraError(f"--stack is required for {request.command}")
    return request.stack


def _add_stack_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--stack",
        required=True,
        help="Stack name such as gitlab-runners/frontend or an explicit YAML path.",
    )


def _add_inventory_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--inventory",
        default="inventory/localhost.yml",
        help="Ansible inventory path.",
    )


def _add_become_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--no-ask-become-pass",
        action="store_true",
        help="Do not ask for a sudo become password.",
    )


if __name__ == "__main__":
    sys.exit(main())
