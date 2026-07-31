# GitLab Runner Platform Specification

Status: Draft 0.1
Product name: `gitlab-runner-platform`
Audience: maintainers, operators, security reviewers, and contributors

Implementation status: the Next.js read-only vertical slice uses versioned
contracts, domain health/RBAC rules, a tRPC API, and a PostgreSQL-backed Host
Agent observation ingestion path. A database bootstrap CLI enrolls one known
Host and Stack, and a separate CLI issues a scoped credential for an existing
Host and Stack, without exposing the credential secret. The packaged read-only
Python Host Agent performs fixed checks and reliably retries a bounded
observation from a local outbox. Fake observations remain the local default.
An explicit staging bootstrap command generates and installs a scoped Agent
credential without returning its secret.
The repository does not yet provide production user authentication, Ansible
Agent rollout, scheduled GitLab synchronization, credential
rotation/revocation workflows, or Operations. An explicit staging CLI now
implements the read-only GitLab Runner connector with a dedicated `read_api`
credential.

## 1. Purpose

GitLab Runner Platform gives operators one safe place to install, observe,
diagnose, and operate self-hosted GitLab Runners. It evolves the repository's
existing Arch Linux, Ansible, rootless Podman, and systemd automation into the
host-runtime layer of a focused Runner management product.

This specification describes the target product. The current implementation
includes host automation, a read-only Web/API slice, PostgreSQL observation
persistence, a packaged read-only Host Agent, and an explicit read-only GitLab
sync CLI. It does not yet include production user authentication, automated
Agent deployment through Ansible, scheduled connector deployment, or remote
Operations.

The canonical domain language is defined in [CONTEXT.md](CONTEXT.md).

## 2. Problem

Operating self-hosted GitLab Runners currently requires moving between GitLab,
host terminals, systemd logs, Podman state, and repository scripts. Operators
cannot quickly answer:

- Which Runner Records, Runner Managers, and Runner Hosts are healthy?
- Is a failure in GitLab, the VPN path, DNS, TLS, systemd, Podman, or a job?
- Has a Runner Stack drifted from its approved configuration?
- Who performed an operation, what was authorized, and what happened?

Directly exposing host shells or container sockets to a web application would
solve the usability problem by creating a larger security problem. The
platform therefore needs a narrow, auditable control path.

## 3. Product principles

1. **Runner-focused boundary**: include only capabilities needed to manage the
   lifecycle and health of GitLab Runners.
2. **Read before write**: deliver reliable inventory, health, and diagnosis
   before remote mutation.
3. **Typed operations only**: the Control Plane never offers arbitrary shell,
   Ansible arguments, filesystem paths, or Podman API access.
4. **Least privilege**: browser, Control Plane, GitLab connector, Host Agent,
   Runner Manager, and job containers have separate credentials and scopes.
5. **Evidence over a single status light**: GitLab state, host state, and
   Desired State remain distinguishable.
6. **Safe failure**: a disconnected Control Plane must not stop a healthy
   Runner Manager from processing jobs.
7. **Auditability**: every remote operation has an actor, target, reason,
   authorization decision, timestamps, and redacted outcome.

## 4. Scope

### 4.1 Goals

- Inventory Runner Hosts, Runner Stacks, and their matching Runner Records.
- Monitor GitLab availability and host runtime health from one interface.
- Explain health using structured checks for VPN, DNS, TLS, systemd, Podman,
  Runner configuration, and GitLab connectivity.
- Detect Drift without retrieving or displaying Runner authentication tokens.
- Execute a small allowlist of reversible, typed operations.
- Provision and reconcile supported Runner Stacks through the existing
  idempotent automation after the observation and operation paths are proven.
- Enforce role-based access and retain a searchable audit history.

### 4.2 Non-goals

