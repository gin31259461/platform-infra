# Architecture

Each stack expresses workload-specific values while shared Ansible roles own
host, user, Podman, systemd, network, TLS, and Runner manager behavior.

```text
stacks/gitlab-runners/frontend/config.yml
                    |
                    v
playbooks/gitlab-runner.yml
  |-- common/preflight
  |-- common/arch_packages
  |-- gitlab_runner/runner_user
  |-- common/systemd_user
  |-- common/rootless_podman
  |-- common/network_validation
  |-- common/tls_validation
  |-- gitlab_runner/runner_manager
  `-- gitlab_runner/runner_validation
```

GitLab initiates no inbound connection to the host. The manager polls GitLab
over host networking so it inherits the manually managed VPN route and DNS.
Job containers use per-build networking and do not inherit host networking.

The dedicated Linux user is the isolation unit. It owns its home, subordinate
UID/GID ranges, rootless storage, Podman API socket, user services, Runner
configuration, token, and cache. Stacks with different trust levels must use
different users and credentials.

The manager receives the Podman socket at `/run/podman/podman.sock` and tells
the Docker executor to use that endpoint. Job volumes contain only `/cache`.
Increasing concurrency or adding a deployment Runner requires a separate
security and capacity review.

