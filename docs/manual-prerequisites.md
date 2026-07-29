# Manual prerequisites

Before running automation:

1. Install Arch Linux with cgroup v2.
2. Reboot after bootstrap or any kernel upgrade so `uname -r` has a matching
   `/usr/lib/modules/<kernel>` tree.
3. Ensure the `bridge`, `veth`, and `br_netfilter` modules can be loaded.
4. Install, configure, and connect the organization's VPN manually.
5. Confirm the VPN interface exists and the GitLab hostname resolves.
6. Confirm `https://<gitlab-hostname>/-/health` is reachable without `curl -k`.
7. If required, obtain only the public private-CA certificate.
8. In the GitLab project, create a new Project Runner.
9. Set tags `frontend` and `podman`, disable untagged jobs, and lock it to the
   project. Set protected status according to the release policy.
10. Keep the `glrt-...` authentication token outside files and shell history.

The repository does not install or configure the VPN and does not create,
delete, pause, or modify GitLab Runner resources through the API.

For a private CA, place the certificate outside Git, set
`tls.private_ca_enabled: true`, and set `tls.private_ca_source` to its absolute
path. Private keys are rejected.
