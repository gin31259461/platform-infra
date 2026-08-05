"""Typed serialization boundary between Python and Ansible."""

from __future__ import annotations

from typing import TypedDict

from platform_infra.domain.models import StackConfiguration


class StackVariables(TypedDict):
    """Ansible variables for stack identity."""

    type: str
    id: str
    description: str


class GitLabVariables(TypedDict):
    """Ansible variables for GitLab connectivity."""

    url: str
    hostname: str
    health_url: str


class RunnerVariables(TypedDict):
    """Normalized Ansible variables for the Runner and host account."""

    name: str
    user: str
    home: str
    subuid_start: int
    subgid_start: int
    subordinate_id_count: int
    service_name: str
    image: str
    tags: list[str]
    concurrent: int
    cpus: str
    memory: str
    shm_size_bytes: int
    pull_policy: str
    privileged: bool
    default_job_image: str
    allowed_images: list[str]
    allowed_services: list[str]


class NetworkVariables(TypedDict):
    """Normalized Ansible network variables."""

    vpn_interface: str
    validation_image: str
    vpn_dns: str
    use_host_network_for_runner_manager: bool


class TlsVariables(TypedDict):
    """Normalized Ansible TLS variables."""

    private_ca_enabled: bool
    private_ca_source: str


class AnsibleVariables(TypedDict):
    """Complete JSON-compatible variable payload."""

    stack: StackVariables
    gitlab: GitLabVariables
    runner: RunnerVariables
    network: NetworkVariables
    tls: TlsVariables


def serialize_configuration(configuration: StackConfiguration) -> AnsibleVariables:
    """Convert a validated domain model into an Ansible variable payload."""

    private_ca_source = configuration.tls.private_ca_source
    return {
        "stack": {
            "type": configuration.stack.kind,
            "id": configuration.stack.identifier,
            "description": configuration.stack.description,
        },
        "gitlab": {
            "url": configuration.gitlab.url,
            "hostname": configuration.gitlab.hostname,
            "health_url": configuration.gitlab.health_url,
        },
        "runner": {
            "name": configuration.runner.name,
            "user": configuration.account.user,
            "home": configuration.account.home,
            "subuid_start": configuration.account.subuid_start,
            "subgid_start": configuration.account.subgid_start,
            "subordinate_id_count": configuration.account.subordinate_id_count,
            "service_name": configuration.runner.service_name,
            "image": configuration.runner.manager_image,
            "tags": list(configuration.runner.tags),
            "concurrent": configuration.runner.concurrent,
            "cpus": configuration.runner.cpus,
            "memory": configuration.runner.memory,
            "shm_size_bytes": configuration.runner.shm_size_bytes,
            "pull_policy": configuration.runner.pull_policy,
            "privileged": configuration.runner.privileged,
            "default_job_image": configuration.runner.default_job_image,
            "allowed_images": list(configuration.runner.allowed_images),
            "allowed_services": list(configuration.runner.allowed_services),
        },
        "network": {
            "vpn_interface": configuration.network.vpn_interface,
            "validation_image": configuration.network.validation_image,
            "vpn_dns": configuration.network.vpn_dns or "",
            "use_host_network_for_runner_manager": (
                configuration.network.use_host_network_for_runner_manager
            ),
        },
        "tls": {
            "private_ca_enabled": configuration.tls.private_ca_enabled,
            "private_ca_source": (
                str(private_ca_source) if private_ca_source is not None else ""
            ),
        },
    }
