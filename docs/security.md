# Security

## Runner baseline

- Project scope only; lock each Runner to its Project and disable untagged jobs.
- One dedicated Linux user, service, container, token, config, cache, and
  rootless Podman store per Runner Stack.
- Concurrency one and privileged mode disabled.
- Podman socket mounted only into the Runner manager, never CI jobs.
- Job volumes limited to `/cache` and per-build networking enabled.
- Registry-qualified pinned images with narrow repository allowlists.
- Verified DNS, TLS, and VPN reachability from Host and container.
- Separate deployment Runners from build Runners.

Never disable TLS verification, use `curl -k`, enable Docker, mount host paths
into jobs, or store VPN credentials in this repository.

## Secrets

Do not commit or print real Stack config, `.env`, `config.toml`, tokens,
private keys, or files under `secrets/`.

Runner authentication tokens enter through stdin and are streamed into a
short-lived manager process. GitLab access tokens are installed once into an
owner-only directory and loaded by purpose. Agent secrets are unique to one
Host and Stack; PostgreSQL stores only their SHA-256 digest.

Token-handling code must not use shell tracing, command arguments, temporary
files, environment files, browser storage, database payloads, logs, or audit
events.

## Browser boundary

The monitoring UI has no application login. Network access therefore grants
visibility to Runner inventory and observations. Next.js binds to loopback;
cross-host access requires trusted networking or a reverse proxy with verified
HTTPS.

The browser exposes no provisioning or Host mutation route. GitLab access
tokens are platform credentials, not user authentication.

## Observation boundary

Observation ingestion is disabled unless
`PLATFORM_OBSERVATION_INGESTION=enabled`.

`POST /api/v1/observations`:

- authenticates before parsing;
- accepts at most 64 KiB;
- binds one report to the credential's Host and Stack;
- rejects unknown fields and token-shaped diagnostics;
- deduplicates by delivery UUID.

`GET /api/v1/observations/refresh` uses the same credential and reads only the
latest Host timestamp. It returns one of `current`, `missing`, `stale`, or
`startup` plus a boolean. It cannot transport commands or paths.

Agents run as the Runner user from a package-free `.venv` with `-I`.
Systemd applies `NoNewPrivileges`, read-only home/system access except the
bounded state directory, and restricted address families. The Agent never
opens the Podman socket or reads Runner token-bearing content.

Plain HTTP is allowed only for explicit same-host staging on literal
`127.0.0.1` or `::1`. LAN, hostname, and Tailscale origins require verified
HTTPS.

## GitLab monitoring

The connector uses a dedicated token with only `read_api`. It queries only
numeric Runner Record IDs already correlated in PostgreSQL through a fixed,
bounded GraphQL document. It contains no mutation or general list query.

Discovery is the only list exception. It filters supported tag pairs, follows
bounded pagination, and persists nothing until an explicit import.

## Project provisioning

Provisioning uses a separate credential with only `create_runner`. The target
Project must be in the administrator-owned allowlist. The platform derives
all local identities and paths from its Operation UUID.

GitLab returns a one-time Runner authentication token. The adapter hands it
directly to registration in memory; only the installed `0600` Runner config
retains it. An ambiguous or partial remote result is not automatically retried
or compensated.

New Runner Records start paused, locked to the Project, tagged, and unable to
run untagged jobs. The CLI never unpauses or deletes them.

## Destructive local uninstall

Uninstall requires an interactive terminal and exact target confirmation. It
permanently removes the local Runner user and data from the Runner Host.
Targets are resolved from canonical Template names and validated platform
instance IDs; caller-supplied paths are rejected.

The corresponding GitLab Runner Record is always preserved. Do not add
automatic unregister or delete behavior to cleanup, rollback, diagnosis, or
provisioning compensation.

Provisioned uninstall may mark the exact platform Stack inactive and revoke
its scoped Agent credentials after local cleanup. This database lifecycle
change must retain Runner Record references, observations, and audit events.
