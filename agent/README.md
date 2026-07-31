# Host Agent

The Host Agent is a Python 3 standard-library executable that runs as the
dedicated Runner Linux user. One Agent instance reports one Runner Stack. If a
host has multiple isolated Runner users, give each instance a separate Agent
credential bound to its Stack and the same enrolled Host; do not copy one
secret between trust boundaries.

The Agent is read-only. It performs fixed checks for:

- VPN interface presence under `/sys/class/net`;
- DNS resolution and HTTPS/TLS verification for the configured GitLab host;
- the systemd user manager and fixed Runner Manager service;
- existence of the rootless Podman socket without opening it;
- existence, ownership, and exact `0600` mode of `config.toml` without reading
  its contents.

Runner version, running job count, and Drift are reported as unknown because
collecting them would currently require opening the Podman socket or reading
additional runtime configuration. The UI must preserve that distinction.

## Files

The executable accepts no command-line paths or commands. It uses these fixed
locations under the Runner user's home:

```text
~/.local/lib/gitlab-runner-platform/gitlab_runner_agent.py
~/.config/gitlab-runner-platform/agent.json
~/.config/gitlab-runner-platform/credential
~/.local/state/gitlab-runner-platform/pending-observation.json
~/.config/systemd/user/gitlab-runner-platform-agent.{service,timer}
```

The credential and outbox must be owned by the Runner user with mode `0600`.
The configuration must not be group- or world-writable. The outbox preserves
one delivery ID across transient failures and is removed only after HTTP `200`
or `202` acknowledgement.

## Staging installation

The preferred same-Host staging workflow needs only the canonical Stack. It
resolves the unique enrolled Host and Stack from PostgreSQL, generates a
256-bit secret without printing it, installs the scoped Agent through ordinary
sudo policy, enables the systemd user timer, and revokes superseded Stack
credentials only after installation succeeds.

```bash
pnpm host:bootstrap-agent --stack gitlab-runners/frontend
```

The default Control Plane origin is `http://127.0.0.1:3000`, which activates
the explicit same-Host staging exception. For HTTPS, supply an origin:

```bash
pnpm host:bootstrap-agent \
  --stack gitlab-runners/frontend \
  --control-plane-url https://runner-platform.example.invalid
```

The generated configuration is equivalent to this staging excerpt:

```json
{
  "allowPlaintextLoopback": true,
  "controlPlaneUrl": "http://127.0.0.1:3000"
}
```

Those fields are excerpts, not a complete configuration. Plaintext accepts
only literal `127.0.0.1` or `::1`; `localhost`, LAN, and Tailscale addresses
remain rejected. Keep `allowPlaintextLoopback` false for HTTPS and every
cross-host deployment. Do not disable certificate verification.

For an externally managed secret, the lower-level installer remains available
as an advanced workflow:

```bash
read -rs HOST_AGENT_SECRET
printf '%s' "${HOST_AGENT_SECRET}" | \
  STACK=gitlab-runners/frontend \
  HOST_ID=host-01 \
  RUNNER_STACK_ID=frontend-main \
  CREDENTIAL_ID=hac_REPLACE_WITH_CREDENTIAL_ID \
  CONTROL_PLANE_URL=https://runner-platform.example.invalid \
  make install-agent
unset HOST_AGENT_SECRET
```

Both workflows may prompt for sudo but never read a sudo password themselves.
They never put the Agent secret in arguments, environment variables, or
temporary files.

## Validation

```bash
make test-agent
```

No test opens a real Podman socket, changes systemd state, contacts GitLab, or
sends a live credential.
