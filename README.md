# gitlab-runner-platform

Deploy and observe isolated, project-scoped GitLab Runners on Arch Linux.

Runner managers run as dedicated Linux users in rootless Podman containers.
The Next.js Control Plane reads real Host Agent and GitLab observations from
PostgreSQL; it never substitutes sample data for missing evidence.

> [!IMPORTANT]
> The browser UI is read-only and has no application login. Keep it on
> loopback or behind trusted networking and verified HTTPS. Runner lifecycle
> mutations remain operator CLI workflows.

## What it provides

- Frontend and .NET Runner Templates with separate users, services, caches,
  tokens, and image policies.
- Quadlet-managed Runner managers using host networking for an external VPN.
- Unprivileged per-build networks with no Podman socket exposed to CI jobs.
- A compact fleet UI with independent Host and GitLab freshness.
- A standard-library Python Host Agent running in a per-user `.venv`.
- Read-only exact-ID GitLab synchronization using an installed `read_api`
  credential.
- An allowlisted CLI workflow that creates an initially paused Project Runner
  and deploys its isolated Stack.

## Requirements

- Arch Linux, cgroup v2, interactive sudo, and a reboot after host bootstrap.
- An externally managed VPN with working GitLab DNS and verified HTTPS.
- Node.js `22.17.x` through nvm and pnpm `10.34.5` through Corepack.
- PostgreSQL for Control Plane inventory, observations, and Operations.
- Python `3.14` and uv for development checks. Deployed Agents use a
  package-free `.venv` based on Arch's Python.

## Install a local Runner Stack

This path prepares B only. Create the project-scoped Runner Record manually in
GitLab, then stream its one-time authentication token into registration.

```bash
cp stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml
$EDITOR stacks/gitlab-runners/frontend/config.yml

make validate STACK=gitlab-runners/frontend
make check STACK=gitlab-runners/frontend
make install STACK=gitlab-runners/frontend
```

Register after creating the Runner in GitLab:

```bash
read -rsp "GitLab Runner token: " RUNNER_AUTH_TOKEN
echo
printf '%s\n' "${RUNNER_AUTH_TOKEN}" | \
  make register STACK=gitlab-runners/frontend
unset RUNNER_AUTH_TOKEN
```

## Provision a Project Runner

After installing the separate `create_runner` credential and approving the
Project, one command creates a paused GitLab Runner Record and deploys its
isolated Stack on B:

```bash
pnpm runner:provision -- \
  --project namespace/project \
  --template gitlab-runners/dotnet
```

The command prompts through normal sudo policy. It never prints or persists
the one-time Runner authentication token.

## Uninstall from B

```bash
make uninstall STACK=gitlab-runners/frontend
```

For a provisioned instance:

```bash
make uninstall \
  STACK=gitlab-runners/dotnet \
  STACK_INSTANCE_ID=dotnet-REPLACE_WITH_12_HEX
```

Uninstall requires exact confirmation, then permanently removes the local
Runner manager, Host Agent, Linux user, installed configuration, cache, and
container storage. A canonical repository `config.yml` is preserved for
reinstallation. It never unregisters or deletes the GitLab Runner Record.

## Run the Control Plane

```bash
source /usr/share/nvm/init-nvm.sh  # Arch packaged nvm, when needed
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
uv sync --locked
cp apps/web/.env.example apps/web/.env
pnpm db:deploy
pnpm dev
```

Open `http://127.0.0.1:3000`. Production uses:

```bash
pnpm web:build
pnpm start
```

See [Control Plane operations](docs/control-plane.md) for PostgreSQL, GitLab
credentials, Agent bootstrap, and provisioning setup.

## Common commands

| Command | Purpose |
| --- | --- |
| `make validate-all` | Validate all Runner Templates and shared automation |
| `make lint` | Run Shell, YAML, Ansible, and secret checks |
| `make verify STACK=...` | Verify one installed Runner Stack |
| `make test-agent` | Run Host Agent tests |
| `pnpm validate:web` | Typecheck, test, lint, and build all Web packages |
| `pnpm gitlab:sync` | Run one read-only GitLab synchronization |
| `pnpm host:bootstrap-agent --stack ...` | Install or rotate one scoped Host Agent |

## Repository

```text
agent/        Python Host Agent and systemd user units
apps/web/     Next.js Control Plane, Prisma, connectors, and provisioning worker
packages/     Shared contracts and domain rules
playbooks/    Ansible entry points
roles/        Shared Host and Runner automation
stacks/       Supported Runner Templates and CI examples
scripts/      Operator workflows
tests/        Repository and infrastructure validation
```

Start with the [documentation index](docs/README.md). Product terminology is
defined in [CONTEXT.md](CONTEXT.md); [SPEC.md](SPEC.md) distinguishes current
behavior from longer-term targets.
