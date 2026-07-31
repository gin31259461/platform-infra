# Architecture

## Control Plane vertical slice

The first Control Plane implementation is read-only and keeps replaceable
adapters behind versioned contracts and domain rules:

```text
Next.js pages
  |-- /                     Overview
  |-- /runners              Runner inventory
  `-- /runners/<stack-id>   Boundary evidence and Drift
             |
             v
       tRPC viewer procedure
             |
             |-- RBAC: fleet:read
             |-- health and freshness reasoning
             `-- FleetRepository
                    |-- FakeFleetRepository (local default)
                    `-- PrismaFleetRepository
                              ^
                              | latest immutable Host + GitLab observations
POST /api/v1/observations ---+--- PostgreSQL <--- GitLab sync CLI
          ^
          | Host+Stack-bound Bearer credential + strict v1 contract
       packaged Host Agent
```

`packages/contracts` owns the versioned observation shape.
`packages/domain` derives health, refuses to report stale observations as
healthy, and enforces role permissions. `apps/web` owns delivery concerns,
the browser-facing tRPC API, adapters, and PostgreSQL persistence boundary.

The checked-in Prisma schema and migrations cover Control Plane identity,
roles, Runner Hosts, Host+Stack-bound Agent credentials, Runner Stacks, Runner
Record references, immutable Observations, and Audit Events. PostgreSQL mode
independently reads the latest Host Agent and GitLab observation for each
enrolled Stack. The Host Agent contract cannot submit GitLab-owned fields.

The read-only GitLab connector runs outside Web requests. It reads a dedicated
`read_api` token from standard input and queries GraphQL only for exact Runner
Record IDs already present in PostgreSQL. It selects status, pause state, last
contact, and job-execution status, then appends normalized `GITLAB`
observations. It has no list query or mutation. Authentication and rate-limit
failures stop one sync run without replacing the last successful observation;
Host observations remain independent.

Observation ingestion is disabled by default. When enabled, the route accepts
at most 64 KiB, authenticates before parsing the body, binds the report's Host
ID and single Stack ID to the credential, accepts only registered identities, rejects
token-shaped diagnostics, and deduplicates by delivery ID. It performs no
host, GitLab, Ansible, systemd, or Podman operation.

The Python Host Agent runs as one dedicated Runner user and reports one Runner
Stack. It reads its credential from a fixed `0600` file and keeps at most one
bounded pending observation in a `0700` state directory so retries preserve
the delivery ID. It invokes only fixed `systemctl --user` checks, inspects file
metadata without reading `config.toml`, and checks for the Podman socket
without opening it. It cannot receive Operations and does not have a generic
command or filesystem-path interface.

The Agent requires an HTTPS Control Plane origin by default. For isolated
same-Host staging only, `allowPlaintextLoopback` may permit a literal
`127.0.0.1` or `::1` HTTP origin. The Web development and start commands bind
to `127.0.0.1`; the exception never permits a LAN or Tailscale address.

## Runner host runtime

Each stack expresses workload-specific values while shared Ansible roles own
host, user, Podman, systemd, network, TLS, and Runner manager behavior.
The pinned `network.validation_image` belongs to that shared infrastructure
layer and is used only for container-level connectivity diagnostics.

```text
stacks/gitlab-runners/<workload>/config.yml
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

The .NET stack starts SQL Server only as a per-build service container. It
shares the job's isolated network, is not published on the host, and receives
neither the Runner manager's host network nor the Podman socket. SDK, runtime,
and SQL Server versions are selected by pinned consumer-pipeline image tags.
