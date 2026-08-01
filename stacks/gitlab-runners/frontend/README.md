# Frontend Runner

Project-scoped frontend Runner using a dedicated Arch Linux user, rootless
Podman, and GitLab Runner's Docker executor protocol.

## Configure

```bash
cp stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml
$EDITOR stacks/gitlab-runners/frontend/config.yml
```

Set the GitLab origin, VPN interface, and VPN DNS resolver when required. For a
private CA, provide only an absolute path to the public CA certificate.

The Stack config owns Host and Runner policy. Node, pnpm, browser, package, and
Project versions belong in the consuming `.gitlab-ci.yml`. Adapt
`examples/frontend.gitlab-ci.yml` there.

## Install

```bash
make check STACK=gitlab-runners/frontend
make install STACK=gitlab-runners/frontend
```

This prepares the Runner Host without creating a GitLab Runner Record. Create
a project-scoped Record with tags `frontend,podman`, disable untagged jobs,
and lock it to the Project. Then register:

```bash
read -rsp "GitLab Runner token: " RUNNER_AUTH_TOKEN
echo
printf '%s\n' "${RUNNER_AUTH_TOKEN}" | \
  make register STACK=gitlab-runners/frontend
unset RUNNER_AUTH_TOKEN
```

## Verify

```bash
make verify STACK=gitlab-runners/frontend
```

Run `tests/smoke.gitlab-ci.yml` before adopting the full consumer example.

## Uninstall from the Runner Host

```bash
make uninstall STACK=gitlab-runners/frontend
```

After exact confirmation this permanently removes the local Runner user and
all local data. The GitLab Runner Record is preserved.
