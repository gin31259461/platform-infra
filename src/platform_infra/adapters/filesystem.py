"""Local filesystem adapter."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from platform_infra.domain.errors import ConfigurationError


class LocalFileSystem:
    """Implement project filesystem reads with ``pathlib``."""

    def exists(self, path: Path) -> bool:
        return path.exists()

    def glob(self, root: Path, pattern: str) -> Iterable[Path]:
        return root.glob(pattern)

    def is_file(self, path: Path) -> bool:
        return path.is_file()

    def read_text(self, path: Path) -> str:
        try:
            return path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ConfigurationError(f"Unable to read {path}: {exc}") from exc
