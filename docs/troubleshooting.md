# Troubleshooting

Start with:

```bash
make status STACK=gitlab-runners/frontend
make verify STACK=gitlab-runners/frontend
```

For user service logs, use the exact command printed by `make status`.

| Symptom | Checks |
| --- | --- |
| VPN interface missing | Connect the manually managed VPN; automation will not create it. |
| Host DNS fails | Check VPN DNS, host resolver, and `systemd-resolved`. |
| Container DNS fails | Check Podman networking and set `network.vpn_dns` only when required. |
| TLS fails | Check certificate chain, hostname, clock, and public CA path; never use `curl -k`. |
| Podman socket inactive | Check lingering, `user@UID.service`, and `podman.socket` user logs. |
| Quadlet service fails | Run `systemctl --user status` and `journalctl --user` as the Runner user. |
| Registration exists but verify fails | Preserve it; check GitLab reachability, token state, and GitLab UI. |
| Job cannot pull image | Confirm the full image reference matches `allowed_images`. |
| Browser tests crash | Confirm the 1 GiB shared-memory setting and host memory pressure. |

Do not unregister or delete a Runner automatically during diagnosis.

