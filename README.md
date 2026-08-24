# platform-infra

[![Python 3.13](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)](https://www.python.org/downloads/)

Deploy isolated GitLab Runners on systemd Linux hosts with a typed Python CLI,
Ansible, and rootless Podman. Each stack gets a dedicated Linux account,
Podman API socket, Runner manager, registration, and cache directory. The
manager can use the socket; CI job containers cannot.

## Requirements

The control node needs Python and Git. `bootstrap.py` supports Arch, Debian,
and Red Hat package families and prepares the pinned Python, uv, and Ansible
toolchain for this repository.

Managed hosts must provide:

- systemd user services and lingering;
- cgroup v2;
- rootless Podman 4.2 or newer;
- aardvark-dns newer than 1.10.0;
- subordinate UID and GID mappings; and
- Python plus SSH for remote management.

The roles support Arch Linux; Debian and Ubuntu; and Fedora, RHEL, Rocky Linux,
and AlmaLinux. See [distribution support](docs/DISTRIBUTIONS.md) for package,
version, and CA trust details.

## Prepare the control node

From the repository root, run the standard-library-only bootstrap:

```bash
python3 bootstrap.py
```

It installs the minimum native prerequisites, creates isolated local
environments, syncs dependencies from `uv.lock`, and installs the collections
in `requirements.yml`. Commit changes to `uv.lock`; do not commit `.venv`,
`.bootstrap-venv`, or `.ansible/collections`.

## Configure a Runner stack

Start from a committed example and edit the ignored local configuration:

```bash
cp \
  stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml
$EDITOR stacks/gitlab-runners/frontend/config.yml

uv run --locked platform-infra validate \
  --stack gitlab-runners/frontend
```

`validate-all` selects each local `config.yml` when present and otherwise
validates its committed `config.example.yml`. It also rejects duplicate Runner
accounts and services, overlapping subordinate-ID ranges, missing public CA
files, and invalid playbook syntax:

```bash
uv run --locked platform-infra validate-all
```

Local stack files, `inventory/hosts.yml`, and public CA files are ignored by
Git. Stack YAML rejects unknown, secret-like, and unsafe values. In particular,
Runners must remain unprivileged, isolated to one concurrent job, restricted by
image allowlists, and configured with registry-qualified images that do not use
the `latest` tag.

## Deploy and register

Create an inventory for the target hosts:

```bash
cp inventory/hosts.example.yml inventory/hosts.yml
$EDITOR inventory/hosts.yml
```

Check prerequisites, converge the host, then register and verify the Runner:

```bash
uv run --locked platform-infra check \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml

uv run --locked platform-infra install \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml

export GITLAB_RUNNER_TOKEN='glrt-...'
uv run --locked platform-infra register \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml
unset GITLAB_RUNNER_TOKEN

uv run --locked platform-infra verify \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml
```

The token reaches `ansible-playbook` through the process environment and is
handled under `no_log`; it is not written to YAML, inventory, extra variables,
or command arguments. Configure tags, protection, lock status, and
run-untagged policy in GitLab before copying the authentication token.

Use `--no-ask-become-pass` with host commands when passwordless privilege
escalation is already configured. The default inventory is
`inventory/localhost.yml`.

## Operate a stack

Every host command accepts `--stack` and `--inventory`:

| Command | Result |
| --- | --- |
| `status` | Reports manager, container, and registration state. |
| `verify` | Verifies host, Podman, manager, registration, and job networking. |
| `idempotency` | Converges twice and requires zero changes on the second pass. |
| `uninstall --yes` | Removes the manager service and managed CA material. |
| `uninstall --purge --yes` | Also removes the account, home, cache, socket, and registration. |

On Arch Linux, normal convergence installs packages without refreshing package
metadata. Set `runner_update_operating_system: true` in inventory only during
an explicit maintenance window to perform a repository refresh and full system
upgrade together.

## Architecture

Python owns stack discovery, typed validation, secret input, command
composition, and process boundaries. Ansible owns persistent managed-host
state, including packages, accounts, systemd, Podman, TLS, and Runner state.
The domain and application layers do not import infrastructure libraries.

See [architecture](docs/ARCHITECTURE.md) for layer boundaries, deployment
planes, configuration ownership, and token flow.

## Development

Run the same quality gates used by CI before committing:

```bash
uv lock --check
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked mypy --strict src tests bootstrap.py
uv run --locked pytest
uv run --locked yamllint .
uv run --locked ansible-lint
uv run --locked platform-infra validate-all
```

Repository-specific ownership, safety, and editing rules are in
[AGENTS.md](AGENTS.md).
