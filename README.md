# platform-infra

Python and Ansible automation for isolated GitLab Runner hosts backed by
rootless Podman.

Each stack owns one Linux account, one rootless Podman API socket, one Runner
manager container, one registration, and one cache directory. The Runner
manager receives the Podman socket. CI job containers do not receive it.

## Supported managed hosts

The managed host must provide:

- systemd with user services and lingering
- cgroup v2
- rootless Podman 4.2 or newer
- aardvark-dns newer than 1.10.0
- subordinate UID and GID mappings
- SSH and Python for remote Ansible management

The Ansible roles support these package families:

- Arch Linux
- Debian and Ubuntu
- Fedora, RHEL, Rocky Linux, and AlmaLinux

The roles intentionally reject Alpine, Void, and other non-systemd systems.
Those platforms require a different service lifecycle, not only different
package names.

See `docs/DISTRIBUTIONS.md` for package and version caveats.

## Architecture

```text
bootstrap.py
  -> pinned uv project environment
      -> typed Python CLI
          -> configuration validation and process orchestration
          -> Ansible playbooks
              -> packages, users, systemd, rootless Podman, TLS, Runner state
```

Python does not reimplement package management or service convergence.
Ansible owns persistent host state. Python owns stack parsing, validation,
command composition, token input, and application-level workflows.

See `docs/ARCHITECTURE.md` for layer boundaries and secret flow.

## Bootstrap the control node

Run the standard-library-only bootstrap from the repository root:

```bash
python3 bootstrap.py
```

The bootstrap:

1. Detects an Arch, Debian, or RedHat-family control node.
2. Installs the minimum native Python and Git packages.
3. Creates `.bootstrap-venv`.
4. Installs the pinned `uv` version in that isolated environment.
5. Generates `uv.lock` when it is missing or stale.
6. Syncs `.venv` from the lockfile.
7. Installs pinned Ansible collections under `.ansible/collections`.

Commit the generated `uv.lock`. Do not commit `.venv`, `.bootstrap-venv`, or
`.ansible/collections`.

## Configure a stack

```bash
cp \
  stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml

$EDITOR stacks/gitlab-runners/frontend/config.yml
```

Local `config.yml` files and public CA certificate files are ignored by Git.
Tokens, passwords, private keys, and secret-like fields are rejected from stack
YAML.

Validate one stack:

```bash
uv run --locked platform-infra validate \
  --stack gitlab-runners/frontend
```

Validate every local stack, or its committed example when no local config
exists:

```bash
uv run --locked platform-infra validate-all
```

## Inventory

Local host:

```bash
uv run --locked platform-infra install \
  --stack gitlab-runners/frontend \
  --inventory inventory/localhost.yml
```

Remote host:

```bash
cp inventory/hosts.example.yml inventory/hosts.yml
$EDITOR inventory/hosts.yml

uv run --locked platform-infra install \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml
```

Use `--no-ask-become-pass` when passwordless sudo is already configured.

## Deployment workflow

Check network prerequisites without changing the host:

```bash
uv run --locked platform-infra check \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml
```

Converge the host:

```bash
uv run --locked platform-infra install \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml
```

Create a GitLab Runner authentication token in GitLab, then register it:

```bash
export GITLAB_RUNNER_TOKEN='glrt-...'

uv run --locked platform-infra register \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml

unset GITLAB_RUNNER_TOKEN
```

The token is supplied to the local `ansible-playbook` process through an
environment variable. It is not written to inventory, stack YAML, generated
extra-vars, or command arguments. The Ansible registration task uses `no_log`
and injects the token into the remote registration process environment.

Runner tags, protection, lock status, and run-untagged policy are server-side
Runner attributes. Configure them when creating the Runner in the GitLab UI or
API before copying its authentication token. The `runner.tags` field documents
and validates the intended assignment; registration does not mutate GitLab
server-side attributes.

Verify and inspect:

```bash
uv run --locked platform-infra verify \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml

uv run --locked platform-infra status \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml

uv run --locked platform-infra idempotency \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml
```

Remove only the manager service and CA material:

```bash
uv run --locked platform-infra uninstall \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml \
  --yes
```

Purge the account, home, cache, rootless socket, and registration files:

```bash
uv run --locked platform-infra uninstall \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml \
  --purge \
  --yes
```

## Arch Linux updates

The package role never performs a partial Arch Linux repository refresh.
Normal convergence installs packages from the existing package database.
During an explicit maintenance window, enable a full system upgrade in
inventory:

```yaml
all:
  children:
    runner_hosts:
      vars:
        runner_update_operating_system: true
```

After the maintenance run, set it back to `false`.

## Quality gates

All Python tooling is configured in `pyproject.toml`.

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

These commands are mandatory in GitLab CI.

## Security invariants

- One dedicated Linux account and rootless Podman socket per stack.
- The manager container receives the Podman socket; CI jobs do not.
- `runner.privileged` must remain `false`.
- `runner.concurrent` must remain `1` for one-stack-per-account isolation.
- The manager uses host networking for VPN reachability.
- Jobs use per-build networks through `FF_NETWORK_PER_BUILD=1`.
- Image allowlists are required.
- Images must be registry-qualified and cannot use the `latest` tag.
- Private CA support installs only public certificates.
- TLS certificate verification is never disabled.
- Runner authentication tokens are accepted only at the registration boundary.
