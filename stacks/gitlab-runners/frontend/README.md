# Frontend GitLab Runner

This stack installs one project-scoped frontend Runner on Arch Linux. The
manager runs as `gitlab-runner-frontend` in rootless Podman and uses the
rootless Podman socket through GitLab Runner's Docker executor protocol.

## Configure

```bash
cp stacks/gitlab-runners/frontend/config.example.yml \
  stacks/gitlab-runners/frontend/config.yml
$EDITOR stacks/gitlab-runners/frontend/config.yml
```

Replace the GitLab hostname and VPN interface. If GitLab uses a private CA,
set `tls.private_ca_enabled: true` and provide an absolute path to the public
CA certificate. Never place a private key in this repository.

The Runner configuration owns only the host and registration policy.
`runner.default_job_image` is the fallback for jobs without an `image`,
`runner.allowed_images` limits project-selected images, and
`network.validation_image` is used only for Runner network diagnostics.

Package names, Node and Playwright versions, and pnpm versions belong in the
consuming project's `.gitlab-ci.yml`. Adapt
`examples/frontend.gitlab-ci.yml` there instead of adding those values to the
Runner's `config.yml`.

If the VPN changes DNS during startup, set `network.vpn_dns` to its resolver
IP. Use `100.100.100.100` for this host's Tailscale DNS. `make install`
applies the resolver to the Runner manager and reconciles existing CI job
configuration without changing the Runner token.

For an older local configuration, move `frontend.curl_image` to
`network.validation_image` and remove the remaining `frontend` section. The
legacy curl location is accepted temporarily to support migration.

## Install and register

Bootstrap and reboot first so the running Arch kernel has matching networking
modules. Reconnect the manually managed VPN after reboot:

```sh
sudo make bootstrap
sudo reboot
```

After reboot:

```sh
cd gitlab-runner-platform

make check STACK=gitlab-runners/frontend
make install STACK=gitlab-runners/frontend
```

The preflight check detects a stale running kernel before installation.
The rootless Podman role creates
`/etc/modules-load.d/platform-infra-podman.conf` and loads `bridge`, `veth`,
and `br_netfilter` automatically.

Create the Project Runner in GitLab, then use this zsh-compatible token input:

```zsh
read -rs "GITLAB_RUNNER_TOKEN?GitLab Runner token: "
echo
export GITLAB_RUNNER_TOKEN
make register STACK=gitlab-runners/frontend
unset GITLAB_RUNNER_TOKEN
```

Verify the installation:

```sh
make verify STACK=gitlab-runners/frontend
```

Run `make install` again whenever `network.vpn_dns` changes.

For Bash, use
`read -rsp "GitLab Runner token: " GITLAB_RUNNER_TOKEN` instead.

Create the Project Runner in the GitLab UI first. Configure tags `frontend`
and `podman`, disable untagged jobs, and lock the Runner to the project.

Run `tests/smoke.gitlab-ci.yml` before adopting the full consumer example in
`examples/frontend.gitlab-ci.yml`.
