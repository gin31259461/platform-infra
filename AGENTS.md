# AGENTS Instructions

## Project overview

`platform-infra` is an infrastructure automation monorepo for self-managed
Linux hosts. Its current stack installs one project-scoped frontend GitLab
Runner on Arch Linux.

The Runner manager is a rootless Podman container managed by a systemd user
Quadlet. GitLab Runner uses the Docker executor protocol against that user's
Podman socket. The manager uses host networking to reach GitLab over a
manually managed VPN; CI job containers use isolated per-build networks.

This file applies to the entire repository. There are currently no nested
`AGENTS.md` files.

## Read first

- Human setup and operations: `README.md`
- Trust boundaries: `docs/security.md`
- Component flow: `docs/architecture.md`
- Common failures: `docs/troubleshooting.md`
- Stack conventions: `docs/adding-a-stack.md`
- Runner stack conventions: `docs/adding-a-runner-stack.md`

The repository has no active `SPEC.md`; treat executable code, tests, and the
documents above as the source of truth.

## Repository map

- `playbooks/gitlab-runner.yml`: ordered orchestration for Runner stacks
- `roles/common/`: shared host, systemd, Podman, network, and TLS behavior
- `roles/gitlab_runner/`: Runner user, manager, and runtime validation
- `stacks/<type>/<workload>/`: workload configuration, examples, and smoke CI
- `scripts/`: implementations behind Make targets
- `scripts/lib/`: common privilege and stack-resolution helpers
- `tests/`: lint, schema, regression, idempotency, and live verification
- `inventory/localhost.yml`: local-only Ansible inventory
- `.gitlab-ci.yml`: repository lint and validation pipeline

The supported stack is `gitlab-runners/frontend`.

## Commands

Use canonical stack names, never caller-supplied filesystem paths:

```bash
STACK=gitlab-runners/frontend
```

Fast, non-destructive repository checks:

```bash
make validate STACK="${STACK}"
make validate-all
make lint
```

Live diagnostic checks on a configured Arch host:

```bash
make check STACK="${STACK}"
make status STACK="${STACK}"
make verify STACK="${STACK}"
```

Host-mutating workflows:

```bash
make bootstrap
make install STACK="${STACK}"
make register STACK="${STACK}"
make idempotency STACK="${STACK}"
make uninstall STACK="${STACK}"
```

Do not run host-mutating commands for a review, explanation, or diagnosis-only
request. `make bootstrap` performs a full Arch upgrade. `make install` changes
packages, users, subordinate IDs, kernel-module configuration, user services,
and containers. Registration changes local Runner configuration and contacts
GitLab. Obtain appropriate user authorization before these operations.

`./scripts/uninstall.sh <stack> --purge` is destructive and permanently
removes the dedicated local user and Runner data. Normal uninstall preserves
configuration and cache.

## Local setup

The local stack config is deliberately untracked:

```bash
cp stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml
```

Never commit or print the real `config.yml` when it contains environment
details. Replace every `REPLACE_*` value before live checks.

Bootstrap installs `ansible-core`, Git, Python, and the collections pinned in
`requirements.yml`. Runtime package installation is handled by the
`common/arch_packages` role.

The VPN is an external prerequisite. Automation may validate its interface,
DNS, and HTTPS path, but must not create, configure, reconnect, or store
credentials for it.

## Testing expectations

Run the smallest relevant check first, then the broader suite.

### Configuration or stack changes

```bash
make validate STACK=gitlab-runners/frontend
make validate-all
```

`tests/validate-stack.sh` validates the local `config.yml` when present;
otherwise it validates `config.example.yml`. It also runs Ansible syntax
checking when `ansible-playbook` is installed.

### DNS or Runner configuration changes

```bash
./tests/test-vpn-dns.sh
make validate-all
```

The DNS regression test renders the real Quadlet template and verifies that
Runner TOML reconciliation preserves its token and `0600` permissions.

### Shell, YAML, Ansible, or security-boundary changes

```bash
make lint
make validate-all
```

`make lint` requires:

- ShellCheck
- yamllint
- ansible-lint
- ripgrep

It also checks for leaked Runner tokens and private keys.

### Live host changes

When authorized and the supported Arch host is available:

```bash
make check STACK=gitlab-runners/frontend
make install STACK=gitlab-runners/frontend
make verify STACK=gitlab-runners/frontend
make idempotency STACK=gitlab-runners/frontend
```

