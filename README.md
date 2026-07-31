# gitlab-runner-platform

A focused platform for deploying and observing project-scoped GitLab Runners
on self-managed Arch Linux hosts.

It combines idempotent Runner infrastructure, a read-only Next.js Control
Plane, PostgreSQL observations, a narrowly scoped Host Agent, and an exact-ID
GitLab connector. Runner managers use rootless Podman; CI jobs remain isolated
from the host and Podman socket.

> [!IMPORTANT]
> The current Control Plane is an isolated-staging vertical slice. Production
> authentication, scheduled GitLab synchronization, Ansible-managed Agent
> rollout, credential administration, and remote Operations are not yet
> implemented. The VPN and GitLab Runner records remain manually managed.

## Capabilities

- Dedicated Linux user, rootless Podman socket, cache, and trust boundary per
  Runner stack.
- Quadlet-managed GitLab Runner manager with host networking for the VPN path.
- Isolated per-build networks, unprivileged jobs, and no Podman socket in jobs.
- Supported frontend and .NET stacks with pinned image and service allowlists.
- Read-only fleet UI backed by versioned contracts and PostgreSQL observations.
- One-command staging Host Agent bootstrap without exposing its generated
  credential secret.
- Read-only GitLab GraphQL synchronization for explicitly correlated Runner
  IDs using a dedicated `read_api` token.

## Architecture

```text
Browser -> Next.js Control Plane -> PostgreSQL <- GitLab sync CLI
                    ^
                    | scoped observations
             read-only Host Agent
                    |
Arch host -> Runner manager -> rootless Podman -> isolated CI jobs
    |
    `-> manually managed VPN -> GitLab
```

The Control Plane never receives a Runner authentication token and cannot run
arbitrary host commands. See [Architecture](docs/architecture.md) and
[Security](docs/security.md) for the trust boundaries.

## Supported stacks

| Stack | Purpose | Guide |
| --- | --- | --- |
| `gitlab-runners/frontend` | Node.js, pnpm, and browser workloads | [Frontend Runner](stacks/gitlab-runners/frontend/README.md) |
| `gitlab-runners/dotnet` | .NET workloads with optional SQL Server services | [.NET Runner](stacks/gitlab-runners/dotnet/README.md) |

## Quick start

After completing the host prerequisites and bootstrap in the full guide,
prepare and validate a local Runner stack:

```bash
cp stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml
$EDITOR stacks/gitlab-runners/frontend/config.yml

make validate STACK=gitlab-runners/frontend
make check STACK=gitlab-runners/frontend
make install STACK=gitlab-runners/frontend
```

`config.yml` is deliberately ignored. Replace every `REPLACE_*` value and
connect the externally managed VPN before live checks. `make install` changes
the host and requires interactive sudo; registration is a separate
token-through-stdin step.

For the complete Runner lifecycle, including bootstrap, registration,
verification, and recovery, follow [Getting started](docs/getting-started.md).

Start the local Control Plane:

```bash
source /usr/share/nvm/init-nvm.sh  # Arch packaged nvm, when needed
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:3000`. Fake observations and disabled ingestion remain
the safe defaults; PostgreSQL and live observation setup are documented in
[Control Plane operations](docs/control-plane.md).

## Common commands

Use canonical stack names such as `STACK=gitlab-runners/frontend`.

| Command | Purpose |
| --- | --- |
| `make validate-all` | Validate every Runner stack and regression test |
| `make lint` | Run repository lint and secret scans |
| `make check STACK=...` | Run live, read-only host preflight checks |
| `make install STACK=...` | Reconcile one Runner stack |
| `make register STACK=...` | Register using a token streamed through stdin |
| `make verify STACK=...` | Verify network, Podman, service, config, and Runner |
| `make test-agent` | Run the Python Host Agent tests |
| `pnpm validate:web` | Typecheck, test, lint, and build the web workspaces |
| `pnpm host:bootstrap-agent --stack ...` | Generate and install one scoped staging Agent |
| `pnpm gitlab:sync` | Run an explicit read-only GitLab synchronization |

Run `make help` and inspect the root `package.json` for the complete command
surface. Host-mutating commands require explicit authorization.

## Documentation

Start with the [documentation index](docs/README.md).

| Topic | Document |
| --- | --- |
| Product behavior | [Specification](SPEC.md) |
| Domain language | [Context](CONTEXT.md) |
| Installation and operations | [Getting started](docs/getting-started.md) |
| Architecture and trust boundaries | [Architecture](docs/architecture.md), [Security](docs/security.md) |
| Control Plane data paths | [Control Plane operations](docs/control-plane.md) |
| Contribution lifecycle | [Development workflow](docs/development-workflow.md) |
| Failures and recovery | [Troubleshooting](docs/troubleshooting.md), [Rollback](docs/rollback.md) |

## Repository layout

```text
agent/                 read-only Python Host Agent and systemd units
apps/web/              Next.js Control Plane and browser-facing API
packages/              versioned contracts and domain rules
playbooks/             Runner stack orchestration
roles/                 shared host and Runner automation
stacks/                workload configuration, examples, and smoke CI
scripts/               supported command implementations
tests/                 lint, regression, and live verification
docs/                  architecture, operations, and contributor guides
```

Before committing, run the smallest relevant check followed by the broader
suite described in [Development workflow](docs/development-workflow.md).
