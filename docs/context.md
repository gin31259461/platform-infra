# Domain Context

The GitLab Runner Platform manages the lifecycle and operational health of
self-hosted, project-scoped GitLab Runners without weakening the isolation of
their hosts or CI jobs.

## Language

**Runner Record**:
The GitLab-side identity that accepts jobs for one Runner Scope and reports
whether it is online, paused, or stale.
_Avoid_: Runner registration, Runner object

**Runner Scope**:
The GitLab resource allowed to schedule jobs on a Runner Record. The supported
values are Project, Group, and Instance; the first provisioning release
supports Project only.
_Avoid_: Global Runner, repo scope

**Runner Manager**:
The long-running process that polls GitLab for jobs and creates their job
containers.
_Avoid_: Runner, agent

**Runner Host**:
A self-managed Linux machine that provides the runtime boundary for one or
more isolated Runner Stacks.
_Avoid_: Runner, node, server

**Runner Template**:
A versioned, reusable workload policy from which Runner Stacks are created,
such as the supported frontend or .NET policy. A Template is not a deployed
Runner and contains no Runner authentication token.
_Avoid_: Runner Stack, Runner type

**Runner Stack**:
A deployed instance created from one Runner Template. It contains one Runner
Manager and its dedicated host identity, configuration, cache, runtime, and
trust boundary. Decommissioning removes its local runtime and excludes it from
the active fleet, while its durable identity and historical evidence remain.
_Avoid_: Runner Template, environment

**Job Container**:
An isolated, short-lived container in which one GitLab CI job or service runs.
_Avoid_: Runner container, build agent

**Control Plane**:
The product surface that presents fleet state, authorizes typed operations,
and records their outcomes.
_Avoid_: Dashboard, admin panel, frontend

**Host Agent**:
The unprivileged Runner Host participant that reports bounded, structured
observations. It cannot receive Operations or provision Runner Stacks.
_Avoid_: Shell agent, Host Provisioner

**Host Provisioner**:
The privileged Runner Host participant that applies an authorized
Provisioning Operation through fixed local automation. It cannot execute
caller-supplied commands or filesystem paths.
_Avoid_: Host Agent, shell agent, generic worker

**Desired State**:
The approved configuration and lifecycle intent for a Runner Stack.
_Avoid_: Config, target status

**Observed State**:
The latest facts reported independently by GitLab and the Runner Host.
_Avoid_: Current config, live status

**Drift**:
A material difference between Desired State and Observed State.
_Avoid_: Error, outage

**Operation**:
A typed, authorized request to inspect or change one explicit Runner Stack or
Runner Record, together with its progress and outcome.
_Avoid_: Command, script, task

**Provisioning Operation**:
An Operation that creates one Project Runner Record and one matching Runner
Stack from an approved Runner Template. It records every stage and preserves
partial failure for explicit retry or cleanup.
_Avoid_: Create command, install job

**Fleet**:
The Runner Hosts, Runner Stacks, and Runner Records governed by one Control
Plane.
_Avoid_: Cluster, infrastructure
