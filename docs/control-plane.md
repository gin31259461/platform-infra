# Control Plane

The Next.js Control Plane is a read-only fleet UI backed by PostgreSQL. It has
no application login and binds to loopback. Expose it cross-host only through
a trusted network or reverse proxy with verified HTTPS.

## Environment and database

```bash
cp apps/web/.env.example apps/web/.env
$EDITOR apps/web/.env
pnpm db:generate
pnpm db:deploy
pnpm db:status
```

Required values are `DATABASE_URL` and the verified HTTPS
`GITLAB_BASE_URL`. Keep GitLab tokens and Agent secrets out of `.env`.

The database stores Runner Hosts, Stacks, Runner Record references, scoped
credential digests, immutable observations, durable provisioning Operations,
and redacted audit events.

Physical PostgreSQL identifiers use snake_case. `pnpm db:deploy` applies the
single base migration on a new database and installs the approved frontend and
.NET Runner Template revisions. Existing deployments receive new incremental
migrations after that baseline; do not edit an applied migration.

Provisioned uninstall marks a Stack inactive instead of deleting its durable
inventory. Active fleet reads, GitLab synchronization, credential issuance,
and Host observation ingestion exclude inactive Stacks.

## GitLab credentials

Install a monitoring token with only `read_api`:

```bash
read -rs GITLAB_READ_API_TOKEN
printf '%s' "${GITLAB_READ_API_TOKEN}" | \
  pnpm gitlab:credential:install -- --purpose monitoring
unset GITLAB_READ_API_TOKEN
```

Project provisioning uses a different token with only `create_runner`:

```bash
read -rs GITLAB_PROVISIONING_TOKEN
printf '%s' "${GITLAB_PROVISIONING_TOKEN}" | \
  pnpm gitlab:credential:install -- --purpose provisioning
unset GITLAB_PROVISIONING_TOKEN
```

Credentials are regular owner-only `0600` files below an owner-only `0700`
directory. The installers reject symlinks, broad modes, unexpected owners, and
oversized input. Tokens never enter `.env`, PostgreSQL, browser traffic, or
logs.

## Discover existing Runners

```bash
pnpm gitlab:discover
```

Discovery reads supported project Runners and persists nothing. For an empty
staging database, review the fixed ignored discovery file and import it with:

```bash
pnpm gitlab:import-discovery
```

The import requires exact, unambiguous frontend and .NET matches.

## Project provisioning

Allow one exact Project path:

```bash
pnpm provisioning:project:allow -- --path namespace/project
```

Provision one isolated paused Runner:

```bash
pnpm runner:provision -- \
  --project namespace/project \
  --template gitlab-runners/dotnet
```

The high-level command composes the durable lower-level recovery commands:

- `pnpm provisioning:operation:request`
- `pnpm provisioning:host:stage`
- `pnpm provisioning:worker:run`

The generated Stack ID, user, service, container, and config path derive from
the Operation UUID. The worker receives the one-time Runner token only through
an in-memory handoff and stdin registration. It never automatically unpauses,
unregisters, or deletes the GitLab Runner Record. After correlation, the
high-level command also bootstraps the Stack-bound Host Agent.

## Host Agent ingestion

Enable ingestion explicitly:

```dotenv
PLATFORM_OBSERVATION_INGESTION=enabled
```

Bootstrap one Agent after its Stack exists in PostgreSQL:

```bash
pnpm host:bootstrap-agent --stack gitlab-runners/frontend
```

The Agent uses a Host-and-Stack-bound credential. `POST
/api/v1/observations` authenticates before parsing a maximum 64 KiB strict v1
payload. Deliveries are idempotent by UUID.

Every five seconds the Agent calls authenticated `GET
/api/v1/observations/refresh`. The server requests fixed Host checks only when
evidence is missing, stale, or older than the current Control Plane process.
Startup forcing is enabled by default:

```dotenv
PLATFORM_FORCE_HOST_REFRESH_ON_START=enabled
```

Set it to `disabled` to opt out. The endpoint returns only a bounded decision;
it cannot carry a command, path, or Operation.

Host freshness defaults to 90 seconds. GitLab freshness defaults to 300:

```dotenv
PLATFORM_HOST_FRESHNESS_SECONDS=90
PLATFORM_GITLAB_FRESHNESS_SECONDS=300
```

## GitLab synchronization

```bash
pnpm gitlab:sync
```

Synchronization queries only Runner Record IDs already correlated in
PostgreSQL for active Stacks. It appends GitLab status, pause, contact, and
job-execution observations without listing or mutating Runners.

`pnpm dev` and `pnpm start` own the normal lifecycle:

1. load the installed monitoring credential;
2. complete one GitLab sync attempt;
3. start Next.js on `127.0.0.1`;
4. continue serial sync at `GITLAB_SYNC_INTERVAL_SECONDS` (default 60);
5. stop Next.js, watcher, and database clients cleanly on one Ctrl-C.

Do not run `pnpm gitlab:watch` beside the supervised server.

## Start and stop

Development:

```bash
pnpm dev
```

Production:

```bash
pnpm web:build
pnpm start
```

The browser requests a fresh server render every 10 seconds while visible and
immediately when a background tab becomes visible. Missing or stale evidence
is shown as unknown; no fake data path exists.

To disable ingestion, stop the server and set:

```dotenv
PLATFORM_OBSERVATION_INGESTION=disabled
```

Runner managers and jobs do not depend on Control Plane availability.
