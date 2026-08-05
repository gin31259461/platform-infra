"""Configuration parsing and cross-stack validation behavior."""

from __future__ import annotations

from pathlib import Path

import pytest

from platform_infra.adapters.filesystem import LocalFileSystem
from platform_infra.adapters.yaml_configuration import (
    YamlStackConfigurationParser,
    parse_stack_configuration,
)
from platform_infra.application.stacks import StackRepository
from platform_infra.domain.errors import ConfigurationError


def test_load_valid_stack(valid_stack_path: Path) -> None:
    configuration = parse_stack_configuration(
        valid_stack_path.read_text(encoding="utf-8"),
        valid_stack_path,
        reject_placeholders=True,
    )

    assert configuration.stack.identifier == "frontend"
    assert configuration.account.home == "/var/lib/gitlab-runner-test"
    assert configuration.account.subuid.end == 165535
    assert configuration.network.vpn_dns == "100.100.100.100"


def test_load_legacy_stack_defaults(
    tmp_path: Path,
    valid_stack_yaml: str,
) -> None:
    legacy_yaml = valid_stack_yaml
    for line in (
        "  home: /var/lib/gitlab-runner-test\n",
        "  subuid_start: 100000\n",
        "  subgid_start: 100000\n",
        "  subordinate_id_count: 65536\n",
        "  allowed_services: []\n",
    ):
        legacy_yaml = legacy_yaml.replace(line, "")
    path = tmp_path / "config.yml"
    path.write_text(legacy_yaml, encoding="utf-8")

    configuration = parse_stack_configuration(
        legacy_yaml,
        path,
        reject_placeholders=True,
    )

    assert configuration.account.home == "/home/gitlab-runner-test"
    assert configuration.account.subuid.start == 100000
    assert configuration.runner.allowed_services == ()


def test_resolve_relative_private_ca(
    tmp_path: Path,
    valid_stack_yaml: str,
) -> None:
    certificate = tmp_path / "files" / "certs" / "gitlab.crt"
    certificate.parent.mkdir(parents=True)
    certificate.write_text("public certificate", encoding="utf-8")
    configured_yaml = valid_stack_yaml.replace(
        'private_ca_enabled: false\n  private_ca_source: ""',
        "private_ca_enabled: true\n  private_ca_source: files/certs/gitlab.crt",
    )
    path = tmp_path / "config.yml"

    configuration = parse_stack_configuration(
        configured_yaml,
        path,
        reject_placeholders=True,
    )

    assert configuration.tls.private_ca_source == certificate.resolve()


@pytest.mark.parametrize(
    ("original", "replacement", "expected_message"),
    [
        ("privileged: false", "privileged: true", "privileged"),
        ("100.100.100.100", "not-an-address", "IP address"),
        ("cpus: 1", "cpus: 0", "positive number"),
        ("memory: 1g", "memory: unlimited", "positive size"),
    ],
)
def test_reject_invalid_stack_values(
    tmp_path: Path,
    valid_stack_yaml: str,
    original: str,
    replacement: str,
    expected_message: str,
) -> None:
    path = tmp_path / "config.yml"
    invalid_yaml = valid_stack_yaml.replace(original, replacement)

    with pytest.raises(ConfigurationError, match=expected_message):
        parse_stack_configuration(
            invalid_yaml,
            path,
            reject_placeholders=True,
        )


def test_reject_secret_like_field(
    tmp_path: Path,
    valid_stack_yaml: str,
) -> None:
    path = tmp_path / "config.yml"
    invalid_yaml = valid_stack_yaml.replace(
        "  name: test-runner",
        "  name: test-runner\n  runner_token: forbidden",
    )

    with pytest.raises(ConfigurationError, match="Secret-like"):
        parse_stack_configuration(
            invalid_yaml,
            path,
            reject_placeholders=True,
        )


def test_reject_unknown_field(
    tmp_path: Path,
    valid_stack_yaml: str,
) -> None:
    path = tmp_path / "config.yml"
    invalid_yaml = valid_stack_yaml.replace(
        "  concurrent: 1",
        "  concurrent: 1\n  concurrnet_typo: 1",
    )

    with pytest.raises(ConfigurationError, match="Unknown field"):
        parse_stack_configuration(
            invalid_yaml,
            path,
            reject_placeholders=True,
        )