- General-purpose Linux, VM, Kubernetes, VPN, DNS, or container management.
- A CI pipeline editor or replacement for the GitLab job interface.
- Arbitrary remote command execution, interactive terminals, or file browsing.
- Storing VPN credentials, project secrets, job variables, or private keys.
- Mounting a Podman socket into the Control Plane, Host Agent, or CI jobs.
- Automatically deleting Runner Records or purging Runner Host data.
- Supporting non-GitLab CI systems in the first product generation.
- Replacing GitLab as the authority for projects, pipelines, jobs, and Runner
  Records.

## 5. Users and permissions

| Role | Capabilities |
| --- | --- |
| Viewer | View inventory, health, Drift, operation history, and redacted logs. |
| Operator | Viewer capabilities plus approved reversible operations. |
| Administrator | Operator capabilities plus enrollment, Desired State, access policy, and integrations. |
| Auditor | Read immutable audit data without operational controls. |

Authentication must use the organization's identity provider before the first
production deployment. Authorization is evaluated by the API for every
request; hiding controls in the web interface is not authorization.

## 6. System boundary

```text
Operator browser
      |
      | authenticated HTTPS
      v
Web UI + Control Plane API -----> GitLab API
      |                              |
      |                              `-- Runner Records, jobs, pause/resume
      |
      | Desired State, observations, operations, audit
      v
Database + operation queue
      ^
      | outbound authenticated polling/reporting
      |
Host Agent on each Runner Host
      |
      | typed local adapters
      v
Existing scripts / Ansible / systemd user services / rootless Podman
      |
      `-- Runner Manager -----> GitLab over the manually managed VPN
              |
              `-- isolated per-build Job Containers
