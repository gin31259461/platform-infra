"""Subprocess execution adapter."""

from __future__ import annotations

import subprocess
from collections.abc import Mapping

from platform_infra.domain.errors import CommandExecutionError
from platform_infra.domain.models import Command, CommandResult


class SubprocessExecutor:
    """Execute commands with ``subprocess`` and no shell evaluation."""

    def __init__(self, base_environment: Mapping[str, str]) -> None:
        self._base_environment = dict(base_environment)

    def execute(self, command: Command) -> CommandResult:
        environment = self._base_environment.copy()
        environment.update(dict(command.environment))
        try:
            completed = subprocess.run(
                command.arguments,
                cwd=command.working_directory,
                env=environment,
                input=command.standard_input,
                text=True,
                capture_output=command.capture_output,
                check=False,
            )
        except OSError as exc:
            executable = command.arguments[0]
            raise CommandExecutionError(
                f"Unable to execute {executable}: {exc}"
            ) from exc

        result = CommandResult(
            return_code=completed.returncode,
            standard_output=completed.stdout or "",
            standard_error=completed.stderr or "",
        )
        if result.return_code != 0:
            detail = result.standard_error.strip() or result.standard_output.strip()
            rendered = " ".join(command.arguments)
            suffix = f"\n{detail}" if detail else ""
            raise CommandExecutionError(
                "Command failed with exit code "
                f"{result.return_code}: {rendered}{suffix}"
            )
        return result
