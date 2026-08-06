"""Explicit fakes used by behavior tests."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from platform_infra.domain.models import Command, CommandResult, StackConfiguration


@dataclass(slots=True)
class RecordingExecutor:
    """Record commands and return queued results."""

    results: list[CommandResult] = field(default_factory=list)
    commands: list[Command] = field(default_factory=list)

    def execute(self, command: Command) -> CommandResult:
        self.commands.append(command)
        if self.results:
            return self.results.pop(0)
        return CommandResult(0, "", "")


@dataclass(frozen=True, slots=True)
class StaticTokenReader:
    """Return one fixed token."""

    token: str

    def read(self) -> str:
        return self.token


class UnexpectedTokenReader:
    """Fail when a test unexpectedly requests a token."""

    def read(self) -> str:
        raise AssertionError("Token input must not be requested")


@dataclass(slots=True)
class RecordingRegistrar:
    """Record Runner registration requests."""

    calls: list[tuple[StackConfiguration, str, str, bool]] = field(default_factory=list)

    def register(
        self,
        configuration: StackConfiguration,
        inventory: str,
        token: str,
        *,
        ask_become_password: bool,
    ) -> None:
        self.calls.append((configuration, inventory, token, ask_become_password))


@dataclass(slots=True)
class RecordingBootstrapRunner:
    """Record standalone bootstrap commands."""

    calls: list[tuple[tuple[str, ...], Path]] = field(default_factory=list)

    def run(
        self,
        arguments: tuple[str, ...],
        working_directory: Path,
    ) -> None:
        self.calls.append((arguments, working_directory))
