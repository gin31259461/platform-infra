# platform-infra

Infrastructure automation for project-scoped GitLab Runners on self-managed
Arch Linux hosts.

The current `frontend` stack runs both the GitLab Runner manager and its CI
jobs with rootless Podman. It is designed for GitLab instances reachable
through a manually managed VPN, with explicit DNS handling for reliable
recovery after a host reboot.

## What it provides

- One dedicated Linux user and rootless Podman socket per Runner stack
- A Quadlet-managed GitLab Runner manager with systemd user lingering
- Docker executor compatibility through the Podman API socket
- Per-build job networks with no runtime socket exposed to CI jobs
- Explicit VPN DNS for both the manager and job containers
- Optional private-CA installation without disabling TLS verification
- Idempotent Ansible installation, local verification, and safe uninstall
- Pinned container images and a narrow job-image allowlist

> [!IMPORTANT]
> This repository does not install or configure the VPN and does not create,
> pause, delete, or otherwise manage GitLab Runner records through the GitLab
> API. Those operations remain manual.

## Architecture

```text
GitLab over VPN
      ^
      | outbound HTTPS polling
      |
Arch Linux host
  `-- dedicated runner user
      |-- systemd user manager + lingering
      |-- rootless podman.socket
      `-- GitLab Runner manager (Quadlet, host network)
          |-- explicit VPN DNS when configured
          |-- Podman socket mounted at /run/podman/podman.sock
          `-- isolated CI job containers
              |-- per-build network
              |-- /cache volume only
              `-- no host network or Podman socket
```

GitLab Runner speaks the Docker executor protocol to the rootless Podman
socket. The manager receives that socket; job containers never do. See
[Architecture](docs/architecture.md) and [Security](docs/security.md) for the
full trust-boundary description.

## Requirements

- Arch Linux with cgroup v2
- A user with sudo access
- A configured VPN that can reach the GitLab server
- GitLab hostname resolution and a trusted HTTPS endpoint returning `200`
- A manually created, project-scoped GitLab Runner

Configure the GitLab Runner with:

- Tags: `frontend`, `podman`
- Run untagged jobs: disabled
- Lock to current project: enabled
- Protected status: according to the project's release policy

If `https://<gitlab-hostname>/-/health` is unavailable, set `gitlab.health_url`
to another stable, unauthenticated HTTPS endpoint on that server that returns
`200`.

## Quick start

### 1. Create the local stack configuration

```bash
cp stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml
$EDITOR stacks/gitlab-runners/frontend/config.yml
```

Replace every `REPLACE_*` value. The local `config.yml` is ignored by Git.

When the VPN replaces the host resolver during startup, set
`network.vpn_dns` to the VPN DNS server's IP address. For this host's
Tailscale setup:

```yaml
network:
  vpn_interface: tailscale0
  vpn_dns: "100.100.100.100"
  use_host_network_for_runner_manager: true
```

The resolver is applied to both the Runner manager and CI job containers.

### 2. Bootstrap and reboot

```bash
make bootstrap
sudo reboot
```

> [!WARNING]
> Bootstrap performs a full Arch Linux package upgrade. Reboot afterward so
> the running kernel matches the installed module tree.

After reboot, reconnect the VPN before continuing.

### 3. Check and install

```bash
cd /path/to/platform-infra

make check STACK=gitlab-runners/frontend
make install STACK=gitlab-runners/frontend
```

`make check` is read-only. `make install` requests the sudo become password in
an interactive terminal, then:

- installs the rootless Podman packages;
- persists and loads `bridge`, `veth`, and `br_netfilter`;
- creates the dedicated Runner user and subordinate ID ranges;
- enables systemd lingering and the rootless Podman socket;
- validates VPN, DNS, HTTPS, and Podman networking;
- installs and starts the Runner manager Quadlet.

### 4. Register the Runner

Create the Project Runner in GitLab first, then copy its `glrt-...`
authentication token.

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

Registration streams the token to the Runner process. It does not place the
token in command arguments, logs, temporary files, or the repository.

### 5. Verify

```bash
make verify STACK=gitlab-runners/frontend
make status STACK=gitlab-runners/frontend
```

