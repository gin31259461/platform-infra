"""Domain validation for Runner stack configuration."""

from __future__ import annotations

import fnmatch
import ipaddress
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse

from platform_infra.domain.errors import ConfigurationError
from platform_infra.domain.models import StackConfiguration, SubordinateIdRange

_FIXED_IMAGE_PATTERN = re.compile(
    r"^[a-z0-9.-]+(?::[0-9]+)?/[a-z0-9._/-]+"
    r"(?:@sha256:[a-f0-9]{64}|:[A-Za-z0-9._-]+)$"
)
_IMAGE_ALLOWLIST_PATTERN = re.compile(
    r"^[a-z0-9.*?-]+(?::[0-9*]+)?/[A-Za-z0-9._/*?-]+"
    r"(?:@sha256:[a-f0-9*?]{1,64}|:[A-Za-z0-9._*?-]+)$"
)
_USER_PATTERN = re.compile(r"^[a-z_][a-z0-9_-]{0,30}$")
_STACK_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
_SERVICE_PATTERN = re.compile(r"^[A-Za-z0-9_.@-]+$")
_INTERFACE_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]+$")
_MEMORY_PATTERN = re.compile(r"^[1-9][0-9]*(?:[kKmMgGtT](?:[bB])?)?$")
_ALLOWED_PULL_POLICIES = frozenset({"always", "if-not-present", "never"})


def validate_stack_configuration(
    configuration: StackConfiguration,
    *,
    allow_placeholders: bool = False,
) -> None:
    """Enforce security, isolation, and portability invariants."""

    _validate_stack_identity(configuration)
    _validate_runner_account(configuration)
    _validate_runner_policy(configuration)
    _validate_network_policy(configuration, allow_placeholders=allow_placeholders)
    _validate_gitlab_endpoint(configuration, allow_placeholders=allow_placeholders)
    _validate_container_images(configuration)
    _validate_tls_policy(configuration)


def _validate_stack_identity(configuration: StackConfiguration) -> None:
    if configuration.stack.kind != "gitlab-runner":
        raise ConfigurationError("stack.type must be 'gitlab-runner'")
    if not _STACK_ID_PATTERN.fullmatch(configuration.stack.identifier):
        raise ConfigurationError("stack.id is not a valid portable identifier")


def _validate_runner_account(configuration: StackConfiguration) -> None:
    account = configuration.account
    if not _USER_PATTERN.fullmatch(account.user):
        raise ConfigurationError("runner.user is not a valid portable Linux user name")
    if account.user == "root":
        raise ConfigurationError("runner.user must not be root")

    account_home = Path(account.home)
    if not account_home.is_absolute():
        raise ConfigurationError("runner.home must be an absolute path")
    if account_home == Path("/"):
        raise ConfigurationError("runner.home must not be the filesystem root")
    if any(character.isspace() for character in account.home):
        raise ConfigurationError("runner.home must not contain whitespace")

    _validate_subordinate_range(account.subuid, "runner.subuid")
    _validate_subordinate_range(account.subgid, "runner.subgid")
    if account.subuid.count != account.subgid.count:
        raise ConfigurationError("subordinate UID and GID counts must match")


def _validate_runner_policy(configuration: StackConfiguration) -> None:
    policy = configuration.runner
    if not _SERVICE_PATTERN.fullmatch(policy.service_name):
        raise ConfigurationError("runner.service_name contains unsupported characters")
    if policy.service_name.endswith(".service"):
        raise ConfigurationError("runner.service_name must not include .service")
    if policy.concurrent != 1:
        raise ConfigurationError("runner.concurrent must remain 1 for isolated stacks")
    if policy.privileged:
        raise ConfigurationError("runner.privileged must remain false")
    if policy.pull_policy not in _ALLOWED_PULL_POLICIES:
        raise ConfigurationError("runner.pull_policy is unsupported")
    if policy.shm_size_bytes < 0:
        raise ConfigurationError("runner.shm_size_bytes cannot be negative")
    _validate_positive_decimal(policy.cpus, "runner.cpus")
    if not _MEMORY_PATTERN.fullmatch(policy.memory):
        raise ConfigurationError("runner.memory must be a positive size such as 4g")
    if not policy.tags:
        raise ConfigurationError("runner.tags must contain at least one tag")
    if not policy.allowed_images:
        raise ConfigurationError("runner.allowed_images cannot be empty")


