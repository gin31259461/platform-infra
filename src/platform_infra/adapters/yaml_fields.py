"""Strict field extraction for untrusted YAML values."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence, Set
from pathlib import Path

from platform_infra.domain.errors import ConfigurationError

_SECRET_KEY_PATTERN = re.compile(
    r"(?:password|private[_-]?key|registration[_-]?token|runner[_-]?token|secret)",
    re.IGNORECASE,
)


def reject_unknown_fields(
    mapping: Mapping[str, object],
    allowed_fields: Set[str],
    path: str,
) -> None:
    """Reject keys that are not part of the declared stack schema."""

    unknown_fields = sorted(set(mapping) - allowed_fields)
    if unknown_fields:
        joined = ", ".join(unknown_fields)
        raise ConfigurationError(f"Unknown field(s) at {path}: {joined}")


def reject_secret_fields(mapping: Mapping[str, object], *, path: str) -> None:
    """Reject secret-like keys recursively at the YAML input boundary."""

    for key, value in mapping.items():
        child_path = f"{path}.{key}"
        if _SECRET_KEY_PATTERN.search(key):
            raise ConfigurationError(f"Secret-like field is forbidden: {child_path}")
        if isinstance(value, Mapping):
            normalized = require_string_key_mapping(value, child_path)
            reject_secret_fields(normalized, path=child_path)
        elif isinstance(value, Sequence) and not isinstance(value, str):
            for index, member in enumerate(value):
                if isinstance(member, Mapping):
                    member_path = f"{child_path}[{index}]"
                    normalized = require_string_key_mapping(member, member_path)
                    reject_secret_fields(normalized, path=member_path)


def reject_placeholders(value: object, *, path: str) -> None:
    """Reject unresolved deployment placeholders recursively."""

    if isinstance(value, str) and "REPLACE_" in value:
        raise ConfigurationError(f"Placeholder remains at {path}")
    if isinstance(value, Mapping):
        for key, member in require_string_key_mapping(value, path).items():
            reject_placeholders(member, path=f"{path}.{key}")
    elif isinstance(value, Sequence) and not isinstance(value, str):
        for index, member in enumerate(value):
            reject_placeholders(member, path=f"{path}[{index}]")


def require_mapping(value: object, path: str) -> Mapping[str, object]:
    """Return a string-keyed mapping or raise a configuration error."""

    if not isinstance(value, Mapping):
        raise ConfigurationError(f"{path} must be a mapping")
    return require_string_key_mapping(value, path)


def require_string_key_mapping(
    value: Mapping[object, object],
    path: str,
) -> Mapping[str, object]:
    """Normalize one mapping after validating every key is a string."""

    normalized: dict[str, object] = {}
    for key, member in value.items():
        if not isinstance(key, str):
            raise ConfigurationError(f"{path} contains a non-string key")
        normalized[key] = member
    return normalized


def mapping_field(mapping: Mapping[str, object], key: str) -> Mapping[str, object]:
    """Read one required mapping field."""

    if key not in mapping:
        raise ConfigurationError(f"Missing required mapping: {key}")
    return require_mapping(mapping[key], key)


def string_field(mapping: Mapping[str, object], key: str) -> str:
    """Read one required non-empty string field."""

    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigurationError(f"{key} must be a non-empty string")
    return value.strip()


def optional_string_field(
    mapping: Mapping[str, object],
    key: str,
) -> str | None:
    """Read one optional normalized string field."""

    value = mapping.get(key)
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ConfigurationError(f"{key} must be a string or null")
    normalized = value.strip()
    return normalized or None


def scalar_string_field(mapping: Mapping[str, object], key: str) -> str:
    """Read a scalar as a normalized string while rejecting booleans."""

    value = mapping.get(key)
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ConfigurationError(f"{key} must be a string or number")
    rendered = str(value).strip()
    if not rendered:
        raise ConfigurationError(f"{key} cannot be empty")
    return rendered


def integer_field(mapping: Mapping[str, object], key: str) -> int:
    """Read one required integer field while rejecting booleans."""

    value = mapping.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigurationError(f"{key} must be an integer")
    return value


def optional_integer_field(
    mapping: Mapping[str, object],
    key: str,
) -> int | None:
    """Read one optional integer field while rejecting booleans."""

    value = mapping.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigurationError(f"{key} must be an integer or null")
    return value


def boolean_field(mapping: Mapping[str, object], key: str) -> bool:
    """Read one required boolean field."""

    value = mapping.get(key)
    if not isinstance(value, bool):
        raise ConfigurationError(f"{key} must be a boolean")
    return value


def string_tuple_field(
    mapping: Mapping[str, object],
    key: str,
) -> tuple[str, ...]:
    """Read one required list of non-empty strings."""

    value = mapping.get(key)
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise ConfigurationError(f"{key} must be a list of strings")
    result: list[str] = []
    for member in value:
        if not isinstance(member, str) or not member.strip():
            raise ConfigurationError(f"{key} must contain only non-empty strings")
        result.append(member.strip())
    return tuple(result)


def optional_string_tuple_field(
    mapping: Mapping[str, object],
    key: str,
) -> tuple[str, ...]:
    """Read one optional list of non-empty strings."""

    if key not in mapping or mapping[key] is None:
        return ()
    return string_tuple_field(mapping, key)


def optional_path_field(mapping: Mapping[str, object], key: str) -> Path | None:
    """Read one optional filesystem path."""

    value = optional_string_field(mapping, key)
    return Path(value) if value is not None else None
