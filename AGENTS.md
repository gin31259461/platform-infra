# AGENTS Instructions

## Project

`gitlab-runner-platform` deploys and observes project-scoped frontend and .NET
GitLab Runners on Arch Linux. Runner managers are rootless Podman containers
managed by systemd user Quadlets. Managers use host networking to reach GitLab
through an external VPN; jobs use isolated per-build networks.

The monorepo also contains a read-only Next.js Control Plane, PostgreSQL
observation persistence, a standard-library Python Host Agent, and exact-ID
GitLab connectors. Runtime UI data is always real persisted data. Treat code
and tests as current truth; `SPEC.md` includes future behavior.

This file applies to the whole repository. There are no nested `AGENTS.md`
files.

## Read first

- Human entry point: [README.md](README.md)
- Documentation index: [docs/README.md](docs/README.md)
- Architecture and security: [docs/architecture.md](docs/architecture.md),
  [docs/security.md](docs/security.md)
- Domain and product behavior: [CONTEXT.md](CONTEXT.md), [SPEC.md](SPEC.md)
- Development and failures: [docs/development-workflow.md](docs/development-workflow.md),
  [docs/troubleshooting.md](docs/troubleshooting.md)

## Repository map

- `playbooks/`, `roles/`: Ansible orchestration and shared Host behavior.
- `stacks/gitlab-runners/`: supported Runner Templates and examples.
- `apps/web/`: Next.js UI, tRPC, Prisma, Agent ingestion, GitLab connectors,
  and provisioning worker.
- `agent/`: read-only Python Host Agent and systemd user units.
- `packages/contracts/`, `packages/domain/`: schemas and domain rules.
- `scripts/`, `tests/`: operator workflows and validation.

## Setup

Use the checked-in runtime and dependency pins:

```bash
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
uv sync --locked
```

Use pnpm for Node workflows and Make for infrastructure or Host Agent work.
Stack arguments are canonical names, never filesystem paths:

```bash
STACK=gitlab-runners/frontend
```

Provisioned instances additionally use a platform ID:

```bash
STACK=gitlab-runners/dotnet
STACK_INSTANCE_ID=dotnet-REPLACE_WITH_12_HEX
```

## Required checks

| Change | Checks |
| --- | --- |
| One Stack config | `make validate STACK="${STACK}"`, then `make validate-all` |
| Web, contracts, domain | focused test, then `pnpm validate:web` |
| Host Agent | `make test-agent`, then `pnpm validate:web` |
| DNS or Runner config | `./tests/test-vpn-dns.sh`, then `make validate-all` |
| Shell, YAML, Ansible, security | `make lint`, then `make validate-all` |

Always run `git diff --check`. Add a focused regression test for every
reproducible bug.

## Authorization

These diagnostics are read-only:

```bash
make check STACK="${STACK}"
make status STACK="${STACK}"
make verify STACK="${STACK}"
```

The following mutate Host, database, or GitLab state and require explicit user
authorization:

```bash
make bootstrap
make install STACK="${STACK}"
make install-agent STACK="${STACK}"
make register STACK="${STACK}"
make idempotency STACK="${STACK}"
make uninstall STACK="${STACK}"
pnpm host:bootstrap-agent --stack "${STACK}"
pnpm provisioning:project:allow -- --path namespace/project
pnpm runner:decommission -- --stack-id <stack-id>
pnpm runner:provision -- --project namespace/project --template "${STACK}"
```

- Bootstrap performs a full Arch upgrade.
- Registration and provisioning contact GitLab and install token-bearing
  Runner configuration.
- Uninstall permanently removes the local Runner user and all local data. A
  provisioned instance is marked inactive in PostgreSQL; it must never delete
  or unregister the GitLab Runner Record or historical evidence.
- Never work around sudo or ask the user to expose a password.
- Validate the external VPN; never configure, reconnect, or store it.

## Secrets

Never commit, print, log, or expose:

- Runner tokens or installed `config.toml`;
- real `stacks/**/config.yml` or `.env` files;
- anything under `secrets/`;
- VPN credentials, private keys, Agent secrets, or GitLab access tokens.

Registration and connector credentials use stdin or the owner-only credential
store. Never move them into arguments, Ansible variables, environment files,
temporary files, or shell history. Never enable shell tracing in token paths.

Do not disable TLS verification, use `curl -k`, mount the Podman socket into
jobs, enable privileged jobs, or activate Docker. Plain HTTP is allowed only
for explicit same-host staging on literal `127.0.0.1` or `::1`.

## Conventions

### Shell

- Use `#!/usr/bin/env bash` and `set -Eeuo pipefail`.
- Quote expansions and use arrays for constructed commands.
- Resolve Stack identities through `scripts/lib/stack.sh`.
- Reuse `as_root` and `as_runner_user`.
- Validate destructive targets and require exact confirmation.

### Ansible and YAML

- Use fully qualified modules and `argv` where possible.
- Keep tasks idempotent; a second install must report `changed=0`.
- Shared behavior belongs in `roles/`; Stack files contain workload values.
- Use two-space YAML and a 140-character line limit.
- Quadlets use `WantedBy=default.target`; reload and start or try-restart the
  generated service instead of enabling it directly.

### Python and boundaries

- Host Agent runtime code uses the standard library.
- Parse YAML/TOML structurally when correctness or secret safety matters.
- The Agent never reads token-bearing Runner config or opens the Podman socket.
- Preserve unknown values; do not invent zero jobs, empty Drift, or a version.
- Preserve restrictive ownership and modes during atomic writes.

### Runner policy

- Stack names match `^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$`.
- Every Stack has `README.md` and `config.example.yml`.
- Use unique users, services, containers, credentials, caches, and tags.
- Keep concurrency `1`, privileged mode off, manager host networking on,
  per-build networking on, and job volumes limited to `/cache`.
- Use registry-qualified pinned images and narrow repository allowlists.

## Documentation and commits

Keep root README concise and `docs/README.md` as the index. Update the closest
guide when setup, architecture, security, recovery, or operator behavior
changes. Examples use placeholders and never real environment data.

Commit format:

```text
type: concise lowercase message

- meaningful detail
```

Do not amend, rebase, push, or rewrite history without explicit authorization.
