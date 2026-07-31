# Getting started

This guide covers the supported Runner lifecycle and local Control Plane
development. Commands use `gitlab-runners/frontend`; substitute
`gitlab-runners/dotnet` for the .NET stack.

## Requirements

- Arch Linux with cgroup v2 and interactive sudo access.
- A manually managed VPN that reaches GitLab.
- Working GitLab DNS and a trusted HTTPS health endpoint returning `200`.
- A manually created project-scoped GitLab Runner.

Configure the GitLab Runner with the stack tags (`frontend,podman` or
`dotnet,podman`), disable untagged jobs, lock it to the project, and apply the
project's protected-ref policy.

The repository never configures the VPN or creates/deletes GitLab Runner
records. Review [Manual prerequisites](manual-prerequisites.md) before changing
the host.

## 1. Configure a stack

```bash
cp stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml
$EDITOR stacks/gitlab-runners/frontend/config.yml
```

Replace every `REPLACE_*` value. Real `config.yml` files are ignored and must
never be committed or printed. When the VPN replaces host DNS, set
`network.vpn_dns` to its resolver IP; automation applies it to the Runner
manager and CI job containers.

Validate before touching the host:

```bash
make validate STACK=gitlab-runners/frontend
make validate-all
```

## 2. Bootstrap the host

```bash
make bootstrap
sudo reboot
```

> [!WARNING]
> Bootstrap performs a full Arch package upgrade. Reboot so the running kernel
> matches installed modules, then reconnect the external VPN.

## 3. Check and install

```bash
make check STACK=gitlab-runners/frontend
make install STACK=gitlab-runners/frontend
```

`make check` is read-only. Installation adds required packages and kernel
modules, creates the dedicated Runner user and subordinate IDs, enables
lingering and rootless Podman, validates network/TLS behavior, and starts the
Quadlet-managed Runner manager.

## 4. Register

Create the project Runner in GitLab first. Stream its `glrt-...` token to the
supported command; never put it in arguments or a file.

For zsh:

```zsh
read -rs "GITLAB_RUNNER_TOKEN?GitLab Runner token: "
echo
export GITLAB_RUNNER_TOKEN
make register STACK=gitlab-runners/frontend
unset GITLAB_RUNNER_TOKEN
```

For Bash:

```bash
read -rsp "GitLab Runner token: " GITLAB_RUNNER_TOKEN
echo
export GITLAB_RUNNER_TOKEN
make register STACK=gitlab-runners/frontend
unset GITLAB_RUNNER_TOKEN
```

Registration streams the token to the Runner process without logging it or
placing it in command arguments, temporary files, or the repository.

## 5. Verify

```bash
make verify STACK=gitlab-runners/frontend
make status STACK=gitlab-runners/frontend
```

Run the stack smoke pipeline before adopting a complete CI example:

- [Frontend smoke CI](../stacks/gitlab-runners/frontend/tests/smoke.gitlab-ci.yml)
- [.NET smoke CI](../stacks/gitlab-runners/dotnet/tests/smoke.gitlab-ci.yml)

See the stack README for workload image, service, and consumer-pipeline
configuration.

## Control Plane development

Node is pinned by `.nvmrc`; the root `packageManager` field pins pnpm.

```bash
source /usr/share/nvm/init-nvm.sh  # Arch packaged nvm, when needed
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:3000`. The default uses fake observations and refuses
Agent ingestion. For PostgreSQL, Host Agent, and GitLab staging, follow
[Control Plane operations](control-plane.md).

Before committing:

```bash
make validate-all
make lint
make test-agent
pnpm validate:web
git diff --check
```

`make lint` requires ShellCheck, yamllint, ansible-lint, and ripgrep.

## Uninstall and recovery

Normal uninstall preserves Runner configuration, token, cache, and rootless
container storage:

```bash
make uninstall STACK=gitlab-runners/frontend
```

Purge permanently removes the dedicated user and its data:

```bash
./scripts/uninstall.sh gitlab-runners/frontend --purge
```

> [!CAUTION]
> Purge requires exact stack-specific confirmation and is not recoverable. It
> does not remove the corresponding GitLab Runner record.

Continue with [Troubleshooting](troubleshooting.md), [Migration](migration.md),
or [Rollback](rollback.md) when needed.
