# Control Plane operations

This guide covers the read-only PostgreSQL, Host Agent, and GitLab data paths.
The default UI uses validated fake observations and refuses Agent ingestion;
enable live paths only in local or isolated staging until production browser
authentication and secret-store integration exist.

## Prepare PostgreSQL

Copy `apps/web/.env.example` to the ignored `apps/web/.env` and set
`DATABASE_URL`. Keep GitLab tokens and Host Agent secrets out of environment
files.

```bash
pnpm db:generate
pnpm db:deploy
pnpm db:status
```

The schema stores platform identities, scoped credential digests, immutable
Host and GitLab observations, and redacted audit events. Migrations are
additive; credentials that cannot be associated with exactly one Stack fail
closed and must be replaced.

## Discover and import Runner records

Use a dedicated GitLab token with only `read_api` and visibility to the target
project Runners. Discovery makes two bounded REST searches for the supported
tag sets, then reads only exact candidate IDs through GraphQL. It persists
nothing and performs no GitLab mutation.

```bash
read -rs GITLAB_READ_API_TOKEN
printf '%s' "${GITLAB_READ_API_TOKEN}" | pnpm gitlab:discover
unset GITLAB_READ_API_TOKEN
```

Review the candidates manually. For a new same-host staging database,
`pnpm gitlab:import-discovery` can import an unambiguous discovery file. The
command requires the fixed ignored file to have mode `0600`, an empty
inventory, and exactly one project Runner and project for each supported
workload. It creates Host, Stack, and Runner record identities but no Agent
credential.

## Bootstrap a Host Agent

For same-host staging, bootstrap one Agent from an existing canonical Stack:

```bash
pnpm host:bootstrap-agent --stack gitlab-runners/frontend
```

The command defaults to `http://127.0.0.1:3000`, generates a 256-bit secret in
process memory, stores only its digest in PostgreSQL, streams the secret into
the Runner user's owner-only file, and enables the systemd user timer. It
revokes the new credential if installation fails and superseded credentials
after success. This command mutates the Host and database and requires explicit
authorization and normal interactive sudo.

For external secret-manager integration, issue a separately generated
43–128-character base64url secret for one Host and Stack:

```bash
read -rs HOST_AGENT_SECRET
printf '%s' "${HOST_AGENT_SECRET}" | pnpm host:issue-credential \
  --host-id host-01 \
  --stack-id frontend-main
unset HOST_AGENT_SECRET
```

Never reuse a credential across Runner users. See the
[Host Agent guide](../agent/README.md) for its fixed configuration, service,
timer, and diagnostic commands.

## Enable observations

Set the staging-only switches in the Web environment:

```dotenv
PLATFORM_FLEET_REPOSITORY=postgresql
PLATFORM_OBSERVATION_INGESTION=enabled
```

The Agent sends one Stack per request to `POST /api/v1/observations` with a
Host-and-Stack-bound Bearer credential. The route authenticates before parsing
the body, limits JSON to 64 KiB, validates the versioned contract, and never
accepts arbitrary commands or paths. A new delivery returns `202`; an identical
retry returns `200`; reusing its UUID with different content returns `409`.

Plaintext is limited to a literal `127.0.0.1` or `::1` same-host staging
origin. Cross-host connections require verified HTTPS.

## Synchronize GitLab state

Set `GITLAB_BASE_URL` to the verified HTTPS GitLab origin, then stream the
dedicated `read_api` token:

```bash
read -rs GITLAB_READ_API_TOKEN
printf '%s' "${GITLAB_READ_API_TOKEN}" | pnpm gitlab:sync
unset GITLAB_READ_API_TOKEN
```

Synchronization queries only Runner IDs already correlated in PostgreSQL. It
reads pause, connectivity, last-contact, and job-execution state and appends
source-labelled observations. It never lists or mutates Runners. The command
prints a redacted JSON summary and exits nonzero when any target fails.

A target-specific failure preserves the last successful observation and does
not block other targets. Authentication failure or rate limiting stops the run;
a bounded `Retry-After` is reported without sleeping. Host and GitLab freshness
are evaluated independently, and stale or missing sources appear as unknown.

## Disable and recover

Stop synchronization, revoke the dedicated GitLab token, and restore safe Web
defaults:

```dotenv
PLATFORM_OBSERVATION_INGESTION=disabled
PLATFORM_FLEET_REPOSITORY=fake
```

The Runner manager and jobs do not depend on the Control Plane. Keep existing
observations and audit events for diagnosis; do not delete them merely to roll
back application code. Revoke affected credentials explicitly during an
incident.

Current limitations:

- Agent rollout uses an explicit staging installer rather than Ansible.
- GitLab synchronization has no installed scheduler or production secret-store
  integration.
- Credential rotation and revocation have no administrative UI.
- Live PostgreSQL and GitLab tests require explicitly provisioned disposable
  staging dependencies.
- The connector cannot pause, resume, register, or delete a Runner.
