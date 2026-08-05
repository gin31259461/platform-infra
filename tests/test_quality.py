"""Tests for repository quality orchestration."""

from pathlib import Path

from platform_infra.domain.models import Command, CommandResult
from platform_infra.quality import run_quality


class RecordingExecutor:
    """Record commands without creating real processes."""

    def __init__(self) -> None:
        self.commands: list[Command] = []

    def execute(self, command: Command) -> CommandResult:
        """Record one command."""

        self.commands.append(command)
        return CommandResult(
            return_code=0,
            standard_output="",
            standard_error="",
        )


def test_quality_steps_run_in_order() -> None:
    executor = RecordingExecutor()
    project_root = Path("/repository")

    run_quality(
        project_root,
        executor,
        fix=True,
    )

    assert [command.arguments for command in executor.commands] == [
        ("ruff", "format", "."),
        ("ruff", "check", "."),
        ("mypy",),
        ("pytest", "--cov", "--cov-report=term-missing"),
        ("yamllint", "."),
        ("ansible-lint",),
        ("platform-infra", "validate-all"),
    ]

    assert all(
        command.working_directory == project_root for command in executor.commands
    )
