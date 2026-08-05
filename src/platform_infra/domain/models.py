"""Typed domain models for stack configuration and process execution."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class StackIdentity:
    """Identify one independently isolated Runner stack."""

    kind: str
    identifier: str
    description: str


@dataclass(frozen=True, slots=True)
class GitLabEndpoint:
    """GitLab coordinator endpoints used by the Runner."""

    url: str
    hostname: str
    health_url: str


@dataclass(frozen=True, slots=True)
class SubordinateIdRange:
    """One inclusive subordinate UID or GID allocation."""

    start: int
    count: int

    @property
    def end(self) -> int:
        """Return the inclusive final identifier."""

        return self.start + self.count - 1

    def overlaps(self, other: SubordinateIdRange) -> bool:
        """Return whether two inclusive allocations overlap."""

        return self.start <= other.end and other.start <= self.end


@dataclass(frozen=True, slots=True)
class RunnerAccount:
    """Host account and subordinate-ID allocation for rootless Podman."""

    user: str
    home: str
    subuid: SubordinateIdRange
    subgid: SubordinateIdRange

    @property
    def subuid_start(self) -> int:
        """Return the configured subordinate UID start."""

        return self.subuid.start

    @property
    def subgid_start(self) -> int:
        """Return the configured subordinate GID start."""

        return self.subgid.start

    @property
    def subordinate_id_count(self) -> int:
        """Return the common subordinate-ID count."""

        return self.subuid.count


@dataclass(frozen=True, slots=True)
class RunnerPolicy:
    """Runner identity, images, resources, and execution policy."""

    name: str
    service_name: str
    manager_image: str
    default_job_image: str
    allowed_images: tuple[str, ...]
    allowed_services: tuple[str, ...]
    tags: tuple[str, ...]
    concurrent: int
    privileged: bool
    cpus: str
    memory: str
    shm_size_bytes: int
    pull_policy: str


@dataclass(frozen=True, slots=True)
class NetworkPolicy:
    """VPN, DNS, and diagnostic network configuration."""

    vpn_interface: str
    vpn_dns: str | None
    validation_image: str
    use_host_network_for_runner_manager: bool


@dataclass(frozen=True, slots=True)
class TlsPolicy:
    """Optional private certificate-authority configuration."""

    private_ca_enabled: bool
    private_ca_source: Path | None


@dataclass(frozen=True, slots=True)
class StackConfiguration:
    """Complete validated configuration for one Runner stack."""

    source_path: Path
    stack: StackIdentity
    gitlab: GitLabEndpoint
    account: RunnerAccount
    runner: RunnerPolicy
    network: NetworkPolicy
    tls: TlsPolicy


@dataclass(frozen=True, slots=True)
class Command:
    """External process request without hidden shell evaluation."""

    arguments: tuple[str, ...]
    working_directory: Path
    environment: tuple[tuple[str, str], ...] = ()
    standard_input: str | None = None
    capture_output: bool = False


@dataclass(frozen=True, slots=True)
class CommandResult:
    """External process result."""

    return_code: int
    standard_output: str
    standard_error: str
