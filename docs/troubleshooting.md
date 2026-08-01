# Troubleshooting

Start with read-only checks:

```bash
make check STACK=gitlab-runners/frontend
make status STACK=gitlab-runners/frontend
make verify STACK=gitlab-runners/frontend
```

For an instance, also set `STACK_INSTANCE_ID`.

## Host observations

`503 observation ingestion disabled` means
`PLATFORM_OBSERVATION_INGESTION` is not enabled. Other `503` responses usually
indicate database or adapter failure. Never log the Authorization header or
request body.

`401` means the Agent credential is invalid, expired, revoked, unscoped, or
belongs to a revoked Host. `403` means its report targets a different or
unregistered Stack. Do not weaken identity checks.

`Observation delivery failed` preserves the bounded pending delivery for the
next timer run when the Host and Stack identity is unchanged. A current Agent
discards an outbox entry from a previous enrollment before collecting fresh
evidence. `Observation refresh request failed` means the Agent could not obtain
its scheduling decision and does not fabricate a report.

Inspect the Runner user's units:

```bash
systemctl --user status gitlab-runner-platform-agent.timer
systemctl --user status gitlab-runner-platform-agent.service
journalctl --user-unit gitlab-runner-platform-agent.service
```

The installed timer should poll every five seconds. Startup forcing is enabled
by default. If GitLab refreshes but Host state remains unknown, confirm the
installed Agent is current and `.env` does not explicitly set
`PLATFORM_FORCE_HOST_REFRESH_ON_START=disabled`.

## GitLab synchronization

If the monitoring credential is unavailable, reinstall it through stdin:

```bash
read -rs GITLAB_READ_API_TOKEN
printf '%s' "${GITLAB_READ_API_TOKEN}" | \
  pnpm gitlab:credential:install -- --purpose monitoring
unset GITLAB_READ_API_TOKEN
```

`pnpm gitlab:sync` returns a bounded summary. Authentication or rate limiting
may stop remaining targets; wait for a reported `Retry-After` before retrying.
The previous successful observation is preserved.

`runner_unavailable` means the exact correlated ID was not visible. Confirm
the database reference and token visibility manually; do not broaden the token
or enumerate unrelated Projects.

`gitlab-connectivity` is degraded when the configured health URL returns a
non-2xx status. Browsers may hide this by following redirects. Use an exact
verified endpoint such as `/users/sign_in` when supported.

## Server lifecycle

`pnpm dev` and `pnpm start` should exit zero after one Ctrl-C. If pnpm reports
status 130, confirm the checked-in Node/pnpm versions and that signal handlers
were not changed from persistent to one-shot.

Startup intentionally fails before opening Web when PostgreSQL, required
configuration, or the monitoring credential cannot initialize. A failure for
one GitLab Runner target does not block Web.

Do not run `pnpm gitlab:watch` beside the supervised server.

## Runner Host

| Symptom | Check |
| --- | --- |
| VPN interface missing | Reconnect the externally managed VPN |
| Host DNS fails | Check VPN DNS and the host resolver |
| Jobs stay pending after reboot | Reconcile `network.vpn_dns`, then reinstall |
| Container DNS fails | Verify the configured VPN resolver from a container |
| TLS fails | Check CA chain, hostname, and clock; never use `curl -k` |
| Podman socket inactive | Check lingering, user manager, and `podman.socket` |
| Kernel network errors | Reboot after Arch kernel upgrades |
| Quadlet fails | Inspect the exact user service and journal |
| Registration exists but verify fails | Preserve it and diagnose token/network state |
| Image or service rejected | Compare the full reference with the allowlist |

The Host Agent checks Runner config metadata only. Runner version, job count,
and Drift remain unknown until a separately reviewed safe source exists.

## Provisioning

Provisioning requires an installed `create_runner` credential, one active Host,
an approved Template revision, and an allowlisted Project. Re-running the
high-level command resumes an authorized Operation after a pre-GitLab local
failure. A dispatched, running, partial, or unknown Operation is blocked for
operator review so the platform cannot create a duplicate Runner Record.

If GitLab creation succeeds but registration fails, the Operation is partial
and the paused GitLab Runner Record is preserved. Review it manually; never
delete it automatically as retry compensation.

If local install fails before GitLab creation, fix the Host and re-run the same
high-level command. The staged identity and config are idempotent. Lower-level
commands in `docs/control-plane.md` remain available for diagnosis.

## Uninstall and recovery

Uninstall is intentionally destructive on the Runner Host and requires exact
confirmation. It preserves the GitLab Runner Record. For routine replacement:

1. pause the new or failing Record in GitLab;
2. keep replacement capacity available;
3. run smoke and verify checks;
4. uninstall the local Stack only after review;
5. decide separately whether the preserved GitLab Record should remain.

Do not delete observations or audit events merely to roll back application
code.

If local files for a provisioned instance were removed by an older release
but it still appears in Web, deploy database migrations and mark the exact
Stack inactive:

```bash
pnpm db:deploy
pnpm runner:decommission -- --stack-id dotnet-REPLACE_WITH_12_HEX
```

This preserves the GitLab Runner Record and all historical evidence.
