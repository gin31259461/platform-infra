# Adding a Runner stack

Create stacks by infrastructure function and workload. Runner stacks live at
`stacks/gitlab-runners/<workload>` and reuse
`playbooks/gitlab-runner.yml`. Do not copy the user, systemd, Podman, network,
TLS, manager, registration, or validation implementation.

Every stack requires `README.md` and `config.example.yml`; add examples and
smoke tests only when the workload needs them. The canonical stack name must
match `^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$`. Operation scripts resolve
canonical names and never accept caller-supplied filesystem paths.

Choose a unique Linux user, service, container name, Project Runner token, tag
set, config directory, and cache boundary. Pin the manager and default job
images with full registry-qualified references. Define a narrow image
allowlist. When jobs use service containers, also define a narrow
`allowed_services` repository allowlist. Keep `concurrent: 1` and
`privileged: false` until capacity and security reviews approve a change.

Set the shared, pinned `network.validation_image` to the approved
`docker.io/curlimages/curl` version. Do not place workload build images,
package names, tool versions, project paths, or package sources in stack
configuration; those belong to each consuming project's `.gitlab-ci.yml`.

Add a minimal smoke pipeline using the new tags. Verify it before a full
consumer pipeline. Standard `config.example.yml` discovery adds the stack to
`tests/validate-all.sh`; also add path-based CI rules and make shared Runner
role changes trigger its validation.

Deployment-capable Runners require a different trust boundary: a dedicated
user, socket, token, protected tags/ref policy, credentials, cache, config, and
image allowlist.
