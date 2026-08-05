"""Subprocess adapter behavior."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from platform_infra.adapters.process import SubprocessExecutor
from platform_infra.domain.errors import CommandExecutionError
from platform_infra.domain.models import Command


def test_capture_successful_command_output(tmp_path: Path) -> None:
    executor = SubprocessExecutor({})

    result = executor.execute(
        Command(
            arguments=(sys.executable, "-c", "print('ok')"),
            working_directory=tmp_path,
            capture_output=True,
        )
    )

    assert result.standard_output == "ok\n"


def test_raise_specific_error_for_failed_command(tmp_path: Path) -> None:
    executor = SubprocessExecutor({})

    with pytest.raises(CommandExecutionError, match="exit code 7"):
        executor.execute(
            Command(
                arguments=(
                    sys.executable,
                    "-c",
                    "import sys; print('failure', file=sys.stderr); sys.exit(7)",
                ),
                working_directory=tmp_path,
                capture_output=True,
            )
        )
