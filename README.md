# platform-infra

Infrastructure automation monorepo for self-managed Linux hosts. Phase one
installs a project-scoped frontend GitLab Runner on Arch Linux. The Runner
manager and its CI jobs use rootless Podman; no Docker daemon, DinD,
privileged container, VPN credentials, or GitLab Runner lifecycle API is used.

## Architecture

The host VPN is managed manually. A dedicated Linux user owns one rootless
Podman socket and one Quadlet-managed Runner manager. GitLab Runner uses its
Docker executor protocol against that Podman socket. The socket is mounted
only into the manager, never into CI job containers.

```text
GitLab over VPN
      ^
      | HTTPS polling
Arch Linux host
      `-- gitlab-runner-frontend
          |-- systemd user manager + lingering
          |-- rootless podman.socket
          `-- GitLab Runner manager (Quadlet, host network)
              `-- isolated CI job containers (no host network or socket)
```

See [architecture](docs/architecture.md) and [security](docs/security.md).

## Prerequisites

Prepare an Arch Linux host, connect its manually managed VPN, and create a
Project Runner in the GitLab UI. Configure tags `frontend` and `podman`,
disable untagged jobs, and lock the Runner to the project. See
[manual prerequisites](docs/manual-prerequisites.md).

## Quick start

Create the local configuration:

```sh
cp stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml
$EDITOR stacks/gitlab-runners/frontend/config.yml
```

When the VPN replaces host DNS during startup, set `network.vpn_dns` to the
VPN resolver IP. For this host's Tailscale DNS, use `100.100.100.100`.
Installation applies it to both the Runner manager and CI job containers.

Bootstrap performs a full Arch Linux package upgrade. Reboot before installing
the stack so the running kernel matches the installed modules:

```sh
sudo make bootstrap
sudo reboot
```

After reboot, reconnect the manually managed VPN and return to the repository.
The preflight check verifies that the running kernel has the required modules;
installation persists and loads them automatically:

```sh
cd platform-infra

make check STACK=gitlab-runners/frontend
make install STACK=gitlab-runners/frontend
```

Create the Project Runner in GitLab before registering it. For zsh, read the
token without displaying it or adding it to shell history:

```zsh
read -rs "GITLAB_RUNNER_TOKEN?GitLab Runner token: "
echo
export GITLAB_RUNNER_TOKEN
make register STACK=gitlab-runners/frontend
unset GITLAB_RUNNER_TOKEN
```

Then verify the completed installation:

```sh
make verify STACK=gitlab-runners/frontend
make status STACK=gitlab-runners/frontend
```

After changing `network.vpn_dns`, run `make install` again. It reconciles the
existing Runner configuration without exposing or replacing its token.

For Bash, the equivalent token input command is:

```bash
read -rsp "GitLab Runner token: " GITLAB_RUNNER_TOKEN
echo
export GITLAB_RUNNER_TOKEN
```

Run the frontend smoke pipeline before adopting the complete consumer CI
example. The local `config.yml`, Runner token, VPN credentials, private keys,
and actual `config.toml` must never be committed.

## Operations

All stack operations require a canonical stack name such as
`gitlab-runners/frontend`; arbitrary paths and traversal are rejected.

```bash
make validate STACK=gitlab-runners/frontend
make idempotency STACK=gitlab-runners/frontend
make uninstall STACK=gitlab-runners/frontend
./scripts/uninstall.sh gitlab-runners/frontend --purge
```

Normal uninstall preserves config and cache. Purge requires an interactive,
stack-specific confirmation and permanently removes local Runner data. Neither
mode changes the VPN or calls the GitLab API.

For recovery and maintenance, see [migration](docs/migration.md),
[troubleshooting](docs/troubleshooting.md), and [rollback](docs/rollback.md).
