# Troubleshooting

## Control Plane observation ingestion

An HTTP `503` with `observation ingestion disabled` means the safe-default
feature flag is still active. Review
[Control Plane operations](control-plane.md) before enabling it.
Another generic `503` means PostgreSQL or the persistence adapter is
unavailable; inspect server-side service logs, but never log the Authorization
header or request body while diagnosing it.

An HTTP `401` means the credential ID or secret is invalid, expired, revoked,
unscoped, or belongs to a revoked Host. The response intentionally does not
identify which check failed. An HTTP `403` means the authenticated credential
tried to report another Host, another Stack, multiple Stacks, or a Stack
identity that is not registered exactly as submitted. Do not work around
either error by weakening identity checks.

An HTTP `400` means the strict v1 contract or timestamp check failed; `413`
means the report exceeded 64 KiB. Validate the structured payload locally and
remove unnecessary diagnostics. Never paste a real credential or token-bearing
payload into an issue or chat.

If the Host Agent reports `Agent file permissions are unsafe`, restore the
credential to owner-only mode `0600` and ensure both configuration and
credential are regular files owned by the Runner user. Do not replace the
check with a permissive mode or symlink. `Observation delivery failed` leaves
the bounded pending report in the Agent state directory; the next timer run
retries the same delivery ID. Inspect the service with:

```bash
systemctl --user status gitlab-runner-platform-agent.service
journalctl --user-unit gitlab-runner-platform-agent.service
```

The Agent intentionally prints neither the Authorization header nor response
body. A persistent failure should be diagnosed from Control Plane status,
HTTPS trust, credential lifecycle, and registered Host/Stack identity.

For same-Host staging, `allowPlaintextLoopback` works only with a literal
`http://127.0.0.1:<port>` or `http://[::1]:<port>` origin and a Control Plane
bound to that loopback address. `localhost`, LAN IPs, and Tailscale IPs are
rejected intentionally. Cross-host recovery requires valid HTTPS rather than
broadening the plaintext exception.

`host:bootstrap-agent` preserves the previous active credential until the new
Agent installation succeeds. If sudo is denied or installation fails, the new
credential is revoked with a `bootstrap_failed` audit reason and the command
can be retried. A finalization warning means the Agent was installed but older
credentials could not be revoked; inspect credential and audit state before
running bootstrap again.

## Read-only GitLab connector

`gitlab:sync` prints one bounded JSON summary and exits nonzero when any target
fails. `failed` with remaining `skipped` targets means the connector stopped
on a credential-wide authentication failure or GitLab rate limit. When
`retryAfterSeconds` is present, let the scheduler retry later; do not add an
unbounded sleep loop.

A single `runner_unavailable` audit reason means GitLab returned no visible
Runner for the exact enrolled ID. GitLab intentionally may not distinguish a
missing Runner from one the token cannot read. Check the `RunnerRecordRef` and
dedicated token visibility manually; do not broaden it to `manage_runner` or
enumerate projects to diagnose the ambiguity.

The command never prints raw GraphQL errors or HTTP response bodies. For a
persistent `request_failed`, verify the HTTPS base URL, DNS/TLS path, GitLab
availability, GraphQL compatibility, and database connectivity without adding
token or response-body logging. The previous successful GitLab observation is
preserved and becomes `unknown` when stale.

Start with:

```bash
make status STACK=gitlab-runners/frontend
make verify STACK=gitlab-runners/frontend
```

For user service logs, use the exact command printed by `make status`.

| Symptom | Checks |
| --- | --- |
| VPN interface missing | Connect the manually managed VPN; automation will not create it. |
| Host DNS fails | Check VPN DNS, host resolver, and `systemd-resolved`. |
| Runner works before reboot but jobs later stay pending | Set `network.vpn_dns` to the VPN resolver, then reinstall and verify. |
| Container DNS fails | Check Podman networking and confirm `network.vpn_dns` matches the active VPN resolver. |
| TLS fails | Check certificate chain, hostname, clock, and public CA path; never use `curl -k`. |
| Podman socket inactive | Check lingering, `user@UID.service`, and `podman.socket` user logs. |
| Netavark reports `Operation not supported` | Reboot after an Arch kernel upgrade; check verifies `bridge`, `veth`, and `br_netfilter`. |
| Quadlet service fails | Run `systemctl --user status` and `journalctl --user` as the Runner user. |
| Registration exists but verify fails | Preserve it; check GitLab reachability, token state, and GitLab UI. |
| Job cannot pull image | Confirm the full image reference matches `allowed_images`. |
| SQL Server service is rejected | Match the official SQL Server repository and `allowed_services`. |
| SQL Server never becomes ready | Check its pinned tag, EULA setting, and masked `MSSQL_SA_PASSWORD_UI`. |
| NuGet restore fails | Check source names and HTTPS URLs, then the matching masked credentials. |
| Browser tests crash | Confirm the 1 GiB shared-memory setting and host memory pressure. |

Do not unregister or delete a Runner automatically during diagnosis.

As a temporary recovery after the VPN is connected:

```bash
runner_uid="$(id -u gitlab-runner-frontend)"
sudo -u gitlab-runner-frontend \
  XDG_RUNTIME_DIR="/run/user/${runner_uid}" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${runner_uid}/bus" \
  systemctl --user restart gitlab-runner-frontend.service
```

The persistent fix is `network.vpn_dns`; the restart should not be necessary
after reinstalling the updated stack.