def _validate_network_policy(
    configuration: StackConfiguration,
    *,
    allow_placeholders: bool,
) -> None:
    network = configuration.network
    if not network.use_host_network_for_runner_manager:
        raise ConfigurationError(
            "network.use_host_network_for_runner_manager must remain true"
        )
    if not _INTERFACE_PATTERN.fullmatch(network.vpn_interface):
        raise ConfigurationError(
            "network.vpn_interface contains unsupported characters"
        )
    if network.vpn_dns is None:
        return
    if allow_placeholders and "REPLACE_" in network.vpn_dns:
        return
    try:
        ipaddress.ip_address(network.vpn_dns)
    except ValueError as exc:
        raise ConfigurationError("network.vpn_dns must be an IP address") from exc


def _validate_gitlab_endpoint(
    configuration: StackConfiguration,
    *,
    allow_placeholders: bool,
) -> None:
    endpoint = configuration.gitlab
    if allow_placeholders and "REPLACE_" in endpoint.url:
        return

    _validate_https_url(endpoint.url, "gitlab.url")
    _validate_https_url(endpoint.health_url, "gitlab.health_url")
    if urlparse(endpoint.url).hostname != endpoint.hostname:
        raise ConfigurationError("gitlab.hostname must match gitlab.url")
    if urlparse(endpoint.health_url).hostname != endpoint.hostname:
        raise ConfigurationError("gitlab.hostname must match gitlab.health_url")


def _validate_container_images(configuration: StackConfiguration) -> None:
    for image in (
        configuration.runner.manager_image,
        configuration.runner.default_job_image,
        configuration.network.validation_image,
    ):
        _validate_fixed_image(image)

    for pattern in (
        *configuration.runner.allowed_images,
        *configuration.runner.allowed_services,
    ):
        _validate_image_allowlist_pattern(pattern)

    if not any(
        fnmatch.fnmatchcase(configuration.runner.default_job_image, pattern)
        for pattern in configuration.runner.allowed_images
    ):
        raise ConfigurationError(
            "runner.default_job_image must match runner.allowed_images"
        )


def _validate_tls_policy(configuration: StackConfiguration) -> None:
    if not configuration.tls.private_ca_enabled:
        return
    source = configuration.tls.private_ca_source
    if source is None:
        raise ConfigurationError(
            "tls.private_ca_source is required when private_ca_enabled is true"
        )
    if source.suffix.lower() not in {".crt", ".pem"}:
        raise ConfigurationError(
            "tls.private_ca_source must reference a .crt or .pem certificate"
        )


def _validate_subordinate_range(value: SubordinateIdRange, field_name: str) -> None:
    if value.start <= 0:
        raise ConfigurationError(f"{field_name}_start must be positive")
    if value.count < 65536:
        raise ConfigurationError(f"{field_name} count must be at least 65536")
    if value.end > 4_294_967_294:
        raise ConfigurationError(f"{field_name} exceeds the subordinate-ID limit")


def _validate_positive_decimal(value: str, field_name: str) -> None:
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise ConfigurationError(f"{field_name} must be a positive number") from exc
    if not parsed.is_finite() or parsed <= 0:
        raise ConfigurationError(f"{field_name} must be a positive number")


def _validate_https_url(value: str, field_name: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ConfigurationError(f"{field_name} must be an absolute HTTPS URL")


def _validate_fixed_image(image: str) -> None:
    if not _FIXED_IMAGE_PATTERN.fullmatch(image):
        raise ConfigurationError(
            "Container image must be registry-qualified and tagged or digested: "
            f"{image}"
        )
    if image.endswith(":latest"):
        raise ConfigurationError(f"Container image cannot use latest: {image}")


def _validate_image_allowlist_pattern(pattern: str) -> None:
    if not _IMAGE_ALLOWLIST_PATTERN.fullmatch(pattern):
        raise ConfigurationError(
            f"Image allowlist entries must be registry-qualified patterns: {pattern}"
        )
    if pattern.endswith(":latest"):
        raise ConfigurationError(f"Image allowlist cannot use latest: {pattern}")
