"""Application ports implemented by infrastructure adapters."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Protocol

from platform_infra.domain.models import Command, CommandResult, StackConfiguration


class FileSystem(Protocol):
    """Filesystem operations required by application use cases."""

    def exists(self, path: Path) -> bool:
        """Return whether a path exists."""
        ...

    def glob(self, root: Path, pattern: str) -> Iterable[Path]:
        """Find paths below a root."""
        ...

    def is_file(self, path: Path) -> bool:
        """Return whether a path is a regular file."""
        ...

    def read_text(self, path: Path) -> str:
        """Read UTF-8 text."""
        ...


class ProcessExecutor(Protocol):
    """Execute external processes without invoking a shell."""

    def execute(self, command: Command) -> CommandResult:
        """Execute one command and return its result."""
        ...


class TokenReader(Protocol):
    """Read a GitLab Runner authentication token."""

    def read(self) -> str:
        """Return the token without logging it."""
        ...


class StackConfigurationParser(Protocol):
    """Convert an external stack document into a validated domain model."""

    def parse(
        self,
        document: str,
        source_path: Path,
        *,
        reject_placeholders: bool,
    ) -> StackConfiguration:
        """Parse and validate one stack document."""
        ...
