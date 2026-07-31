# Security

## Required controls

- Use only a project-scoped Runner created manually in GitLab.
- Lock the Runner to that project and disable untagged jobs.
- Use a dedicated Linux user and rootless Podman.
- Keep privileged mode disabled and concurrency at one.
- Mount the Podman socket only into the Runner manager.
- Keep job volumes limited to `/cache`.
- Use registry-qualified, pinned manager and job images.
- Keep narrow registry and repository allowlists for job and service images.
- Validate VPN, DNS, and TLS from both host and container.
- Install a public CA certificate when needed; never disable TLS verification.
- Keep `config.yml`, `config.toml`, tokens, VPN credentials, and private keys
  out of Git.
- Use a new Project Runner identity during migration.
- Keep deployment credentials and Runners separate from build Runners.

Registration streams the token from `GITLAB_RUNNER_TOKEN` over standard input
to a short-lived manager shell, which exports the Runner CLI's expected
variable. The value is not placed in Podman command arguments. Scripts do not
enable shell tracing, print the token, write it to a temporary file, or delete
a failed registration.

Normal uninstall preserves the token-bearing config with mode `0600`. Purge
requires explicit confirmation. Removing the corresponding Runner from GitLab
remains a manual UI operation.

## Control Plane observations

The Host Agent observation endpoint is disabled unless
`PLATFORM_OBSERVATION_INGESTION=enabled` is explicitly set. Agent credentials
are unique to one enrolled Runner Host and Runner Stack. PostgreSQL stores only
a SHA-256 digest of the high-entropy credential secret; bootstrap commands read
the secret from standard input and return only the non-secret credential ID.

`POST /api/v1/observations` authenticates before parsing its bounded request
body. The authenticated Host and single Runner Stack identities must match the
credential scope, the Stack must already belong to that Host, and delivery IDs are
idempotency keys. The strict contract excludes GitLab-owned state, arbitrary
paths, unknown fields, and known token-shaped diagnostic values. Accepted and
duplicate deliveries create redacted audit events.

This is an ingestion boundary, not a remote-management channel. It cannot run
shell commands, invoke Ansible, access systemd or Podman, contact the GitLab
API, or receive a GitLab Runner authentication token. TLS termination remains
a deployment requirement for every cross-host connection. Isolated staging
may explicitly allow HTTP only to literal `127.0.0.1` or `::1` when Agent and
Control Plane are on the same Host. Hostnames, LAN addresses, and Tailscale
addresses remain HTTPS-only; certificate verification is never disabled.

The packaged Agent runs as the existing dedicated Runner user, not root. Each
isolated Runner user receives a different Agent credential even when several
Stacks share one physical Host identity. An unscoped legacy credential fails
authentication and must be replaced. The Agent accepts no command-line
paths or commands. Its systemd user service applies `NoNewPrivileges`, a
read-only home and system filesystem, a narrow writable state directory, and
restricted address families.

The staging installer resolves only canonical Stack names, renders a strict
configuration from the registered Stack values, and writes the Agent secret
from standard input directly to its fixed `0600` destination. The secret is
never passed through command arguments, environment variables, or a temporary
file. Installation requires explicit Host mutation authorization and ordinary
sudo policy; it never handles or works around a sudo password.

The preferred same-Host staging bootstrap generates a 256-bit secret in
process memory, stores only its digest in PostgreSQL, and sends the original
only through the installer's standard input. It passes a minimal environment
to the child installer, excluding database and GitLab configuration. A failed
install revokes the newly issued credential; a successful install revokes
older active credentials for that Stack. Neither path prints the secret.

The Agent never opens the Podman socket and never reads `config.toml`; it only
checks their type, ownership, and permissions. Consequently Runner version,
running job count, and Drift remain explicitly unknown until a separately
reviewed safe source exists. Unknown evidence must not be rendered as zero,
no Drift, or a known version.

## Read-only GitLab connector

The connector uses a dedicated GitLab access token with only `read_api`, not a
Runner authentication token, `manage_runner`, or `api`. It accepts the token
only from standard input and never stores it, includes it in command
arguments, or emits it in output. Production scheduling must supply that same
boundary through an approved secret store.

Only numeric Runner Record IDs already correlated in PostgreSQL can become
query targets. The GraphQL document selects five fixed read-only fields from
one exact Runner and contains no project/Runner list or mutation. Responses
are bounded and structurally parsed; redirects and non-HTTPS base URLs are
rejected. Audit events contain only explicit target IDs and stable failure
reason codes, not GraphQL errors, HTTP bodies, headers, or exception text.

The bootstrap-only discovery CLI is the sole list exception. It reads the
same dedicated token from standard input, requests only project Runners with
the supported `frontend,podman` or `dotnet,podman` tag pairs, follows at most
ten pages per workload, and enriches only those exact candidate IDs with their
associated project paths. It rejects control characters and never persists or
automatically enrolls a candidate.

Pause/resume and other GitLab writes require a separate credential, adapter,
authorization model, and review. The read connector must not be expanded to
reuse a broader token merely to prepare for those later operations.

The .NET stack permits only `mcr.microsoft.com/mssql/server:*` as a CI service.
SQL Server runs without privilege on the per-build network and is not exposed
on the host. NuGet source credentials belong in masked GitLab CI/CD variables,
never source URLs, stack configuration, or committed `NuGet.Config` files.
