# Adding a Runner stack

Create `stacks/gitlab-runners/<workload>` and reuse
`playbooks/gitlab-runner.yml`. Do not copy the user, systemd, Podman, network,
TLS, manager, registration, or validation implementation.

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
consumer pipeline. Add path-based CI rules for the stack and make all changes
to shared Runner roles trigger validation of this new stack.

Deployment-capable Runners require a different trust boundary: a dedicated
user, socket, token, protected tags/ref policy, credentials, cache, config, and
image allowlist.
