# Documentation

The root [README](../README.md) is the short project entry point. Use these
guides for implementation and operations details.

## Operate

- [Getting started](getting-started.md): Host bootstrap, local install,
  registration, verification, provisioning, and uninstall.
- [Control Plane](control-plane.md): PostgreSQL, credentials, Agent ingestion,
  GitLab synchronization, and server lifecycle.
- [Troubleshooting](troubleshooting.md): common Host, Agent, GitLab, and Web
  failures.

## Understand

- [Architecture](architecture.md): component boundaries and data flow.
- [Security](security.md): trust model, secret handling, and prohibited paths.
- [Product specification](../SPEC.md): current and target behavior.
- [Domain context](../CONTEXT.md): canonical terminology.

## Contribute

- [Development workflow](development-workflow.md): setup, tests, review, and
  delivery expectations.
- [Adding a Runner Stack](adding-a-runner-stack.md): required layout and
  security policy.
- [Frontend Runner](../stacks/gitlab-runners/frontend/README.md)
- [.NET Runner](../stacks/gitlab-runners/dotnet/README.md)

Executable code and tests define current behavior. The specification may
describe capabilities that are not implemented yet.
