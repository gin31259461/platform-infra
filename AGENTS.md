# AGENTS Instructions

## Project overview

`gitlab-runner-platform` deploys and observes isolated, project-scoped GitLab
Runners on Arch Linux. Runner managers run as dedicated Linux users in
rootless Podman containers managed by systemd user Quadlets. Managers use Host
networking to reach GitLab through an externally managed VPN; CI jobs use
isolated per-build networks.

The monorepo also contains a read-only Next.js Control Plane, PostgreSQL
observation persistence, exact-ID GitLab connectors, an operator-only
provisioning CLI, and a standard-library Python Host Agent. Runtime UI data is
always real persisted data; preserve missing values as unknown.

Code and tests are current truth. `docs/spec.md` describes both implemented
and target behavior. This file applies to the entire repository; there are no
nested `AGENTS.md` files.

## Read before changing code

- Human entry point: [README.md](README.md)
- Documentation map: [docs/README.md](docs/README.md)
- Domain language: [docs/context.md](docs/context.md)
- Current and target behavior: [docs/spec.md](docs/spec.md)
- Architecture and security: [docs/architecture.md](docs/architecture.md),
  [docs/security.md](docs/security.md)
- Development and failures:
  [docs/development-workflow.md](docs/development-workflow.md),
  [docs/troubleshooting.md](docs/troubleshooting.md)

## Repository map

- `apps/web/`: Next.js UI, tRPC, Prisma, Agent ingestion, GitLab adapters, and
  the provisioning worker.
- `packages/contracts/`: strict, versioned process-boundary schemas.
- `packages/domain/`: authorization, health, and freshness rules.
- `agent/`: read-only Python Host Agent and systemd user units.
- `playbooks/`, `roles/`: Ansible orchestration and shared Host behavior.
- `stacks/gitlab-runners/`: supported Runner Templates, examples, and smoke
  pipelines.
- `scripts/`: fixed operator workflows; do not turn them into generic command
  execution surfaces.
- `tests/`: repository, infrastructure, DNS, lint, and security validation.

## Environment setup

Use the checked-in runtime and dependency pins:

```bash
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
uv sync --locked
```

Use pnpm for Node workflows and Make for infrastructure or Host Agent
workflows. Do not introduce npm, Yarn, pip requirements, or an unlocked Python
environment.

Stack arguments are canonical identities, not paths:

```bash
STACK=gitlab-runners/frontend
```

Provisioned instances also use a validated platform identity:

```bash
STACK=gitlab-runners/dotnet
STACK_INSTANCE_ID=dotnet-REPLACE_WITH_12_HEX
```

## Architecture boundaries

- Contracts own data exchanged across processes.
- Domain modules own policy and state evaluation.
- Adapters own Prisma, HTTP, systemd, Podman, and filesystem integration.
- UI renders persisted state and never fabricates fallback observations.
- Host Agent and monitoring GitLab connector are read-only.
- Host mutation uses fixed workflows with typed identities and explicit
  authorization; never accept commands or arbitrary paths from callers.
- Runner managers may open the per-user Podman socket. Host Agents and CI jobs
  must never open or mount it.

Use terms from `docs/context.md`: Runner Record, Runner Scope, Runner Manager,
Runner Host, Runner Template, Runner Stack, Host Agent, Host Provisioner,
Desired State, Observed State, Drift, Operation, and Fleet.

## Development commands

```bash
pnpm dev                    # supervised Next.js development server
pnpm web:build              # production Web build
pnpm start                  # supervised production server
pnpm db:validate            # validate Prisma schema
pnpm db:status              # inspect migration status
pnpm db:summary             # inspect bounded inventory counts
make validate-all           # validate every supported Stack
make lint                   # ShellCheck, YAML, Ansible, and secret checks
make test-agent             # Host Agent unit tests through uv
```

`pnpm dev` and `pnpm start` perform one GitLab synchronization before opening
the loopback listener and continue serial synchronization in the background.
Do not run `pnpm gitlab:watch` beside the supervised server.

## Required checks

Run the smallest focused test first. Add a regression test for every
reproducible bug.

| Change | Required checks |
| --- | --- |
| Web, contracts, or domain | focused Vitest file, then `pnpm validate:web` |
| Host Agent | focused unittest, then `make test-agent`, then `pnpm validate:web` |
| One Stack config | `make validate STACK="${STACK}"`, then `make validate-all` |
| DNS or Runner config | `./tests/test-vpn-dns.sh`, then `make validate-all` |
| Shell, YAML, Ansible, or security boundary | `make lint`, then `make validate-all` |
| Documentation only | verify links and commands, then `git diff --check` |

Always run `git diff --check` before handoff. Tests must not depend on real
tokens, sudo, systemd mutation, GitLab mutation, or live Podman state unless
the user explicitly authorizes a live canary.

## Authorization and destructive actions

Read-only diagnostics are safe when relevant:

```bash
make check STACK="${STACK}"
make status STACK="${STACK}"
make verify STACK="${STACK}"
pnpm db:status
pnpm db:summary
```

The following change the Host, PostgreSQL, credential store, or GitLab and
require explicit user authorization:

