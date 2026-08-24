# platform-infra

[![Python 3.13](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)](https://www.python.org/downloads/)

Deploy isolated GitLab Runners on systemd Linux hosts with a typed Python CLI,
Ansible, and rootless Podman. Each stack owns a dedicated Linux account,
subordinate-ID range, Podman socket, Runner manager service, configuration, and
cache. The manager can use its Podman socket; CI job containers cannot.

This repository currently provides `frontend` and `dotnet` stacks. It manages
Runner host infrastructure and execution policy; application build commands and
tool versions belong in each consuming project's `.gitlab-ci.yml`.

## Isolation model

One stack maps to one independent host identity:

| Resource | Per-stack ownership |
| --- | --- |
| Linux account and home | Separate user, home directory, and lingering session |
| Rootless Podman | Separate subordinate UID/GID range and user socket |
| Runner manager | Separate unprivileged systemd user service and container |
| Registration | At most one persisted GitLab Runner registration |
| Jobs | One concurrent job, image allowlists, CPU/memory limits, no privileged mode |

The Runner manager uses the host network so it can follow the host's VPN route.
Jobs use isolated Podman networks and receive no Podman API socket mount. See
[Architecture](docs/ARCHITECTURE.md) for the deployment planes and trust
boundaries.

## Requirements

The control node needs Python, Git, and an active UTF-8 locale. Ansible requires
both its locale encoding and filesystem encoding to be UTF-8; verify the active
locale before running bootstrap or any CLI workflow:

```bash
locale charmap
```

The expected output is `UTF-8`. The bootstrap supports Arch, Debian, and Red
Hat package families and prepares the pinned Python, uv, and Ansible toolchain.

Managed hosts need:

- a supported systemd Linux distribution;
- cgroup v2;
- Python and sudo access;
- SSH access when the host is remote; and
- the configured VPN interface with access to the GitLab HTTPS endpoint.

Convergence installs the distribution's Podman and networking packages, then
requires Podman 4.2 or newer and aardvark-dns newer than 1.10.0. Supported host
families are Arch Linux; Debian and Ubuntu; and Fedora, RHEL, Rocky Linux, and
AlmaLinux. See [Distribution support](docs/DISTRIBUTIONS.md) for package,
version, upgrade, and CA trust behavior.

## Quick start

Run commands from the repository root.

### 1. Prepare the control node

```bash
python3 bootstrap.py
```

Bootstrap installs native packages, creates `.bootstrap-venv`, pins uv, syncs
the project from `uv.lock`, and installs the Ansible collections from
`requirements.yml`. It changes the control node and may invoke its native
package manager; review `bootstrap.py` before running it on a shared system.

If the Python environment is already installed and only the Ansible collections
are missing, run:

```bash
uv run --locked platform-infra setup
```

### 2. Create a local stack configuration

Start from one of the committed examples. Local `config.yml` files are ignored
by Git.

```bash
cp \
  stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml
$EDITOR stacks/gitlab-runners/frontend/config.yml

uv run --locked platform-infra validate \
  --stack gitlab-runners/frontend
```

Replace every `REPLACE_*` value before using a host command. If private CA
trust is enabled, point `tls.private_ca_source` at a local public `.crt` or
`.pem` certificate. This project does not manage private keys.

Use `validate-all` to cross-check all local stacks, falling back to committed
examples where no local configuration exists:

```bash
uv run --locked platform-infra validate-all
```

It rejects duplicate Runner users and services, overlapping subordinate-ID
ranges, missing CA files, invalid playbook syntax, and unsafe configuration.

### 3. Select the target host

The default inventory manages the control node itself through
`inventory/localhost.yml`. For a remote host, copy and edit the example:

```bash
cp inventory/hosts.example.yml inventory/hosts.yml
$EDITOR inventory/hosts.yml
```

The remaining examples use `inventory/hosts.yml`. Omit `--inventory` to use
localhost.

### 4. Check and install the host stack

```bash
uv run --locked platform-infra check \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml

uv run --locked platform-infra install \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml
```

`install` intentionally supports a new stack with no registration. It creates
and starts an unregistered Runner manager, so `status` reports
`registered: false` until registration succeeds.

### 5. Create and register the GitLab Runner

In GitLab, create the Runner at the intended instance, group, or project scope.
Configure its tags, protected/locked settings, and run-untagged policy there,
then obtain its Runner authentication token.

Run registration without placing the token in the command line. The CLI asks
for it using a hidden prompt:

```bash
uv run --locked platform-infra register \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml
```

For non-interactive automation, the CLI can instead read the token from the
`GITLAB_RUNNER_TOKEN` process environment. The value is forwarded only through
the registration process environment and protected with Ansible `no_log`; it
is not written to YAML, inventory, extra variables, command arguments, tests,
or logs.

Registration is idempotent only for the same persisted credential. A dedicated
stack rejects incomplete, multiple, or different registrations instead of
silently replacing them.

### 6. Confirm status and connectivity

```bash
uv run --locked platform-infra status \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml

uv run --locked platform-infra verify \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml
```

`status` reports the manager service, container, and local registration state.
`verify` requires exactly one persisted registration, verifies Runner
connectivity, and creates then removes a temporary job-like Podman network to
test GitLab access.

All host commands ask for the sudo become password by default. Add
`--no-ask-become-pass` only when passwordless privilege escalation is already
configured.

## Available stacks

| Stack | Default tags | Default job image | Stack notes |
| --- | --- | --- | --- |
| [`frontend`](stacks/gitlab-runners/frontend/) | `frontend`, `podman` | Node.js 22 on Debian Bookworm | [Frontend policy](stacks/gitlab-runners/frontend/README.md) |
| [`dotnet`](stacks/gitlab-runners/dotnet/) | `dotnet`, `podman` | .NET SDK 10 on Ubuntu Noble | [.NET policy](stacks/gitlab-runners/dotnet/README.md) |

To deploy the .NET stack, repeat the quick-start flow with
`gitlab-runners/dotnet`. Its example already uses a different account, service,
and subordinate-ID range, so it can coexist with `frontend` on the same host.

## Command reference

| Command | Scope and side effects |
| --- | --- |
| `setup` | Installs pinned Ansible collections in `.ansible/collections`. |
| `validate --stack ...` | Validates one local or example stack and checks playbook syntax. |
| `validate-all` | Validates all stacks and cross-stack ownership boundaries. |
| `check --stack ...` | Contacts managed hosts and checks platform, VPN, DNS, and GitLab reachability. |
| `install --stack ...` | Converges packages, accounts, systemd, Podman, TLS, and the Runner manager. |
| `register --stack ...` | Persists one Runner registration and runs post-registration verification. |
| `status --stack ...` | Contacts managed hosts and reports service, container, and registration state. |
| `verify --stack ...` | Verifies host state, registration, and job-like networking. |
| `idempotency --stack ...` | Converges twice and requires zero changes on the second pass. |
| `uninstall --stack ... --yes` | Removes the manager service/container and managed CA material. |
| `uninstall --stack ... --purge --yes` | Also removes the Runner data, registration, socket, lingering, account, and home. |

Every host command accepts `--inventory`; it defaults to
`inventory/localhost.yml`. Run `uv run --locked platform-infra --help` or a
subcommand's `--help` for the complete CLI syntax.

### Purge semantics

Purge is deliberately explicit and scoped to the selected stack:

```bash
uv run --locked platform-infra uninstall \
  --stack gitlab-runners/frontend \
  --inventory inventory/hosts.yml \
  --purge \
  --yes
```

This permanently removes that stack's local registration and host identity.
It does **not** delete or pause the Runner record in GitLab; remove that record
separately in the GitLab UI when it is no longer needed.

The existence of another isolated stack, such as `frontend` beside `dotnet`,
does not require purge. Purge is required only when the selected dedicated
stack already contains incomplete, multiple, or a different registration and
that local state should be discarded.

## Configuration and safety rules

The parser and validators are the configuration schema. The committed
`config.example.yml` files document the accepted fields and portable defaults.
Configuration fails closed by rejecting:

- unknown or secret-like YAML fields;
- unresolved local placeholders;
- non-HTTPS GitLab endpoints;
- unqualified, untagged, `latest`, or disallowed container images;
- privileged Runners or concurrency other than one; and
- shared users/services or overlapping subordinate-ID ranges across stacks.

Do not place authentication tokens, passwords, private keys, or other secrets
in stack YAML, inventory, repository files, command arguments, or logs. Local
stack configuration, remote inventory, and public CA certificates are ignored
by Git, but they should still be handled as operator-owned local state.

On Arch Linux, normal convergence installs packages without refreshing package
metadata. Set `runner_update_operating_system: true` in inventory only during
an explicit maintenance window; this performs repository refresh and a full
system upgrade together, avoiding a partial-upgrade path.

## Troubleshooting

### `registered: false`

`status` reads the selected stack's persisted Runner configuration; it does not
derive this value from the GitLab UI. Before registration, `false` is expected.
If GitLab shows a Runner online but local status remains false, confirm the
exact `--stack` and `--inventory`. Treat the selected host's persisted
configuration as authoritative before deciding whether to register or purge.

### Registration asks for purge

The selected stack already contains incomplete, multiple, or a different
registration. If the current registration must be preserved, use its matching
authentication token. If it can be discarded, run the explicit purge command
above, reinstall the same stack, and register it with the intended Runner.

### Privilege escalation fails

Host commands ask for a sudo password unless `--no-ask-become-pass` is set.
Use the flag only when the inventory user already has working passwordless
sudo. For remote hosts, also verify SSH connectivity and the configured Python
interpreter.

### Ansible cannot initialize the locale

List the locales already generated on the control node and confirm the active
character map:

```bash
locale -a
locale charmap
```

Select an installed UTF-8 locale, such as `C.UTF-8` or `en_US.UTF-8`. For a
temporary shell, set both locale variables to an entry shown by `locale -a`:

```bash
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
locale charmap
```

If no UTF-8 locale is available, install or generate one using the control
node distribution's locale configuration, then start a new login session.
Persist `LANG` in the operating system or user environment; reserve `LC_ALL`
for temporary overrides and diagnostics.

### Host validation fails

Connect the configured VPN first and verify that the host can resolve and reach
the configured GitLab health endpoint. For package versions, distribution
exceptions, and private CA locations, consult
[Distribution support](docs/DISTRIBUTIONS.md).

## Architecture

Python owns stack discovery, typed validation, secret input, command
composition, and process boundaries. Ansible owns persistent managed-host
state, including packages, accounts, systemd, Podman, TLS, and Runner
convergence. Domain and application code remain independent of YAML,
subprocesses, prompts, Ansible, and operating-system APIs.

See [Architecture](docs/ARCHITECTURE.md) for layer boundaries, deployment
planes, configuration ownership, manager networking, and token flow.

## Development

Run the complete local quality workflow before committing:

```bash
uv lock --check
uv run --locked platform-infra-quality
```

The quality command checks Python formatting and linting, strict typing, tests
with coverage, YAML, Ansible, and all stack configurations. To apply Python
formatting before rerunning the checks:

```bash
uv run --locked platform-infra-quality --fix
```

Repository-specific ownership, safety, and editing rules are in
[AGENTS.md](AGENTS.md).
