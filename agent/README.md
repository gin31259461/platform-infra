# Host Agent

The Host Agent is a read-only Python standard-library process installed for
one Runner user and one Runner Stack. Each Stack receives a different scoped
credential, even when several Stacks share a physical Host.

## Checks

- VPN interface presence
- GitLab DNS resolution
- verified GitLab TLS and HTTPS connectivity
- systemd user manager state
- Podman socket presence without opening it
- Runner manager service state
- `config.toml` ownership, type, and exact `0600` mode without reading it

Runner version, running jobs, and Drift remain unknown because the Agent does
not open the Podman socket or read token-bearing Runner configuration.

## Scheduling

The systemd timer polls authenticated `GET /api/v1/observations/refresh` every
five seconds. Polling runs no Host checks unless the server responds with
`missing`, `stale`, or `startup`. Startup refresh is enabled by default.

The response cannot contain an Operation, command, or path. Observations are
sent to `POST /api/v1/observations` with one Host-and-Stack-bound credential.
A bounded local outbox preserves the delivery UUID across transient failures.

## Files

```text
~/.local/share/gitlab-runner-platform/venv/bin/python
~/.local/lib/gitlab-runner-platform/gitlab_runner_agent.py
~/.config/gitlab-runner-platform/agent.json
~/.config/gitlab-runner-platform/credential
~/.local/state/gitlab-runner-platform/pending-observation.json
~/.config/systemd/user/gitlab-runner-platform-agent.{service,timer}
```

The installer creates a package-free `.venv`; systemd runs it with Python
isolated mode. Credential and pending files use `0600`; state and credential
directories use `0700`.

## Install or rotate

Same-host staging:

```bash
pnpm host:bootstrap-agent --stack gitlab-runners/frontend
```

Provisioned instance:

```bash
pnpm host:bootstrap-agent \
  --stack gitlab-runners/dotnet \
  --stack-id dotnet-REPLACE_WITH_12_HEX
```

The default origin is the explicit same-host exception
`http://127.0.0.1:3000`. Cross-host Agents require verified HTTPS:

```bash
pnpm host:bootstrap-agent \
  --stack gitlab-runners/frontend \
  --control-plane-url https://runner-platform.example.invalid
```

Bootstrap generates the secret in memory, stores only its digest in
PostgreSQL, streams it to the Runner user's fixed file, and revokes superseded
credentials after successful installation. It never prints the secret.

## Validate

```bash
make test-agent
```

Tests do not change systemd, contact GitLab, open Podman, or use live
credentials.