Then run the minimal
[smoke pipeline](stacks/gitlab-runners/frontend/tests/smoke.gitlab-ci.yml)
before adopting the complete
[frontend CI example](stacks/gitlab-runners/frontend/examples/frontend.gitlab-ci.yml).

## Configuration

The stack configuration is grouped by responsibility:

| Section | Purpose |
| --- | --- |
| `stack` | Stack type, identifier, and description |
| `gitlab` | GitLab URL, hostname, and HTTPS health endpoint |
| `runner` | Identity, resource limits, image, tags, and image allowlist |
| `network` | VPN interface, optional VPN DNS, and manager network mode |
| `tls` | Optional public private-CA certificate source |
| `frontend` | Pinned images and package-tool versions used by frontend CI |

Important invariants enforced by validation:

- `runner.concurrent` is `1`.
- `runner.privileged` is `false`.
- The manager uses host networking; jobs do not.
- Fixed images are registry-qualified and pinned.
- Job images must match the configured allowlist.
- `network.vpn_dns`, when set, must be an IP address.
- Runner users cannot be shared by configured stacks.
- Secrets and private keys are rejected from stack configuration.

After changing `network.vpn_dns`, run `make install` again. Installation
reconciles the existing token-bearing `config.toml` without exposing or
replacing its token.

## Commands

All stack commands require a canonical name such as
`STACK=gitlab-runners/frontend`.

| Command | Purpose |
| --- | --- |
| `make help` | Show available targets |
| `make bootstrap` | Upgrade Arch packages and install Ansible dependencies |
| `make validate STACK=...` | Validate one stack and run Ansible syntax check |
| `make validate-all` | Validate every discovered stack and regression test |
| `make check STACK=...` | Run live, read-only host preflight checks |
| `make install STACK=...` | Reconcile the host and Runner manager |
| `make register STACK=...` | Register once using `GITLAB_RUNNER_TOKEN` |
| `make verify STACK=...` | Verify network, Podman, service, config, and Runner |
| `make status STACK=...` | Print concise operational status and log command |
| `make idempotency STACK=...` | Install twice and require zero second-run changes |
| `make uninstall STACK=...` | Stop the stack while preserving config and cache |
| `make lint` | Run ShellCheck, yamllint, ansible-lint, and secret scans |

## Uninstall and recovery

Normal uninstall preserves the Runner configuration, token, cache, and
rootless container storage:

```bash
make uninstall STACK=gitlab-runners/frontend
```

Purge permanently removes the dedicated local user and its data:

```bash
./scripts/uninstall.sh gitlab-runners/frontend --purge
```

> [!CAUTION]
> Purge requires typing the exact stack-specific confirmation and cannot be
> recovered by this repository. It still does not delete the Runner record
> from GitLab.

For restart, migration, and failure recovery, see:

- [Troubleshooting](docs/troubleshooting.md)
- [Migration](docs/migration.md)
- [Rollback](docs/rollback.md)

## Development

The repository uses Bash, Python, YAML, Jinja, Ansible, systemd user services,
Quadlet, and rootless Podman.

Run the non-destructive checks before committing:

```bash
make validate-all
make lint
```

`make lint` requires `shellcheck`, `yamllint`, `ansible-lint`, and `rg`.
GitLab CI installs its pinned tool versions before running the same checks.
Live installation and verification require the supported Arch Linux host,
active VPN, and sudo access.

## Repository layout

```text
.
|-- playbooks/                 # Stack orchestration
|-- roles/common/              # Host, Podman, network, TLS, and systemd roles
|-- roles/gitlab_runner/       # Runner user, manager, and validation roles
|-- stacks/gitlab-runners/     # Workload-specific configuration and CI examples
|-- scripts/                   # Make target implementations and shared helpers
|-- tests/                     # Schema, lint, regression, and live verification
|-- inventory/localhost.yml    # Local Ansible inventory
`-- docs/                      # Architecture and operational guides
```

To extend the repository, start with [Adding a stack](docs/adding-a-stack.md)
or [Adding a Runner stack](docs/adding-a-runner-stack.md).