```

The browser communicates only with the Control Plane API. A Host Agent makes
an authenticated outbound connection so the platform does not require a new
general-purpose inbound host-management port. The Host Agent maps an approved
Operation type to fixed local behavior and validates the canonical stack name
again at the host boundary.

GitLab Runner authentication tokens remain on their Runner Hosts. GitLab API
credentials belong to the Control Plane's secret store and must use the
smallest scopes supported by the chosen GitLab deployment.

## 7. Functional requirements

Requirement IDs are stable references for issues, tests, and release notes.

### 7.1 Inventory and enrollment

- **INV-001**: An Administrator can enroll a Runner Host using a one-time,
  expiring credential without placing a long-lived secret in command history.
- **INV-002**: A Runner Host has a stable platform identity independent of its
  hostname and IP address.
- **INV-003**: Each Runner Stack is identified by a canonical name matching
  `^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$`.
- **INV-004**: The platform correlates a Runner Stack with its Runner Record
  using explicit identifiers, never names or tags alone.
- **INV-005**: Missing, duplicated, and unmatched identities are shown as
  separate states rather than silently merged.

### 7.2 Observation and health

- **OBS-001**: The Host Agent reports versioned, structured observations; it
  does not upload token-bearing configuration or unrestricted command output.
- **OBS-002**: The platform shows GitLab status and host status separately,
  including the source and timestamp of each observation.
- **OBS-003**: Structured checks cover VPN interface presence, DNS, HTTPS/TLS,
  systemd user manager, Podman socket, Runner Manager service, Runner config,
  image policy, and recent contact with GitLab.
- **OBS-004**: Health has at least `healthy`, `degraded`, `unhealthy`,
  `unknown`, and `maintenance` states with a machine-readable reason.
- **OBS-005**: Stale data becomes `unknown`; the UI never presents stale data
  as a current healthy state.
- **OBS-006**: Diagnostic output is bounded, redacted, and safe to retain.

### 7.3 Desired State and Drift

- **CFG-001**: Desired State is versioned and records its author, review state,
  creation time, and source revision.
- **CFG-002**: Drift comparison uses normalized structured values and secret
  fingerprints, not raw secret values or rendered token-bearing files.
- **CFG-003**: The UI explains each material difference and whether it can be
  reconciled automatically.
- **CFG-004**: A Desired State change does not mutate a Runner Host until a
  separately authorized reconcile Operation is created.

### 7.4 Operations

- **OPS-001**: Every Operation has an explicit type, target, actor, reason,
  creation time, authorization result, lifecycle state, and redacted outcome.
- **OPS-002**: Operation states are `requested`, `authorized`, `dispatched`,
  `running`, `succeeded`, `failed`, `cancelled`, or `expired`.
- **OPS-003**: The initial remote operation allowlist is limited to refresh
  observations, run verification, restart a Runner Manager, and pause or
  resume a Runner Record.
- **OPS-004**: Restart requires confirmation that names the affected Runner
  Stack; pause and resume require confirmation that names the Runner Record.
- **OPS-005**: Install, upgrade, register, reconcile, uninstall, and purge are
  excluded from the MVP operation allowlist.
- **OPS-006**: Operation parameters are schema-validated by both the API and
  Host Agent. User-provided filesystem paths and command fragments are
  rejected.
- **OPS-007**: Retrying an Operation must be explicit and must create a linked
  audit event. Operations use idempotency keys where the underlying action can
  safely support them.
- **OPS-008**: A timeout or lost connection produces an `unknown outcome`
  diagnostic until observation confirms the resulting state; it is never
  reported as success by assumption.

### 7.5 GitLab integration

- **GLB-001**: The connector reads Runner Record, project, job, and contact
  information needed by the platform without reading unrelated project data.
- **GLB-002**: Read access and pause/resume access can use separate credentials
  or scopes.
- **GLB-003**: Rate limiting, authorization failure, and GitLab unavailability
  are visible without changing the last known host observation.
- **GLB-004**: The platform never automatically unregisters or deletes a
  Runner Record.

### 7.6 Web interface

- **UI-001**: The fleet view can filter by health, workload, host, project,
  tag, Drift, and observation age.
- **UI-002**: A Runner Stack detail view shows Desired State, GitLab state,
  host checks, recent Operations, and safe diagnostic guidance.
- **UI-003**: Operation progress updates without requiring a page reload and
  remains recoverable after reconnecting the browser.
- **UI-004**: Destructive or unavailable capabilities are not represented as
  ordinary active controls.
- **UI-005**: The primary monitoring and operation flows are keyboard usable
  and meet WCAG 2.2 AA contrast and semantics.

### 7.7 Audit

- **AUD-001**: Authentication, authorization changes, enrollment, Desired
  State changes, and every Operation transition create audit events.
- **AUD-002**: Audit events are append-only to application roles and include a
  correlation ID spanning API, queue, Host Agent, and GitLab connector work.
- **AUD-003**: Audit exports are structured and redact tokens, credentials,
  environment variables, and token-bearing configuration.
- **AUD-004**: Retention is configurable; the production default must be
  approved before launch.

## 8. Data model

The logical model contains:

- **User** and **RoleAssignment** for identity and authorization.
- **RunnerHost** for enrolled host identity and latest agent capabilities.
- **RunnerStack** for the canonical workload boundary on a Runner Host.
- **RunnerRecordRef** for the explicit GitLab-side identity and project scope.
- **DesiredStateRevision** for approved, versioned intent.
- **Observation** for immutable, source-labelled health facts.
- **DriftFinding** for an explained difference tied to a Desired State revision
  and an Observation.
- **Operation** and **OperationEvent** for authorized work and state changes.
- **AuditEvent** for the security record independent of operational logs.

Historical Observations may be compacted according to retention policy, but
AuditEvents and OperationEvents must retain referential integrity.

## 9. Security requirements

- Preserve every invariant in [docs/security.md](docs/security.md), including
  rootless Podman, dedicated Runner users, unprivileged jobs, per-build
  networks, narrow image allowlists, and no runtime socket in jobs.
- The Control Plane and Host Agent must never receive or return the installed
  Runner authentication token.
- Host Agent credentials are unique per Runner Stack and its Runner Host,
  rotatable, revocable, and unusable as operator credentials.
- Enrollment credentials are single-use and expire within a documented short
  interval.
- Secrets are redacted before persistence and before logs cross a process
  boundary.
- All cross-host network connections are authenticated and encrypted.
  Disabling TLS verification is not a recovery mechanism. An explicit staging
  mode may use plaintext HTTP only over a literal loopback address when the
  Agent and Control Plane run on the same Host.
- Operations are deny-by-default. An unsupported operation type or parameter
  fails closed at every boundary.
- Dependency, secret, static-analysis, authorization, and migration checks are
  release gates for affected components.
- Production operation access requires multi-factor authentication through the
  selected identity provider.

Before any mutating remote Operation is enabled, its threat model must cover
credential theft, replay, confused deputy behavior, stale authorization,
duplicate delivery, partial failure, compromised hosts, and log exfiltration.

## 10. Reliability and performance

- A healthy Host Agent observation should appear in the UI within 60 seconds.
- Acknowledgement of a requested Operation should appear within 5 seconds when
  the Control Plane is healthy; this does not imply the Operation succeeded.
- An unavailable Control Plane must not interrupt existing Runner Managers or
  Job Containers.
- Queue delivery may be at-least-once; Operation handlers must account for
  duplicates and expose uncertain outcomes.
- Database backup and restore procedures must be tested before production.
- The first production target is 50 Runner Hosts and 200 Runner Stacks without
  changing the logical model. Larger scale requires measured capacity tests.

## 11. MVP acceptance criteria

The read-only MVP is complete when:

1. An Administrator can enroll and revoke a test Runner Host.
2. The Host Agent reports structured health for an existing frontend or .NET
   Runner Stack without returning secrets.
3. The Control Plane correlates that stack with its explicit GitLab Runner
   Record and shows GitLab and host timestamps independently.
4. The fleet and stack pages display healthy, degraded, unhealthy, unknown,
   and stale-data scenarios correctly.
5. A Viewer cannot invoke Operations or change enrollment and policy.
6. Every authentication, enrollment, and authorization event is auditable.
7. Contract tests prove that unknown fields, unsupported operations, arbitrary
   paths, and token-shaped values are rejected or redacted as appropriate.
8. Disconnecting the Control Plane has no effect on a running Runner Manager
   or Job Container.

Remote operations are a subsequent milestone and are not required for the
read-only MVP.

## 12. Delivery milestones

### Milestone 0: product foundation

- Adopt this specification and domain language.
- Choose deployment topology, identity provider, persistence, and application
  technology through focused architecture decisions.
- Define versioned API and observation contracts plus a threat model.
- Keep existing host automation behavior unchanged.

### Milestone 1: read-only MVP

- Enrollment and credential rotation.
- Host Agent structured observations.
- GitLab read-only connector.
- Fleet and Runner Stack views.
- Health reasoning, stale-data handling, Drift preview, and audit trail.

### Milestone 2: reversible operations

- Operation queue and progress model.
- Refresh, verify, restart, pause, and resume operations.
- Role enforcement, confirmations, idempotency, timeout handling, and complete
  audit correlation.

### Milestone 3: controlled reconciliation

- Reviewed Desired State revisions.
- Install, upgrade, and reconcile through typed plans and approvals.
- Canary rollout, failure budgets, rollback guidance, and maintenance windows.

Registration, uninstall, purge, and Runner Record deletion require separate
specification and security review; they are not implied by Milestone 3.

## 13. Open decisions before implementation

The selected Web implementation uses Next.js with TypeScript, MUI, tRPC, and
pnpm. The following remain intentionally unselected by this product
specification:

- Database and durable queue implementation.
- Organization identity provider and role mapping.
- Single-site versus centrally hosted deployment topology.
- Host Agent packaging, update, and credential-bootstrap mechanism.
- Supported GitLab edition/version range. The current connector reads exact
  Runner IDs through GraphQL with a dedicated `read_api` credential.
- Audit and observation retention periods.

Each choice should be made with a small architecture decision record when it
is hard to reverse and involves a genuine trade-off. None may weaken the
product principles or security requirements above.
