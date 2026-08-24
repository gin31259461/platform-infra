# AGENTS Instructions

## Scope and priorities

These instructions apply to the entire repository. Optimize changes in this
order:

```text
Correctness
> Readability
> Testability
> Maintainability
> Performance
> Cleverness
```

Keep changes small, explicit, and supported by repository evidence. Preserve
unrelated worktree changes.

## Ownership boundaries

- `src/platform_infra/domain/` owns immutable models, validation invariants,
  and project-specific errors. It must not depend on YAML, subprocesses,
  prompts, Ansible, or operating-system APIs.
- `src/platform_infra/application/` owns stack discovery, cross-stack
  validation, use cases, command composition, and dependency protocols. Keep
  external I/O behind injected ports.
- `src/platform_infra/adapters/` owns YAML, filesystem, subprocess, and token
  input boundaries. Convert untyped external data into typed models here.
- `src/platform_infra/cli.py` is the composition, logging, argument, and exit
  code boundary. Do not move business rules into argparse handlers.
- `playbooks/` and `roles/` own persistent managed-host state. Do not
  reimplement package, account, systemd, Podman, TLS, or Runner convergence in
  Python.
- `stacks/**/config.example.yml` defines committed stack examples;
  `config.yml` is ignored local operator state. The parser and validators are
  authoritative for the configuration schema and invariants.
- `requirements.yml`, `pyproject.toml`, and `uv.lock` own their respective
  Ansible, Python, and resolved dependency versions. Keep them synchronized.

Read `docs/ARCHITECTURE.md` before changing a layer boundary, configuration
ownership, manager networking, or token flow. Read `docs/DISTRIBUTIONS.md`
before changing package or CA trust behavior.

## Python design rules

- Follow KISS, YAGNI, and single responsibility. Prefer explicit dependency
  injection over hidden process, filesystem, environment, or prompt access.
- Add complete parameter and return annotations to every public function and
  method. Keep core structures typed; do not use `Any` or `dict[str, Any]`.
- Prefer frozen, slotted dataclasses and immutable collections for domain and
  application values.
- Catch specific exceptions and translate expected failures into the existing
  `PlatformInfraError` hierarchy at the appropriate boundary.
- Isolate subprocess imports to `bootstrap.py` and
  `src/platform_infra/adapters/process.py`. Do not add a shell command layer,
  shell scripts, or a Makefile.
- Keep `bootstrap.py` compatible with Python 3.9; the installed project targets
  Python 3.13 and an 88-character line length.

Tests in `tests/test_architecture.py` enforce the main dependency, typing,
subprocess, shell-file, and line-length constraints. Change those contracts
only when the architecture intentionally changes.

## Configuration and Ansible rules

- Preserve fail-closed configuration behavior: reject unknown fields,
  secret-like keys, unresolved local placeholders, unsafe images, privileged
  Runners, concurrency other than one, shared Runner users or services, and
  overlapping subordinate-ID ranges.
- Keep authentication tokens at the registration boundary. Pass them through
  the process environment, use `no_log` wherever registration data can appear,
  and never serialize them into arguments, YAML, inventory, fixtures, or logs.
- Put portable defaults in typed parsing or role defaults. Put distribution
  package and CA differences in `roles/packages/vars/`; do not scatter
  platform conditionals through unrelated roles.
- Keep Arch package installation separate from repository refresh and full
  system upgrade. Never introduce a partial-upgrade path.
- Use Ansible modules for managed-host state. For unavoidable commands, use
  `argv`, define accurate `changed_when`, and make destructive scope explicit.
- Preserve idempotency and the one-account/one-socket/one-manager ownership
  model. Add or update focused tests when changing configuration, command
  composition, role contracts, or destructive behavior.

## Side effects and secrets

Local validation, linting, type checking, unit tests, and Ansible syntax checks
are safe by default. Treat these commands as side-effecting:

- `python3 bootstrap.py` installs native packages and creates local tool
  environments;
- `platform-infra setup` installs Ansible collections;
- inventory-backed `check`, `status`, and `verify` contact managed hosts, with
  `verify` creating and removing a temporary Podman network;
- `install`, `register`, and `idempotency` mutate managed hosts; and
- `uninstall` removes host state, while `uninstall --purge` also removes the
  account, home, cache, socket, and registration.

Do not run bootstrap, setup, deployment, registration, idempotency, or removal
workflows merely to validate code or documentation. Require explicit user
authorization and an exact inventory for live-host commands. Never print,
track, or place tokens, passwords, private keys, or secret values in repository
files, command arguments, logs, tests, fixtures, or examples. Public CA
certificates are the only certificate material this repository manages.

## Development workflow

Run Ansible-backed commands only with an active UTF-8 locale; `locale charmap`
must report `UTF-8`. Diagnose an invalid locale without changing operating
system locale configuration unless the user authorizes that host mutation.

Use focused tests while iterating, then run the repository-owned complete gate
before handoff:

```bash
uv lock --check
uv run --locked platform-infra-quality
```

The quality command owns Python formatting and linting, strict typing, tests
with coverage, YAML and Ansible linting, and stack validation. Update
`src/platform_infra/quality.py` when the repository-wide gate changes instead
of duplicating a second command inventory here.

Do not edit generated environments, caches, coverage output, or installed
collections. When dependencies intentionally change, update the manifest and
lockfile together.

## Documentation ownership

- Keep `README.md` focused on current operator and developer workflows.
- Keep this file focused on coding-agent decisions and safety boundaries.
- Update `docs/ARCHITECTURE.md` when responsibilities or deployment planes
  change, and `docs/DISTRIBUTIONS.md` when platform support changes.
- Keep version-bounded transition details in migration documents rather than
  the current README or agent contract.
