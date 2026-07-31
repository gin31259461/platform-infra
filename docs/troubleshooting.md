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
| Runner is online before reboot but jobs stay pending afterward | Set `network.vpn_dns` to the VPN resolver IP, then run `make install` and `make verify`. |
| Container DNS fails | Check Podman networking and confirm `network.vpn_dns` matches the active VPN resolver. |
| TLS fails | Check certificate chain, hostname, clock, and public CA path; never use `curl -k`. |
| Podman socket inactive | Check lingering, `user@UID.service`, and `podman.socket` user logs. |
| Netavark reports `Operation not supported` | Reboot after an Arch kernel upgrade; check verifies `bridge`, `veth`, and `br_netfilter`. |
| Quadlet service fails | Run `systemctl --user status` and `journalctl --user` as the Runner user. |
| Registration exists but verify fails | Preserve it; check GitLab reachability, token state, and GitLab UI. |
| Job cannot pull image | Confirm the full image reference matches `allowed_images`. |
| SQL Server service is rejected | Match the official SQL Server repository and `allowed_services`. |
| SQL Server never becomes ready | Check its pinned tag, EULA setting, and masked `MSSQL_SA_PASSWORD_UI`. |
| NuGet restore fails | Check source names and HTTPS URLs, then the matching masked credentials. |
| Browser tests crash | Confirm the 1 GiB shared-memory setting and host memory pressure. |

Do not unregister or delete a Runner automatically during diagnosis.

As a temporary recovery after the VPN is connected:

```bash
runner_uid="$(id -u gitlab-runner-frontend)"
sudo -u gitlab-runner-frontend \
  XDG_RUNTIME_DIR="/run/user/${runner_uid}" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${runner_uid}/bus" \
  systemctl --user restart gitlab-runner-frontend.service
```

The persistent fix is `network.vpn_dns`; the restart should not be necessary
after reinstalling the updated stack.
