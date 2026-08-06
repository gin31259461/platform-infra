# Architecture

## Responsibilities

```text
src/platform_infra/domain
  Immutable configuration and process models
  Security and isolation vocabulary

src/platform_infra/application
  Stack discovery and cross-stack validation
  Ansible command composition
  Runner registration use case
  Protocols for external dependencies

src/platform_infra/adapters
  Local filesystem reads
  YAML conversion at the input boundary
  Subprocess execution
  Environment or hidden-prompt token input

src/platform_infra/cli.py
  Dependency composition root
  CLI input conversion
  Logging and exit-code boundary

playbooks and roles
  Managed-host desired state
  Distribution package differences
  systemd user lifecycle
  rootless Podman socket and networking
  Runner manager, registration, verification, and removal
```

The domain and application layers do not import Ansible, subprocess, operating
system APIs, or YAML libraries. Infrastructure adapters implement the narrow
ports required by application use cases.

## Deployment planes

```text
Control plane
  GitLab coordinator <-> Runner manager

Execution plane
  Runner manager -> Docker-compatible Podman API -> job containers

Image plane
  Podman -> GitLab Container Registry or another allowed registry

Provisioning plane
  Python CLI -> ansible-playbook -> managed Runner host
```

## Secret flow

```text
GITLAB_RUNNER_TOKEN
  -> Python TokenReader
  -> Ansible process environment
  -> Ansible env lookup under no_log
  -> remote process environment
  -> gitlab-runner register
  -> managed host config.toml
```

The token does not enter the Python command arguments, JSON extra-vars,
inventory, stack YAML, or repository files. Expected command failures render
only non-secret arguments.

## Configuration ownership

Ansible owns all non-secret `config.toml` fields, including resources,
allowlists, Podman socket, network flags, and default images. GitLab Runner
owns registration metadata such as token, ID, acquisition time, expiration
time, and `.runner_system_id`.

The manager role reads registration metadata with `no_log`, renders a complete
managed configuration, and preserves the registration fields. This gives
repeatable convergence after registration instead of treating registration as
the permanent source of non-secret settings.

## Why systemd user services instead of Quadlet

The Runner manager is expressed as a standard systemd user unit that invokes
Podman. This keeps the required service abstraction available across the
supported distribution families, including platforms where the shipped
Podman version does not provide a consistent Quadlet feature set.

Podman remains rootless. The unit requires `podman.socket`, uses the account's
runtime directory and D-Bus session, and mounts the socket only into the Runner
manager container.