Live commands require the VPN, Podman, systemd user manager, and often
interactive sudo. Never work around a password prompt or ask the user to
expose a password.

Before handing off a change, run `git diff --check`. Add or update a focused
regression test for every reproducible bug.

## Shell conventions

- Every Bash script starts with `#!/usr/bin/env bash` and
  `set -Eeuo pipefail`.
- Quote expansions and use arrays for constructed commands.
- Resolve stack names through `scripts/lib/stack.sh`; do not accept arbitrary
  paths or weaken its traversal checks.
- Use `as_root` and `as_runner_user` from `scripts/lib/common.sh` instead of
  duplicating privilege logic.
- Commands executed through `runuser` must set `chdir` to the Runner home.
  `tests/lint.sh` enforces this for Ansible command tasks.
- Never enable shell tracing in token-handling code.
- Keep destructive targets explicit and validated.

## Ansible and YAML conventions

- Use fully qualified collection names such as
  `ansible.builtin.command`.
- Prefer module parameters and `argv` over shell command strings.
- Use `shell` only when pipelines or shell language are genuinely required.
- Add accurate `changed_when`, `failed_when`, and `when` conditions.
- Preserve idempotency; a second install must report `changed=0`.
- Keep privilege escalation at the role boundary in the playbook. Preflight
  remains unprivileged.
- Shared behavior belongs in `roles/common` or `roles/gitlab_runner`; stack
  directories contain workload-specific values and examples.
- Use two-space YAML indentation. The lint limit is 140 characters.
- Preserve the two-level role layout required by this repository; the
  intentional `role-name[path]` exception is in `.ansible-lint`.

Quadlet files generate transient systemd services. Do not run
`systemctl --user enable` on the generated Runner service. Put
`WantedBy=default.target` in the `.container` file and use `start` or
`try-restart` after `daemon-reload`.

## Python conventions

- Prefer the standard library unless an existing runtime dependency is
  already guaranteed.
- Parse YAML/TOML structurally when correctness or secret preservation
  matters.
- When editing token-bearing files, never print file contents or register them
  in Ansible output.
- Preserve file ownership and restrictive permissions during atomic writes.
- Keep helper output minimal and machine-readable when Ansible uses it for
  `changed_when`.

## Stack and image conventions

Stack names must match:

```text
^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$
```

Every stack requires a `README.md` and `config.example.yml`. New Runner stacks
must use a unique Linux user, service name, container name, token, cache, tags,
and trust boundary.

Keep these security defaults unless an explicit review approves a change:

- `runner.concurrent: 1`
- `runner.privileged: false`
- manager host networking enabled
- per-build job networking enabled
- job volumes limited to `/cache`
- Podman socket mounted only into the manager

Use full registry-qualified image references. Pin fixed images to explicit
versions; do not use `latest` or generic `alpine`. Keep wildcard entries
limited to the explicit `allowed_images` repositories.

## Secrets and safety

Never commit, log, echo, or expose:

- `GITLAB_RUNNER_TOKEN`
- the installed token-bearing `config.toml`
- VPN credentials or private keys
- real `stacks/**/config.yml`
- files under `secrets/`
- `.env` files

Registration must continue to stream `GITLAB_RUNNER_TOKEN` over standard
input. Do not move it into Podman arguments, Ansible variables, temporary
files, or shell history.

Do not use `curl -k`, disable TLS verification, mount the Podman socket into
jobs, enable privileged jobs, or activate a Docker daemon.

Do not automatically unregister or delete a Runner through the GitLab API.
During diagnosis, preserve failed registrations and token-bearing config for
manual inspection.

## Documentation expectations

Update `README.md` when setup, supported commands, requirements, or operational
behavior changes. Update the matching file under `docs/` for architecture,
security, migration, rollback, or troubleshooting details. Keep
`stacks/gitlab-runners/frontend/README.md` focused on that stack.

Examples must use placeholder hosts and must not include real tokens or private
environment data.

## Commits

Use the user's preferred Conventional Commit format:

```text
type: concise lowercase message
```

Examples:

```text
docs: add contributor instructions
fix: preserve runner dns after reboot
test: cover runner config reconciliation
```

Keep each commit focused. Do not amend, rebase, push, or otherwise rewrite
history unless the user explicitly asks.
