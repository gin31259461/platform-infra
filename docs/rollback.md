# Rollback

Keep the old Runner available until the new host passes smoke, branch, and tag
tests. If the new Runner fails:

1. Pause the new Project Runner in the GitLab UI.
2. Resume the old Runner.
3. Stop the new local stack with normal uninstall.
4. Inspect VPN, DNS, TLS, Podman socket, Quadlet status, and user journal.
5. Correct the cause, reinstall idempotently, and rerun verification.
6. Re-enable the new Runner and repeat smoke testing.

Normal uninstall preserves config and cache:

```bash
make uninstall STACK=gitlab-runners/frontend
```

Do not purge during routine rollback. Purge permanently removes the local user
and Runner data and does not remove the Project Runner from GitLab.
