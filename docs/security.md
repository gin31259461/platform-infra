# Security

## Required controls

- Use only a project-scoped Runner created manually in GitLab.
- Lock the Runner to that project and disable untagged jobs.
- Use a dedicated Linux user and rootless Podman.
- Keep privileged mode disabled and concurrency at one.
- Mount the Podman socket only into the Runner manager.
- Keep job volumes limited to `/cache`.
- Use registry-qualified, pinned manager and job images.
- Keep a narrow registry and repository image allowlist.
- Validate VPN, DNS, and TLS from both host and container.
- Install a public CA certificate when needed; never disable TLS verification.
- Keep `config.yml`, `config.toml`, tokens, VPN credentials, and private keys
  out of Git.
- Use a new Project Runner identity during migration.
- Keep deployment credentials and Runners separate from build Runners.

Registration streams the token from `GITLAB_RUNNER_TOKEN` over standard input
to a short-lived manager shell, which exports the Runner CLI's expected
variable. The value is not placed in Podman command arguments. Scripts do not
enable shell tracing, print the token, write it to a temporary file, or delete
a failed registration.

Normal uninstall preserves the token-bearing config with mode `0600`. Purge
requires explicit confirmation. Removing the corresponding Runner from GitLab
remains a manual UI operation.
