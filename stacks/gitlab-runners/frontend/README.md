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

## Install and register

Bootstrap and reboot first so the running Arch kernel has matching networking
modules. Reconnect the manually managed VPN after reboot:

```sh
sudo make bootstrap
sudo reboot
```

After reboot:

```sh
cd platform-infra
sudo modprobe bridge veth br_netfilter
make check STACK=gitlab-runners/frontend
make install STACK=gitlab-runners/frontend
```

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

For Bash, use
`read -rsp "GitLab Runner token: " GITLAB_RUNNER_TOKEN` instead.

Create the Project Runner in the GitLab UI first. Configure tags `frontend`
and `podman`, disable untagged jobs, and lock the Runner to the project.

Run `tests/smoke.gitlab-ci.yml` before adopting the full consumer example in
`examples/frontend.gitlab-ci.yml`.
