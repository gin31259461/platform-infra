# Development workflow

## Setup

```bash
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
uv sync --locked
```

Node and pnpm are pinned by `.nvmrc` and `packageManager`. Python development
is pinned by `.python-version`, `pyproject.toml`, and `uv.lock`. Do not add
unlocked pip environments or ad-hoc global packages.

## Start locally

Copy `apps/web/.env.example`, configure PostgreSQL and GitLab, deploy
migrations, and install the monitoring token before starting Web:

```bash
pnpm db:deploy
pnpm dev
```

The supervisor synchronizes GitLab before opening the listener. One Ctrl-C is
a clean exit with status zero.

## Design boundaries

- Contracts own versioned process-boundary schemas.
- Domain code owns authorization, health, and freshness rules.
- Adapters own Prisma, HTTP, systemd, Podman, and filesystem delivery details.
- UI renders current domain state; it does not invent fallback data.
- Host Agent and GitLab connectors are read-only.
- Host mutation stays in fixed operator workflows with explicit authorization.

Use domain terms from `CONTEXT.md`. Keep modules narrow at the boundary and
deep internally: callers should pass typed identities and intent, not commands
or filesystem paths.

## Test from narrow to broad

| Change | First check | Final check |
| --- | --- | --- |
| Web or TypeScript | focused Vitest file | `pnpm validate:web` |
| Host Agent | focused unittest | `make test-agent` |
| Stack config | `make validate STACK=...` | `make validate-all` |
| Shell/YAML/Ansible | focused syntax/lint | `make lint && make validate-all` |
| DNS/Runner config | `./tests/test-vpn-dns.sh` | `make validate-all` |

Every reproducible bug gets a test at the seam that catches the reported
symptom. Tests must preserve unknown values and must not depend on real tokens,
GitLab mutation, sudo, systemd changes, or Podman state unless explicitly
classified as a live canary.

Always finish with:

```bash
git diff --check
```

## Review

Review standards and product behavior independently:

1. Does the change follow `AGENTS.md`, security policy, and code conventions?
2. Does it implement the requested behavior without hidden scope expansion?
3. Are denial, stale, timeout, duplicate, partial-failure, and rollback states
   represented honestly?
4. Could any credential or token enter logs, arguments, fixtures, screenshots,
   environment files, or database payloads?
5. Are destructive targets explicit and verified?

Visible UI changes should include a screenshot when the environment supports
it. Security-sensitive changes require focused review of authorization and
secret flow.

## Live validation

Host and GitLab mutations require explicit user authorization. Never work
around sudo or request a password. If live testing is not authorized or needs
human input, complete all non-mutating checks and clearly record the skipped
command.

Roll out Host Agent and Control Plane changes canary-first. Their versioned
contract must allow either side to be upgraded first. Database migrations must
remain compatible with the previously deployed Control Plane during rollout.
The base migration may be squashed only before its release and only with an
explicit development database reset; all later changes use incremental
migrations.

## Commits

Use focused commits in this format:

```text
type: concise lowercase message

- meaningful detail
```

Do not commit real config, tokens, `.env`, private keys, VPN credentials,
generated caches, or ignored provisioning state.
