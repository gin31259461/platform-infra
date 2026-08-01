# Adding a Runner Stack

Runner Templates live at `stacks/gitlab-runners/<workload>` and reuse
`playbooks/gitlab-runner.yml`. Do not copy shared user, systemd, Podman,
network, TLS, registration, or validation logic into a Stack.

## Required files

```text
stacks/gitlab-runners/<workload>/
  README.md
  config.example.yml
  examples/                  # when a consumer example is useful
  tests/smoke.gitlab-ci.yml  # minimal tag and runtime validation
```

Canonical names match
`^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$`. Operator commands accept canonical
names and platform instance IDs, never filesystem paths.

## Policy

- Choose unique users, service/container names, credentials, tags, config,
  cache, and rootless storage.
- Keep `concurrent: 1` and `privileged: false`.
- Keep manager host networking and per-build job networking enabled.
- Limit job volumes to `/cache`.
- Use full registry-qualified, pinned manager and default job images.
- Keep job and service allowlists repository-scoped.
- Use the approved pinned `network.validation_image` only for diagnostics.
- Put build versions, packages, Project paths, and package sources in consumer
  `.gitlab-ci.yml`, not Runner config.

Deployment-capable Runners require a separate trust boundary and security
review.

## Validate

Add a minimal smoke pipeline for the new tags. Ensure shared role changes and
path-based CI rules include the Stack, then run:

```bash
make validate STACK=gitlab-runners/REPLACE_WITH_WORKLOAD
make validate-all
make lint
git diff --check
```