def test_reject_placeholder_in_local_configuration(
    tmp_path: Path,
    valid_stack_yaml: str,
) -> None:
    path = tmp_path / "config.yml"
    invalid_yaml = valid_stack_yaml.replace(
        "gitlab.example.com",
        "REPLACE_GITLAB_HOST",
    )

    with pytest.raises(ConfigurationError, match="Placeholder"):
        parse_stack_configuration(
            invalid_yaml,
            path,
            reject_placeholders=True,
        )


def test_validate_all_rejects_overlapping_subordinate_ranges(
    tmp_path: Path,
    valid_stack_yaml: str,
) -> None:
    first_directory = tmp_path / "stacks" / "gitlab-runners" / "frontend"
    second_directory = tmp_path / "stacks" / "gitlab-runners" / "backend"
    first_directory.mkdir(parents=True)
    second_directory.mkdir(parents=True)
    (first_directory / "config.example.yml").write_text(
        valid_stack_yaml,
        encoding="utf-8",
    )
    second_yaml = (
        valid_stack_yaml.replace("id: frontend", "id: backend")
        .replace("gitlab-runner-test", "gitlab-runner-backend")
        .replace("name: test-runner", "name: backend-runner")
    )
    (second_directory / "config.example.yml").write_text(
        second_yaml,
        encoding="utf-8",
    )

    repository = StackRepository(
        tmp_path,
        LocalFileSystem(),
        YamlStackConfigurationParser(),
    )

    with pytest.raises(ConfigurationError, match="overlaps"):
        repository.validate_all()


@pytest.mark.parametrize(
    ("original", "replacement", "expected_message"),
    [
        ("user: gitlab-runner-test", "user: root", "must not be root"),
        (
            "home: /var/lib/gitlab-runner-test",
            "home: /",
            "filesystem root",
        ),
        (
            "health_url: https://gitlab.example.com/-/health",
            "health_url: https://other.example.com/-/health",
            "health_url",
        ),
    ],
)
def test_reject_unsafe_identity_and_endpoint_values(
    tmp_path: Path,
    valid_stack_yaml: str,
    original: str,
    replacement: str,
    expected_message: str,
) -> None:
    invalid_yaml = valid_stack_yaml.replace(original, replacement)

    with pytest.raises(ConfigurationError, match=expected_message):
        parse_stack_configuration(
            invalid_yaml,
            tmp_path / "config.yml",
            reject_placeholders=True,
        )


def test_repository_rejects_missing_private_ca_file(
    tmp_path: Path,
    valid_stack_yaml: str,
) -> None:
    stack_directory = tmp_path / "stacks" / "gitlab-runners" / "frontend"
    stack_directory.mkdir(parents=True)
    configured_yaml = valid_stack_yaml.replace(
        'private_ca_enabled: false\n  private_ca_source: ""',
        "private_ca_enabled: true\n  private_ca_source: files/certs/missing.crt",
    )
    (stack_directory / "config.example.yml").write_text(
        configured_yaml,
        encoding="utf-8",
    )
    repository = StackRepository(
        tmp_path,
        LocalFileSystem(),
        YamlStackConfigurationParser(),
    )

    with pytest.raises(ConfigurationError, match="does not exist"):
        repository.validate_all()


def test_validate_all_discovers_local_only_stack(
    tmp_path: Path,
    valid_stack_yaml: str,
) -> None:
    stack_directory = tmp_path / "stacks" / "gitlab-runners" / "local-only"
    stack_directory.mkdir(parents=True)
    local_yaml = valid_stack_yaml.replace("id: frontend", "id: local-only")
    (stack_directory / "config.yml").write_text(local_yaml, encoding="utf-8")
    repository = StackRepository(
        tmp_path,
        LocalFileSystem(),
        YamlStackConfigurationParser(),
    )

    configurations = repository.validate_all()

    assert tuple(
        configuration.stack.identifier for configuration in configurations
    ) == ("local-only",)


def test_reject_parent_traversal_in_named_stack_reference(tmp_path: Path) -> None:
    repository = StackRepository(
        tmp_path,
        LocalFileSystem(),
        YamlStackConfigurationParser(),
    )

    with pytest.raises(ConfigurationError, match="portable relative path"):
        repository.resolve("../outside", require_local=True)
