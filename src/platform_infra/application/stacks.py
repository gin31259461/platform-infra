"""Stack discovery and validation use cases."""

from __future__ import annotations

from pathlib import Path

from platform_infra.application.ports import FileSystem, StackConfigurationParser
from platform_infra.domain.errors import ConfigurationError
from platform_infra.domain.models import StackConfiguration, SubordinateIdRange


class StackRepository:
    """Resolve, load, and cross-validate stack configuration files."""

    def __init__(
        self,
        project_root: Path,
        filesystem: FileSystem,
        parser: StackConfigurationParser,
    ) -> None:
        self._project_root = project_root
        self._filesystem = filesystem
        self._parser = parser

    def resolve(self, stack_reference: str, *, require_local: bool) -> Path:
        """Resolve a stack name or explicit YAML path."""

        candidate = Path(stack_reference)
        if candidate.suffix in {".yml", ".yaml"}:
            resolved = (
                candidate if candidate.is_absolute() else self._project_root / candidate
            )
        else:
            if candidate.is_absolute() or ".." in candidate.parts:
                raise ConfigurationError(
                    "Named stack references must be portable relative paths"
                )
            stack_directory = self._project_root / "stacks" / candidate
            local_path = stack_directory / "config.yml"
            example_path = stack_directory / "config.example.yml"
            if require_local or self._filesystem.exists(local_path):
                resolved = local_path
            else:
                resolved = example_path

        if not self._filesystem.exists(resolved):
            raise ConfigurationError(f"Stack configuration does not exist: {resolved}")
        return resolved.resolve()

    def load(
        self,
        stack_reference: str,
        *,
        require_local: bool,
        reject_placeholders: bool,
    ) -> StackConfiguration:
        """Resolve, parse, and validate one stack."""

        path = self.resolve(stack_reference, require_local=require_local)
        configuration = self._parser.parse(
            self._filesystem.read_text(path),
            path,
            reject_placeholders=reject_placeholders,
        )
        self._validate_external_files(configuration)
        return configuration

    def validate_all(self) -> tuple[StackConfiguration, ...]:
        """Validate local configs when present, otherwise committed examples."""

        stack_directories = sorted(
            {
                path.parent
                for pattern in (
                    "stacks/*/*/config.example.yml",
                    "stacks/*/*/config.yml",
                )
                for path in self._filesystem.glob(self._project_root, pattern)
            }
        )
        configurations: list[StackConfiguration] = []
        users: dict[str, Path] = {}
        services: dict[str, Path] = {}
        uid_ranges: list[tuple[SubordinateIdRange, Path]] = []
        gid_ranges: list[tuple[SubordinateIdRange, Path]] = []

        for directory in stack_directories:
            local_path = directory / "config.yml"
            has_local_config = self._filesystem.exists(local_path)
            selected = (
                local_path if has_local_config else directory / "config.example.yml"
            )
            configuration = self._parser.parse(
                self._filesystem.read_text(selected),
                selected,
                reject_placeholders=has_local_config,
            )
            self._validate_external_files(configuration)
            _require_unique(
                users,
                configuration.account.user,
                selected,
                "Runner user",
            )
            _require_unique(
                services,
                configuration.runner.service_name,
                selected,
                "Runner service",
            )
            _require_non_overlapping_range(
                uid_ranges,
                configuration.account.subuid,
                selected,
                "subordinate UID",
            )
            _require_non_overlapping_range(
                gid_ranges,
                configuration.account.subgid,
                selected,
                "subordinate GID",
            )
            configurations.append(configuration)

        if not configurations:
            raise ConfigurationError("No stack configurations were found")
        return tuple(configurations)

    def _validate_external_files(
        self,
        configuration: StackConfiguration,
    ) -> None:
        certificate_path = configuration.tls.private_ca_source
        if (
            configuration.tls.private_ca_enabled
            and certificate_path is not None
            and not self._filesystem.is_file(certificate_path)
        ):
            raise ConfigurationError(
                f"Private CA certificate does not exist: {certificate_path}"
            )


def _require_unique(
    existing_values: dict[str, Path],
    value: str,
    source_path: Path,
    label: str,
) -> None:
    previous_path = existing_values.get(value)
    if previous_path is not None:
        raise ConfigurationError(
            f"{label} {value!r} is shared by {previous_path} and {source_path}"
        )
    existing_values[value] = source_path


def _require_non_overlapping_range(
    existing_ranges: list[tuple[SubordinateIdRange, Path]],
    candidate: SubordinateIdRange,
    source_path: Path,
    label: str,
) -> None:
    for existing_range, existing_path in existing_ranges:
        if candidate.overlaps(existing_range):
            raise ConfigurationError(
                f"{label} range {candidate.start}:{candidate.count} in {source_path} "
                f"overlaps {existing_range.start}:{existing_range.count} in "
                f"{existing_path}"
            )
    existing_ranges.append((candidate, source_path))
