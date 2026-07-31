# AGENTS.md

## Project

`gitlab-runner-platform` deploys and observes project-scoped frontend and .NET
GitLab Runners on Arch Linux. Runner managers are rootless Podman containers
managed by systemd user Quadlets. Managers use host networking to reach GitLab
through an external VPN; CI jobs use isolated per-build networks.

The monorepo also contains a read-only Next.js Control Plane, PostgreSQL
observation persistence, a standard-library Python Host Agent, and a read-only
GitLab connector. Treat code and tests as current truth; [SPEC.md](SPEC.md)
describes target behavior and may include unimplemented capabilities.

This file applies to the entire repository. There are no nested `AGENTS.md`
files.

## Read first

- Human setup and operations: [README.md](README.md)
- Documentation map: [docs/README.md](docs/README.md)
- Architecture and security: [docs/architecture.md](docs/architecture.md),
  [docs/security.md](docs/security.md)
- Domain and product behavior: [CONTEXT.md](CONTEXT.md), [SPEC.md](SPEC.md)
- Contribution lifecycle: [docs/development-workflow.md](docs/development-workflow.md)
- Common failures: [docs/troubleshooting.md](docs/troubleshooting.md)

## Repository map

- `playbooks/`, `roles/`: Ansible orchestration and shared host behavior.
- `stacks/gitlab-runners/`: supported frontend and .NET stack configuration.
- `apps/web/`: Next.js UI, tRPC API, Prisma persistence, Agent ingestion, and
  GitLab connector.
- `agent/`: read-only Python Host Agent and systemd user units.
- `packages/contracts/`, `packages/domain/`: boundary schemas and domain rules.
- `scripts/`, `tests/`: supported workflows, helpers, lint, and verification.

## Setup and commands

Use canonical stack names, never caller-supplied filesystem paths:

```bash
STACK=gitlab-runners/frontend
```

For Node work, use the checked-in nvm and pnpm pins:

```bash
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
```

Use pnpm for Node workflows and Make for infrastructure or Host Agent
workflows.

| Change | Required checks |
| --- | --- |
| One stack config | `make validate STACK="${STACK}"`, then `make validate-all` |
| Web, contracts, or domain | smallest package test, then `pnpm validate:web` |
| Host Agent | `make test-agent`, then `pnpm validate:web` |
| DNS or Runner config | `./tests/test-vpn-dns.sh`, then `make validate-all` |
| Shell, YAML, Ansible, or security boundary | `make lint`, then `make validate-all` |

Always run `git diff --check` before handoff. Add a focused regression test for
every reproducible bug.

## Authorization and safety

Read-only diagnostics are safe when relevant:

```bash
make check STACK="${STACK}"
make status STACK="${STACK}"
make verify STACK="${STACK}"
```

The following mutate the host or external state and require explicit user
authorization:

```bash
make bootstrap
make install STACK="${STACK}"
make install-agent STACK="${STACK}"
make register STACK="${STACK}"
make idempotency STACK="${STACK}"
make uninstall STACK="${STACK}"
pnpm host:bootstrap-agent --stack "${STACK}"
```

- `make bootstrap` performs a full Arch upgrade.
- Registration contacts GitLab and changes local token-bearing configuration.
- Agent bootstrap changes PostgreSQL credentials and the Runner user's files
  and systemd timer.
- Credential issuance and discovery import commands mutate staging inventory
  and require the same explicit authorization.
- Purge permanently removes the Runner user and data; normal uninstall keeps
  configuration and cache.
- Never work around sudo or ask the user to expose a password.
- The VPN is external: validate it, but never configure, reconnect, or store
  its credentials.
- Never automatically unregister or delete a GitLab Runner record.

## Secrets

Never commit, print, log, or expose:

- `GITLAB_RUNNER_TOKEN` or installed `config.toml` contents;
- real `stacks/**/config.yml` or `.env` files;
- files under `secrets/`;
- VPN credentials, private keys, or Host Agent secrets.

Registration tokens and connector credentials must continue to use stdin. Do
not move them into arguments, Ansible variables, environment files, temporary
files, or shell history. Never enable shell tracing in token-handling code.

Do not disable TLS verification, use `curl -k`, mount the Podman socket into
jobs, enable privileged jobs, or activate a Docker daemon. The only plaintext
Control Plane exception is explicit same-host staging on literal `127.0.0.1`
or `::1`; every cross-host connection requires verified HTTPS.

## Code conventions

### Shell

- Start Bash scripts with `#!/usr/bin/env bash` and `set -Eeuo pipefail`.
- Quote expansions and use arrays for constructed commands.
- Resolve stacks through `scripts/lib/stack.sh`.
- Reuse `as_root` and `as_runner_user` from `scripts/lib/common.sh`.
- Keep destructive targets explicit and validated.

### Ansible and YAML

- Use fully qualified collection names and module parameters or `argv`.
- Use `shell` only for genuine shell language; set accurate `changed_when`,
  `failed_when`, and `when` conditions.
- Preserve idempotency; a second install must report `changed=0`.
- Keep shared behavior in `roles/common` or `roles/gitlab_runner`; stacks hold
  workload values and examples.
- Use two-space YAML indentation and a 140-character line limit.
- Quadlet-generated services are not enabled directly. Put
  `WantedBy=default.target` in the `.container` file, then reload and start or
  try-restart the service.

### Python and data boundaries

- Prefer the standard library unless the runtime already guarantees a
  dependency.
- Parse YAML/TOML structurally when correctness or secret preservation matters.
- Never read Runner token-bearing content in the Host Agent or open the Podman
  socket.
- Preserve unknown values as unknown; do not fabricate zero jobs, empty Drift,
  or a version.
- Preserve restrictive ownership and modes during atomic writes.

### Stacks and images

- Stack names match `^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$`.
- Every stack has `README.md` and `config.example.yml`.
- Runner stacks use unique users, services, containers, tokens, caches, tags,
  and trust boundaries.
- Keep concurrency `1`, privileged mode off, manager host networking on,
  per-build job networking on, and job volumes limited to `/cache`.
- Use full registry-qualified images; pin fixed images and keep wildcard
  allowlists repository-scoped.

See [Adding a Runner stack](docs/adding-a-runner-stack.md) for detailed rules.

## Documentation and commits

Update the nearest guide under `docs/` when architecture, security, setup,
rollback, or troubleshooting changes. Keep README as the concise human entry
point and `docs/README.md` as the index. Examples use placeholder hosts and no
real environment data.

Commit format:

```text
type: concise lowercase message

- meaningful detail
```

Keep commits focused. Do not amend, rebase, push, or rewrite history unless the
user explicitly asks.
