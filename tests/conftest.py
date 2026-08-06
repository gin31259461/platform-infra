"""Shared pytest fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def valid_stack_yaml() -> str:
    """Return a complete valid stack configuration."""

    return """---
stack:
  type: gitlab-runner
  id: frontend
  description: Test Runner
gitlab:
  url: https://gitlab.example.com
  hostname: gitlab.example.com
  health_url: https://gitlab.example.com/-/health
runner:
  name: test-runner
  user: gitlab-runner-test
  home: /var/lib/gitlab-runner-test
  subuid_start: 100000
  subgid_start: 100000
  subordinate_id_count: 65536
  container_name: gitlab-runner-test
  service_name: gitlab-runner-test
  image: docker.io/gitlab/gitlab-runner:v18.10.1
  tags:
    - test
    - podman
  concurrent: 1
  cpus: 1
  memory: 1g
  shm_size_bytes: 0
  pull_policy: always
  privileged: false
  default_job_image: docker.io/library/alpine:3.21.3
  allowed_images:
    - docker.io/library/alpine:*
  allowed_services: []
network:
  vpn_interface: tailscale0
  vpn_dns: 100.100.100.100
  validation_image: docker.io/curlimages/curl:8.12.1
  use_host_network_for_runner_manager: true
tls:
  private_ca_enabled: false
  private_ca_source: ""
"""


@pytest.fixture
def valid_stack_path(tmp_path: Path, valid_stack_yaml: str) -> Path:
    """Write the valid stack fixture to disk."""

    path = tmp_path / "config.yml"
    path.write_text(valid_stack_yaml, encoding="utf-8")
    return path
