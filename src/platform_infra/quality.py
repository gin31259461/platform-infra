"""Repository quality-gate entry point."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from platform_infra.adapters.process import SubprocessExecutor
from platform_infra.application.ports import ProcessExecutor
from platform_infra.domain.errors import PlatformInfraError
from platform_infra.domain.models import Command


@dataclass(frozen=True, slots=True)
class QualityStep:
    """One ordered repository quality gate."""

    name: str
    arguments: tuple[str, ...]


def build_parser() -> argparse.ArgumentParser:
    """Build the quality command parser."""

    parser = argparse.ArgumentParser(
        prog="platform-infra-quality",
        description="Run all repository formatting and validation gates.",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path.cwd(),
        help="Repository root. Defaults to the current directory.",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Apply Python formatting instead of checking it.",
    )
    return parser


def run_quality(
    project_root: Path,
    executor: ProcessExecutor,
    *,
    fix: bool,
) -> None:
    """Run every quality gate sequentially and stop on the first failure."""

    for step in _quality_steps(fix=fix):
        print(f"\n==> {step.name}", flush=True)
        executor.execute(
            Command(
                arguments=step.arguments,
                working_directory=project_root,
            )
        )


def main(arguments: list[str] | None = None) -> int:
    """Run the repository quality workflow."""

    parsed = build_parser().parse_args(arguments)
    project_root = parsed.project_root.resolve()
    executor = SubprocessExecutor(os.environ)

    try:
        run_quality(
            project_root,
            executor,
            fix=parsed.fix,
        )
    except PlatformInfraError as exc:
        print(f"\nQuality gate failed: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nQuality workflow cancelled", file=sys.stderr)
        return 130

    print("\nAll quality gates passed.")
    return 0


def _quality_steps(*, fix: bool) -> tuple[QualityStep, ...]:
    format_arguments = (
        ("ruff", "format", ".") if fix else ("ruff", "format", "--check", ".")
    )

    return (
        QualityStep(
            name="Format Python",
            arguments=format_arguments,
        ),
        QualityStep(
            name="Lint Python",
            arguments=("ruff", "check", "."),
        ),
        QualityStep(
            name="Type check Python",
            arguments=("mypy",),
        ),
        QualityStep(
            name="Run Python tests",
            arguments=(
                "pytest",
                "--cov",
                "--cov-report=term-missing",
            ),
        ),
        QualityStep(
            name="Lint YAML",
            arguments=("yamllint", "."),
        ),
        QualityStep(
            name="Lint Ansible",
            arguments=("ansible-lint",),
        ),
        QualityStep(
            name="Validate stack configurations",
            arguments=("platform-infra", "validate-all"),
        ),
    )


if __name__ == "__main__":
    sys.exit(main())
