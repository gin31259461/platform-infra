# Getting started

Commands below use `gitlab-runners/frontend`; substitute
`gitlab-runners/dotnet` when needed.

## Before automation

Confirm the Host has:

- Arch Linux with cgroup v2 and interactive sudo;
- an externally managed VPN connected to GitLab;
- working GitLab DNS and a verified HTTPS endpoint returning `200`;
- enough disk, CPU, and memory for one isolated Runner Stack.

Automation never configures the VPN. Keep deployment workloads on a separate
Runner trust boundary.

## Bootstrap B

```bash
make bootstrap
sudo reboot
```

> [!WARNING]
> Bootstrap performs a full Arch package upgrade. Reboot before continuing so
> the running kernel matches installed networking modules, then reconnect the
> VPN.

## Local-only installation

Copy and edit the ignored Stack configuration:

```bash
cp stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml
$EDITOR stacks/gitlab-runners/frontend/config.yml
```

Replace every `REPLACE_*` value. Set `network.vpn_dns` when the VPN supplies a
resolver. Real `config.yml` files must never be committed or printed.

Validate and install:

```bash
make validate STACK=gitlab-runners/frontend
make check STACK=gitlab-runners/frontend
make install STACK=gitlab-runners/frontend
```

`make check` is read-only. `make install` creates or reconciles the Linux user,
rootless Podman, Quadlet, cache, and Runner manager without creating a GitLab
Runner Record.

Create a project-scoped Runner in GitLab with the Stack tags, locked to the
Project and with untagged jobs disabled. Stream its one-time token into
registration:

```bash
read -rsp "GitLab Runner token: " RUNNER_AUTH_TOKEN
echo
printf '%s\n' "${RUNNER_AUTH_TOKEN}" | \
  make register STACK=gitlab-runners/frontend
unset RUNNER_AUTH_TOKEN
```

Verify and run the Stack smoke pipeline:

```bash
make verify STACK=gitlab-runners/frontend
make status STACK=gitlab-runners/frontend
```

## One-command Project provisioning

This path requires the Control Plane database, a separate installed GitLab
credential with `create_runner`, one active Runner Host, approved Template
revisions, and an allowlisted Project. Prepare the Project once:

```bash
pnpm provisioning:project:allow -- --path namespace/project
```

Then deploy one isolated, initially paused Project Runner:

```bash
pnpm runner:provision -- \
  --project namespace/project \
  --template gitlab-runners/dotnet
```

The command authorizes a durable Operation, derives a fixed Stack identity,
prepares B, creates the paused GitLab Runner Record, streams its one-time token
to registration, records the correlation, and installs the scoped Host Agent.
A partial failure remains visible and never triggers automatic GitLab deletion.

## Host Agent

After the Stack is enrolled in PostgreSQL, install or rotate its scoped Agent:

```bash
pnpm host:bootstrap-agent --stack gitlab-runners/frontend
```

For a provisioned instance:

```bash
pnpm host:bootstrap-agent \
  --stack gitlab-runners/dotnet \
  --stack-id dotnet-REPLACE_WITH_12_HEX
```

The Agent runs as the Runner user from its own package-free `.venv`.

## Uninstall from B

Canonical Stack:

```bash
make uninstall STACK=gitlab-runners/frontend
```

Provisioned instance:

```bash
make uninstall \
  STACK=gitlab-runners/dotnet \
  STACK_INSTANCE_ID=dotnet-REPLACE_WITH_12_HEX
```

Type the exact confirmation shown. Uninstall permanently removes the local
Runner manager, Agent, Linux user, home, token-bearing config, cache, and
container storage. A generated instance config is also removed from the fixed
ignored staging directory.

The GitLab Runner Record is deliberately preserved. Pause or delete it in
GitLab only after reviewing its jobs and replacement capacity.

## Development setup

```bash
sudo pacman -S --needed uv
source /usr/share/nvm/init-nvm.sh  # Arch packaged nvm, when needed
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
uv sync --locked
cp apps/web/.env.example apps/web/.env
```

Configure PostgreSQL and GitLab as described in
[Control Plane](control-plane.md), then run `pnpm dev`.

Before handoff:

```bash
make lint
make validate-all
make test-agent
pnpm validate:web
git diff --check
```
