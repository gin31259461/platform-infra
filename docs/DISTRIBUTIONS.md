# Distribution support

## Common requirements

Every managed host must provide systemd, cgroup v2, Python, SSH for remote
management, rootless Podman 4.2 or newer, and aardvark-dns newer than 1.10.0.
The playbook fails closed when these runtime requirements are not met.

Package availability is a distribution responsibility. A nominally supported
family can still require an official backport or vendor repository when its
base release ships an older Podman or aardvark-dns.

## Arch Linux

Packages are installed with `community.general.pacman`.

Arch does not support partial upgrades. The role does not refresh package
metadata unless `runner_update_operating_system` is explicitly set to `true`.
When enabled, metadata refresh and full system upgrade happen together.

CA trust:

```text
/etc/ca-certificates/trust-source/anchors
trust extract-compat
```

## Debian and Ubuntu

Packages are installed with `ansible.builtin.apt`. Package metadata uses a
configurable cache-valid interval. `uidmap` supplies subordinate-ID utilities.

CA trust:

```text
/usr/local/share/ca-certificates
update-ca-certificates
```

Use a release or official backport that satisfies the enforced Podman and
aardvark-dns versions. Debian 13 and newer are the intended baseline.

## Fedora, RHEL, Rocky Linux, and AlmaLinux

Packages are installed with `ansible.builtin.dnf`.

CA trust:

```text
/etc/pki/ca-trust/source/anchors
update-ca-trust extract
```

Use a vendor-supported repository that provides the enforced Podman and
network stack versions. Modern Fedora no longer requires a separate
`podman-plugins` package for the Netavark-based configuration used here.

## Unsupported platforms

Alpine, Void, OpenRC-only systems, and other non-systemd platforms are rejected.
Supporting them would require a separate service-lifecycle implementation and
new integration tests. Adding package aliases alone would be misleading.
