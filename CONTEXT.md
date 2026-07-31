# GitLab Runner Platform

The GitLab Runner Platform manages the lifecycle and operational health of
self-hosted, project-scoped GitLab Runners without weakening the isolation of
their hosts or CI jobs.

## Language

**Runner Record**:
The GitLab-side identity that accepts jobs for a project and reports whether
it is online, paused, or stale.
_Avoid_: Runner registration, Runner object

**Runner Manager**:
The long-running process that polls GitLab for jobs and creates their job
containers.
_Avoid_: Runner, agent

**Runner Host**:
A self-managed Linux machine that provides the runtime boundary for one or
more isolated Runner Stacks.
_Avoid_: Runner, node, server

**Runner Stack**:
A workload-specific Runner Manager and its dedicated identity, configuration,
cache, runtime, and trust boundary.
_Avoid_: Runner type, environment

**Job Container**:
An isolated, short-lived container in which one GitLab CI job or service runs.
_Avoid_: Runner container, build agent

**Control Plane**:
The product surface that presents fleet state, authorizes typed operations,
and records their outcomes.
_Avoid_: Dashboard, admin panel, frontend

**Host Agent**:
The Runner Host participant that reports observations and performs only the
typed operations authorized by the Control Plane.
_Avoid_: Shell agent, worker

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

**Fleet**:
The Runner Hosts, Runner Stacks, and Runner Records governed by one Control
Plane.
_Avoid_: Cluster, infrastructure
