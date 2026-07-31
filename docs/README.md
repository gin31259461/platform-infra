# Documentation

This index separates product intent, implementation design, operations, and
contributor guidance. The root [README](../README.md) is the concise project
entry point.

## Start here

- [Getting started](getting-started.md): install, register, verify, and develop
  locally.
- [Manual prerequisites](manual-prerequisites.md): host, VPN, DNS, and GitLab
  checks before automation.
- [Troubleshooting](troubleshooting.md): observation, connector, networking,
  Podman, and Runner failures.

## Product and domain

- [Product specification](../SPEC.md): target behavior, requirements, and
  delivery stages.
- [Domain context](../CONTEXT.md): canonical terms and boundaries.
- [Development workflow](development-workflow.md): requirement-to-delivery
  lifecycle and review gates.

## Architecture and security

- [Architecture](architecture.md): Control Plane data flow and Runner host
  runtime.
- [Security](security.md): trust boundaries, secrets, credentials, and
  prohibited designs.
- [Control Plane operations](control-plane.md): PostgreSQL, Agent bootstrap,
  ingestion, GitLab synchronization, and rollback.

## Runner operations

- [Frontend Runner](../stacks/gitlab-runners/frontend/README.md)
- [.NET Runner](../stacks/gitlab-runners/dotnet/README.md)
- [Migration](migration.md)
- [Rollback](rollback.md)
- [Troubleshooting](troubleshooting.md)

## Extending the repository

- [Adding a Runner stack](adding-a-runner-stack.md)
- [Development workflow](development-workflow.md)

Executable code and tests define current behavior. The product specification
describes the target and does not imply that every capability is implemented.
