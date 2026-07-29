# Migration

1. Prepare the new Arch Linux host and connect its VPN manually.
2. Confirm GitLab DNS and HTTPS connectivity.
3. Clone this repository and create the local stack `config.yml`.
4. Run bootstrap.
5. Reboot so the running kernel matches the installed Arch kernel modules.
6. Reconnect the manually managed VPN.
7. Run check and install. Preflight verifies the modules, and installation
   persists and loads them automatically.
8. Create a new Project Runner in the GitLab UI.
9. Register with the new authentication token and immediately unset it.
10. Run local verification.
11. Run the smoke pipeline.
12. Run a normal frontend branch pipeline.
13. Test a semantic-version tag and confirm package, checksum, and Release.
14. Pause the old Runner and observe the new one.
15. Remove the old Runner only after the observation period succeeds.

Never copy the old `config.toml` or reuse its Runner token. Do not operate two
hosts with the same Runner identity.
