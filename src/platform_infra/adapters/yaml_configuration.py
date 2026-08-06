"""YAML-to-domain conversion at the infrastructure boundary."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType

import yaml

from platform_infra.adapters.yaml_fields import (
    boolean_field,
    integer_field,
    mapping_field,
    optional_integer_field,
    optional_path_field,
    optional_string_field,
    optional_string_tuple_field,
    reject_secret_fields,
    reject_unknown_fields,
    require_mapping,
    scalar_string_field,
    string_field,
    string_tuple_field,
)
from platform_infra.adapters.yaml_fields import (
    reject_placeholders as reject_placeholder_values,
)
from platform_infra.domain.configuration_validation import (
    validate_stack_configuration,
)
from platform_infra.domain.errors import ConfigurationError
from platform_infra.domain.models import (
    GitLabEndpoint,
    NetworkPolicy,
    RunnerAccount,
    RunnerPolicy,
    StackConfiguration,
    StackIdentity,
    SubordinateIdRange,
    TlsPolicy,
)

_DEFAULT_SUBID_STARTS: Mapping[str, int] = MappingProxyType(
    {"frontend": 100000, "dotnet": 165536}
)
_ALLOWED_ROOT_FIELDS = frozenset({"stack", "gitlab", "runner", "network", "tls"})
_ALLOWED_STACK_FIELDS = frozenset({"type", "id", "description"})
_ALLOWED_GITLAB_FIELDS = frozenset({"url", "hostname", "health_url"})
_ALLOWED_RUNNER_FIELDS = frozenset(
    {
        "name",
        "user",
        "home",
        "subuid_start",
        "subgid_start",
        "subordinate_id_count",
        "container_name",
        "service_name",
        "image",
        "tags",
        "concurrent",
        "cpus",
        "memory",
        "shm_size_bytes",
        "pull_policy",
        "privileged",
        "default_job_image",
        "allowed_images",
        "allowed_services",
    }
)
_ALLOWED_NETWORK_FIELDS = frozenset(
    {
        "vpn_interface",
        "validation_image",
        "vpn_dns",
        "use_host_network_for_runner_manager",
    }
)
_ALLOWED_TLS_FIELDS = frozenset({"private_ca_enabled", "private_ca_source"})


class YamlStackConfigurationParser:
    """Parse YAML documents at the infrastructure boundary."""

    def parse(
        self,
        document: str,
        source_path: Path,
        *,
        reject_placeholders: bool,
    ) -> StackConfiguration:
        return parse_stack_configuration(
            document,
            source_path,
            reject_placeholders=reject_placeholders,
        )


def parse_stack_configuration(
    document: str,
    source_path: Path,
    *,
    reject_placeholders: bool,
) -> StackConfiguration:
    """Parse one YAML document into a validated domain model."""

    try:
        raw_document: object = yaml.safe_load(document)
    except yaml.YAMLError as exc:
        raise ConfigurationError(f"Invalid YAML in {source_path}: {exc}") from exc

    root = require_mapping(raw_document, "root")
    reject_unknown_fields(root, _ALLOWED_ROOT_FIELDS, "root")
    reject_secret_fields(root, path="root")
    if reject_placeholders:
        reject_placeholder_values(root, path="root")

    stack_mapping = mapping_field(root, "stack")
    gitlab_mapping = mapping_field(root, "gitlab")
    runner_mapping = mapping_field(root, "runner")
    network_mapping = mapping_field(root, "network")
    tls_mapping = mapping_field(root, "tls")
    _reject_section_unknown_fields(
        stack_mapping,
        gitlab_mapping,
        runner_mapping,
        network_mapping,
        tls_mapping,
    )

    configuration = _build_configuration(
        source_path,
        stack_mapping,
        gitlab_mapping,
        runner_mapping,
        network_mapping,
        tls_mapping,
    )
    _validate_legacy_container_name(runner_mapping, configuration)
    validate_stack_configuration(
        configuration,
        allow_placeholders=not reject_placeholders,
    )
    return configuration


def _reject_section_unknown_fields(
    stack_mapping: Mapping[str, object],
    gitlab_mapping: Mapping[str, object],
    runner_mapping: Mapping[str, object],
    network_mapping: Mapping[str, object],
    tls_mapping: Mapping[str, object],
) -> None:
    reject_unknown_fields(stack_mapping, _ALLOWED_STACK_FIELDS, "stack")
    reject_unknown_fields(gitlab_mapping, _ALLOWED_GITLAB_FIELDS, "gitlab")
    reject_unknown_fields(runner_mapping, _ALLOWED_RUNNER_FIELDS, "runner")
    reject_unknown_fields(network_mapping, _ALLOWED_NETWORK_FIELDS, "network")
    reject_unknown_fields(tls_mapping, _ALLOWED_TLS_FIELDS, "tls")


def _build_configuration(
    source_path: Path,
    stack_mapping: Mapping[str, object],
    gitlab_mapping: Mapping[str, object],
    runner_mapping: Mapping[str, object],
    network_mapping: Mapping[str, object],
    tls_mapping: Mapping[str, object],
) -> StackConfiguration:
    stack_identifier = string_field(stack_mapping, "id")
    runner_user = string_field(runner_mapping, "user")
    subuid_start, subgid_start = _resolve_subordinate_starts(
        runner_mapping,
        stack_identifier,
    )
    subordinate_id_count = optional_integer_field(
        runner_mapping,
        "subordinate_id_count",
    )
    if subordinate_id_count is None:
        subordinate_id_count = 65536

    private_ca_source = optional_path_field(tls_mapping, "private_ca_source")
    if private_ca_source is not None and not private_ca_source.is_absolute():
        private_ca_source = (source_path.parent / private_ca_source).resolve()

    return StackConfiguration(
        source_path=source_path.resolve(),
        stack=StackIdentity(
            kind=string_field(stack_mapping, "type"),
            identifier=stack_identifier,
            description=string_field(stack_mapping, "description"),
        ),
        gitlab=GitLabEndpoint(
            url=string_field(gitlab_mapping, "url"),
            hostname=string_field(gitlab_mapping, "hostname"),
            health_url=string_field(gitlab_mapping, "health_url"),
        ),
        account=RunnerAccount(
            user=runner_user,
            home=optional_string_field(runner_mapping, "home")
            or f"/home/{runner_user}",
            subuid=SubordinateIdRange(subuid_start, subordinate_id_count),
            subgid=SubordinateIdRange(subgid_start, subordinate_id_count),
        ),
        runner=RunnerPolicy(
            name=string_field(runner_mapping, "name"),
            service_name=string_field(runner_mapping, "service_name"),
            manager_image=string_field(runner_mapping, "image"),
            default_job_image=string_field(runner_mapping, "default_job_image"),
            allowed_images=string_tuple_field(runner_mapping, "allowed_images"),
            allowed_services=optional_string_tuple_field(
                runner_mapping,
                "allowed_services",
            ),
            tags=string_tuple_field(runner_mapping, "tags"),
            concurrent=integer_field(runner_mapping, "concurrent"),
            privileged=boolean_field(runner_mapping, "privileged"),
            cpus=scalar_string_field(runner_mapping, "cpus"),
            memory=scalar_string_field(runner_mapping, "memory"),
            shm_size_bytes=integer_field(runner_mapping, "shm_size_bytes"),
            pull_policy=string_field(runner_mapping, "pull_policy"),
        ),
        network=NetworkPolicy(
            vpn_interface=string_field(network_mapping, "vpn_interface"),
            vpn_dns=optional_string_field(network_mapping, "vpn_dns"),
            validation_image=string_field(network_mapping, "validation_image"),
            use_host_network_for_runner_manager=boolean_field(
                network_mapping,
                "use_host_network_for_runner_manager",
            ),
        ),
        tls=TlsPolicy(
            private_ca_enabled=boolean_field(tls_mapping, "private_ca_enabled"),
            private_ca_source=private_ca_source,
        ),
    )


def _resolve_subordinate_starts(
    runner_mapping: Mapping[str, object],
    stack_identifier: str,
) -> tuple[int, int]:
    default_start = _DEFAULT_SUBID_STARTS.get(stack_identifier)
    subuid_start = optional_integer_field(runner_mapping, "subuid_start")
    subgid_start = optional_integer_field(runner_mapping, "subgid_start")
    if subuid_start is None:
        subuid_start = default_start
    if subgid_start is None:
        subgid_start = default_start
    if subuid_start is None or subgid_start is None:
        raise ConfigurationError(
            "runner.subuid_start and runner.subgid_start are required for new stack IDs"
        )
    return subuid_start, subgid_start


def _validate_legacy_container_name(
    runner_mapping: Mapping[str, object],
    configuration: StackConfiguration,
) -> None:
    container_name = optional_string_field(runner_mapping, "container_name")
    if (
        container_name is not None
        and container_name != configuration.runner.service_name
    ):
        raise ConfigurationError(
            "runner.container_name must match runner.service_name during migration"
        )