```bash
make bootstrap
make install STACK="${STACK}"
make install-agent STACK="${STACK}"
make register STACK="${STACK}"
make idempotency STACK="${STACK}"
make uninstall STACK="${STACK}"
pnpm db:migrate
pnpm db:deploy
pnpm gitlab:credential:install -- --purpose monitoring
pnpm gitlab:credential:install -- --purpose provisioning
pnpm gitlab:discover
pnpm gitlab:import-discovery
pnpm gitlab:sync
pnpm gitlab:watch
pnpm host:enroll
pnpm host:bootstrap-agent --stack "${STACK}"
pnpm host:issue-credential
pnpm provisioning:operation:request
pnpm provisioning:host:stage
pnpm provisioning:worker:run
pnpm provisioning:project:allow -- --path namespace/project
pnpm runner:decommission -- --stack-id REPLACE_WITH_STACK_ID
pnpm runner:provision -- --project namespace/project --template "${STACK}"
```

- `make bootstrap` performs a full Arch upgrade.
- Registration and provisioning contact GitLab and install token-bearing
  Runner configuration.
- GitLab discovery reads GitLab but overwrites the ignored local discovery
  snapshot. Synchronization and watching read GitLab but append observations
  to PostgreSQL.
- Database reset, migration squashing, Host enrollment, low-level credential
  issuance, and discovery import are mutations even in staging.
- Normal uninstall permanently removes the local Runner user, home, config,
  cache, and container storage. A provisioned instance is then marked inactive
  in PostgreSQL.
- Never automatically unregister or delete a GitLab Runner Record. Preserve
  Runner Record references, observations, and audit history.
- Never work around sudo or ask the user to reveal a password. Complete safe
  checks and hand off exact sudo commands when human intervention is required.
- The VPN is external. Validate it, but never configure, reconnect, or store
  its credentials.

## Secrets

Never commit, print, log, or expose:

- Runner authentication tokens or installed `config.toml` contents;
- real `stacks/**/config.yml` or `.env` files;
- files below `secrets/`;
- GitLab access tokens, Agent secrets, VPN credentials, private keys, or
  credential digests that aid correlation.

Registration tokens and connector credentials use stdin or the owner-only
credential store. Do not move them into arguments, Ansible variables,
environment files, temporary files, browser state, database payloads, or
shell history. Never enable shell tracing in token-handling code.

Do not disable TLS verification, use `curl -k`, mount the Podman socket into
jobs, enable privileged jobs, or activate a Docker daemon. Plain HTTP is
allowed only for explicit same-host staging on literal `127.0.0.1` or `::1`;
all cross-host connections require verified HTTPS.

## Code conventions

### Shell

- Start Bash scripts with `#!/usr/bin/env bash` and `set -Eeuo pipefail`.
- Quote expansions and use arrays for constructed commands.
- Resolve Stack identities through `scripts/lib/stack.sh`.
- Reuse `as_root` and `as_runner_user` from `scripts/lib/common.sh`.
- Keep destructive targets explicit, validated, and confirmation-gated.

### Ansible and YAML

- Use fully qualified collection names and module parameters or `argv`.
- Use `shell` only for genuine shell language and declare accurate change and
  failure conditions.
- Preserve idempotency; a second install must report `changed=0`.
- Put shared behavior in `roles/`; Stack files contain workload policy and
  examples.
- Use two-space YAML indentation and a 140-character line limit.
- Quadlet files use `WantedBy=default.target`; reload and start or try-restart
  the generated service instead of enabling it directly.

### TypeScript, React, and data boundaries

- Keep boundary validation strict with Zod and versioned contracts.
- Keep policy in domain modules rather than React components or adapters.
- Use Prisma through the shared client and repository adapters.
- Preserve denial, stale, timeout, duplicate, partial-failure, and unknown
  states; never replace them with optimistic defaults.
- Keep the UI simple, accessible, responsive, and consistent with its existing
  MUI theme. Use semantic state colors only where they improve scanning.

### Python Host Agent

- Runtime code uses the standard library only; development tooling may use the
  locked uv environment.
- Run the installed Agent from its package-free per-user `.venv` in isolated
  mode.
- Parse structured data structurally. Preserve restrictive ownership and file
  modes during atomic writes.
- Never read Runner token-bearing content or open the Podman socket.

### Prisma and PostgreSQL

- Keep Prisma model and field names idiomatic TypeScript.
- Map physical tables, columns, enum types and values, indexes, constraints,
  and foreign keys to explicit snake_case names. Table names are plural.
- The checked-in base migration represents a new empty database and includes
  approved Runner Template seeds. Add incremental migrations after the base;
  never rewrite a released migration.
- Validate schema changes with `pnpm db:validate`, migration status, and a
  `prisma migrate diff` against the target database when available.

### Runner policy

- Canonical names match
  `^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$`.
- Every Stack has `README.md`, `config.example.yml`, and a smoke pipeline.
- Use unique users, services, containers, tokens, caches, tags, and trust
  boundaries.
- Keep concurrency `1`, privileged mode off, manager Host networking on,
  per-build job networking on, and job volumes limited to `/cache`.
- Use fully qualified pinned images and repository-scoped allowlists.

## Documentation and commits

Keep `README.md` as the developer entry point and `docs/README.md` as the
documentation index. Update the nearest guide when setup, architecture,
security, recovery, or operator behavior changes. Examples use generic
component names and placeholder values, never environment-specific topology or
real hosts.

Use focused commits in this format:

```text
type: concise lowercase message

- meaningful detail
```

Do not amend, rebase, push, rewrite history, or make a commit unless the user
explicitly requests it.
