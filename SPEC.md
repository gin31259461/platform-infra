# GitLab Runner Platform Specification

Status: Draft 0.2
Product name: `gitlab-runner-platform`
Audience: maintainers, operators, security reviewers, and contributors

Implementation status: the Next.js read-only Control Plane uses versioned
contracts, domain health rules, tRPC, PostgreSQL observations, and a read-only
GitLab connector. The packaged Python Host Agent posts bounded observations
and retries them from a local outbox. The start supervisor refreshes GitLab
state and requests fresh Host observations before serving Web. Runtime views
use only persisted observations; missing data remains explicitly absent.

Host automation installs the Runner Manager, while the scoped bootstrap flow
installs its Host Agent. A separate CLI composes both paths to create an
initially paused, project-scoped Runner Record and observable Runner Stack in
one operation. Browser monitoring requires no application login;
GitLab credentials are installed once on B and never sent to the browser.
Remote write Operations and browser provisioning remain unimplemented.

## 1. Purpose

GitLab Runner Platform gives operators one safe place to install, observe,
diagnose, and operate self-hosted GitLab Runners. It evolves the repository's
existing Arch Linux, Ansible, rootless Podman, and systemd automation into the
host-runtime layer of a focused Runner management product.

This specification describes the target product. The current implementation
includes host automation, a read-only Web/API slice, PostgreSQL observation
persistence, a packaged read-only Host Agent, an explicit read-only GitLab sync
CLI, a start-supervised GitLab watcher, and an owner-only GitLab credential
store. It does not yet include automated Agent deployment through Ansible,
installed connector services, external secret-manager integration, or remote
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
4. **Least privilege**: browser, Control Plane, GitLab connectors, Host Agent,
   Host Provisioner, Runner Manager, and job containers have separate
   credentials and scopes.
5. **Evidence over a single status light**: GitLab state, host state, and
   Desired State remain distinguishable.
6. **Safe failure**: a disconnected Control Plane must not stop a healthy
   Runner Manager from processing jobs.
7. **Auditability**: every remote operation has an actor, target, reason,
   authorization decision, timestamps, and redacted outcome.
8. **Template-driven provisioning**: users choose approved intent; they never
   supply host paths, shell fragments, Ansible arguments, or raw Runner
   configuration.

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
- Create a project-scoped Runner Record and its matching Runner Stack through
  one traceable Provisioning Operation.
- Protect every write capability independently from read-only browser access
  and retain a searchable audit history.

### 4.2 Non-goals

- General-purpose Linux, VM, Kubernetes, VPN, DNS, or container management.
- A CI pipeline editor or replacement for the GitLab job interface.
- Arbitrary remote command execution, interactive terminals, or file browsing.
- Storing VPN credentials, project secrets, job variables, or private keys.
- Mounting a Podman socket into the Control Plane, Host Agent, or CI jobs.
- Automatically deleting Runner Records or remotely purging Runner Host data.
- Supporting non-GitLab CI systems in the first product generation.
- Replacing GitLab as the authority for projects, pipelines, jobs, and Runner
  Records.
- Provisioning Group or Instance Runners in the first write-capable release.

## 5. Users and permissions

| Role | Capabilities |
| --- | --- |
| Viewer | Any client admitted by the deployment network can view inventory, health, Drift, operation history, and redacted logs. |
| Operator | A separately authorized platform principal can request approved reversible and Project Runner provisioning operations. |
| Administrator | A separately authorized platform principal can manage enrollment, Desired State, access policy, and integrations. |
| Auditor | A separately authorized platform principal can read immutable audit data without operational controls. |

Read-only browser monitoring requires no application identity. Network access
is the visibility boundary. Every future write request requires a separate
platform principal and server-side authorization; hiding controls in the web
interface is not authorization, and a GitLab token never authenticates a user.

## 6. System boundary

The first deployment topology has three roles:

- **A — GitLab Service**: authority for Projects, jobs, and Runner Records.
- **B — Arch Runner Service**: hosts the Control Plane, PostgreSQL, Host
  Provisioner, Host Agent, and one or more isolated Runner Stacks.
- **C — Operator device**: runs only the browser and communicates with B.

```text
C: Operator browser
      |
      | trusted network + verified HTTPS
      v
B: Web UI + Control Plane API -------> A: GitLab API
      |
      | typed request
      v
   Database + operation queue
      |                              ^
      | approved Operation           | observations
      v                              |
   provisioning Module          read-only Host Agent
      |              |
      |              `-------------> A: GitLab API
      |                 create Project Runner Record
      | one-use local secret handoff
      v
   Host Provisioner
      |
      | fixed local automation
      v
   Runner Stack --> Runner Manager --> A: GitLab over external VPN
                         |
                         `-- isolated per-build Job Containers
```

The browser communicates only with the Control Plane API and never receives a
GitLab API credential or Runner authentication token. The Host Agent remains
read-only. A separately packaged Host Provisioner executes only authorized,
schema-validated Operations and validates generated host identities at the
host seam. Next.js does not run as root and cannot invoke arbitrary sudo,
shell, Ansible, systemd, Podman, or filesystem operations.

The read connector and write-capable GitLab adapter use separate credentials.
The write adapter requires only the permission needed to create and manage
Runner Records in explicitly authorized Projects. Installed Runner
authentication tokens remain on their Runner Hosts.

## 7. Functional requirements

Requirement IDs are stable references for issues, tests, and release notes.

### 7.1 Inventory and enrollment

- **INV-001**: An Administrator can enroll a Runner Host using a one-time,
  expiring credential without placing a long-lived secret in command history.
- **INV-002**: A Runner Host has a stable platform identity independent of its
  hostname and IP address.
- **INV-003**: Each Runner Template is identified by a canonical name matching
  `^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$`.
- **INV-004**: The platform correlates a Runner Stack with its Runner Record
  using explicit identifiers, never names or tags alone.
- **INV-005**: Missing, duplicated, and unmatched identities are shown as
  separate states rather than silently merged.
- **INV-006**: Every Runner Stack has a stable platform ID and records the
  exact Runner Template revision from which it was created.

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
  `running`, `succeeded`, `failed`, `partially_failed`, `unknown`, `cancelled`,
  or `expired`.
- **OPS-003**: The initial reversible-operation allowlist is limited to
  refresh observations, run verification, restart a Runner Manager, and pause
  or resume a Runner Record.
- **OPS-004**: Restart requires confirmation that names the affected Runner
  Stack; pause and resume require confirmation that names the Runner Record.
- **OPS-005**: Install, upgrade, reconcile, uninstall, and purge are excluded
  from the initial reversible-operation allowlist. Project Runner creation and
  registration are available only through the narrower Provisioning Operation
  defined by PRV-001 through PRV-010.
- **OPS-006**: Operation parameters are schema-validated by both the API and
  the responsible execution adapter, including the Host Provisioner for host
  mutations. User-provided filesystem paths and command fragments are
  rejected.
- **OPS-007**: Retrying an Operation must be explicit and must create a linked
  audit event. Operations use idempotency keys where the underlying action can
  safely support them.
- **OPS-008**: A timeout or lost connection produces an `unknown` state with
  an outcome diagnostic until observation confirms the resulting state; it is
  never reported as success by assumption.

### 7.5 Project Runner provisioning

- **PRV-001**: An Operator can request one Project Runner by selecting an
  explicitly authorized GitLab Project and an approved Runner Template.
- **PRV-002**: The API re-evaluates the platform write principal, Project
  allowlist, Template policy, rate limit, and capacity limit when authorizing
  every request. UI visibility alone never grants permission.
- **PRV-003**: The request accepts typed policy choices only. It rejects raw
  Runner configuration, tokens, command fragments, Ansible variables,
  filesystem paths, Linux usernames, container names, and systemd unit names.
- **PRV-004**: The GitLab write adapter creates a Project Runner Record through
  the current Runner creation workflow using a credential separate from the
  read-only connector credential.
- **PRV-005**: The returned Runner authentication token is a write-only secret
  handoff to registration. It never enters the browser, API response,
  PostgreSQL, operation queue payload, audit event, application log,
  environment file, process argument, temporary file, or shell history.
- **PRV-006**: The Host Provisioner generates a unique Linux identity, Runner
  Manager, rootless Podman storage, configuration, cache, systemd units, and
  Agent credential for each Runner Stack from its selected Template revision.
- **PRV-007**: Provisioning records GitLab creation, host preparation,
  registration, verification, and observation as separate Operation stages.
- **PRV-008**: A repeated request with the same idempotency key cannot start a
  second provisioning attempt. Explicit retry resumes or safely repeats only
  stages whose outcomes are known. An interrupted GitLab creation with no
  confirmed response becomes `unknown outcome` and is not automatically
  retried.
- **PRV-009**: If GitLab creation succeeds and host provisioning fails, the
  Operation ends in a visible partial-failure state and preserves the Runner
  Record for explicit retry or manual cleanup. It is never automatically
  deleted or unregistered.
- **PRV-010**: Group and Instance Runner provisioning remain disabled until
  they receive separate authorization, credential, capacity, and security
  review.

### 7.6 GitLab integration

- **GLB-001**: The connector reads Runner Record, project, job, and contact
  information needed by the platform without reading unrelated project data.
- **GLB-002**: Read access and pause/resume access can use separate credentials
  or scopes.
- **GLB-003**: Rate limiting, authorization failure, and GitLab unavailability
  are visible without changing the last known host observation.
- **GLB-004**: The platform never automatically unregisters or deletes a
  Runner Record.
- **GLB-005**: Monitoring uses a dedicated `read_api` credential. Provisioning
  uses a separate credential with the narrowest supported Runner-management
  permission and cannot silently fall back to a broader token.
- **GLB-006**: Project selection is limited to an explicit administrator-owned
  allowlist because the platform does not use browser identity or delegated
  GitLab membership.

### 7.7 Web interface

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
- **UI-006**: The create flow shows the target Project, Template revision,
  generated identity summary, security policy, and expected host changes
  before confirmation.
- **UI-007**: After confirmation, the UI shows each Provisioning Operation
  stage and distinguishes failed, partial, unknown, and succeeded outcomes.

### 7.8 Audit

- **AUD-001**: Credential installation, authorization changes, enrollment,
  Desired State changes, and every Operation transition create audit events.
- **AUD-002**: Audit events are append-only to application roles and include a
  correlation ID spanning API, queue, Host Provisioner, and GitLab connector
  work.
- **AUD-003**: Audit exports are structured and redact tokens, credentials,
  environment variables, and token-bearing configuration.
- **AUD-004**: Retention is configurable; the production default must be
  approved before launch.

## 8. Data model

The logical model contains:

- **PlatformPrincipal** and **RoleAssignment** for future write authorization;
  read-only monitoring does not create a user record.
- **GitLabProjectRef** for an explicitly authorized provisioning target.
- **RunnerHost** for enrolled host identity and latest agent capabilities.
- **RunnerTemplate** and **RunnerTemplateRevision** for approved reusable
  workload policy.
- **RunnerStack** for one deployed Template instance and trust boundary on a
  Runner Host.
- **RunnerRecordRef** for the explicit GitLab-side identity and Runner Scope.
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
- The browser-facing Control Plane interface and Host Agent must never receive
  or return a Runner authentication token. Only dedicated provisioning
  adapters may hold a newly issued token transiently during its write-only
  handoff to registration.
- A Runner authentication token must never be persisted in PostgreSQL, queue
  payloads, logs, audit data, environment files, process arguments, temporary
  files, or shell history.
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
- Production operation access requires a separate platform write credential
  and deployment ingress policy. An identity-aware proxy may add MFA without
  making GitLab tokens browser credentials.

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
6. Every credential, enrollment, and authorization event is auditable.
7. Contract tests prove that unknown fields, unsupported operations, arbitrary
   paths, and token-shaped values are rejected or redacted as appropriate.
8. Disconnecting the Control Plane has no effect on a running Runner Manager
   or Job Container.

Remote operations are a subsequent milestone and are not required for the
read-only MVP.

### 11.1 Project provisioning acceptance criteria

The first write-capable release is complete when:

1. An authorized platform Operator can select only an allowlisted Project and
   an approved Runner Template without providing a GitLab token in the browser.
2. A duplicated request or queue delivery never starts a second provisioning
   attempt. A determinate success produces exactly one Project Runner Record
   and one isolated Runner Stack on B; ambiguous GitLab creation remains
   `unknown outcome` and is not automatically retried.
3. The Runner authentication token reaches registration without appearing in
   browser traffic, database rows, queue payloads, logs, audit events, process
   arguments, temporary files, or shell history.
4. The resulting Runner Stack uses a dedicated Linux identity, rootless
   Podman runtime, cache, configuration, systemd units, and Agent credential.
5. The UI shows GitLab creation, host preparation, registration, verification,
   and first observations as independently recoverable stages.
6. Every denial, state transition, retry, and partial failure is auditable
   without including a secret.
7. If host provisioning fails after GitLab creation, the Runner Record is
   preserved and the UI offers explicit retry guidance rather than claiming
   success or automatically deleting it.
8. Viewer users, unauthorized Projects, unapproved Templates, Group scopes,
   Instance scopes, arbitrary paths, and command fragments are rejected by
   direct API tests.

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

### Milestone 2: write authorization and operation foundation

- Separate platform write credentials or trusted gateway principals, with
  rotation and revocation.
- Project allowlist and server-side authorization.
- Durable Operation queue, progress model, audit correlation, idempotency, and
  timeout handling.
- Separately packaged Host Provisioner with injected test doubles for
  integration tests; no fake runtime mode, and mutating operations remain
  disabled by default.

### Milestone 3: one-click Project Runner provisioning

- Versioned Runner Template catalog and deployment preview.
- Dedicated GitLab write adapter and secret handoff.
- Project Runner Record creation, host preparation, registration,
  verification, first observation, retry, and partial-failure recovery.
- Staging canary, threat-model approval, and feature-flagged rollout.

### Milestone 4: reversible operations and reconciliation

- Refresh, verify, restart, pause, and resume operations.
- Reviewed Desired State revisions.
- Install, upgrade, and reconcile through typed plans and approvals.
- Canary rollout, failure budgets, rollback guidance, and maintenance windows.

Group and Instance provisioning, remote uninstall or purge, and Runner Record
deletion require separate specification and security review. Local CLI
uninstall removes one Runner Stack and Linux user but deliberately preserves
the GitLab Runner Record.

## 13. Open decisions before implementation

The selected Web implementation uses Next.js with TypeScript, MUI, tRPC,
Prisma, PostgreSQL, and pnpm. Provisioning Operations use the PostgreSQL queue,
and the Host Agent has a systemd user service with a scoped bootstrap flow.
The following decisions remain open:

- Exact write-principal mechanism and optional identity-aware proxy policy.
- Long-term topology beyond the initial same-site deployment on B.
- Ownership and rotation policy for the Project Runner `manage_runner`
  integration credential.
- Supported GitLab edition/version range. The current connector reads exact
  Runner IDs through GraphQL with a dedicated `read_api` credential.
- Audit and observation retention periods.

Each choice should be made with a small architecture decision record when it
is hard to reverse and involves a genuine trade-off. None may weaken the
product principles or security requirements above.
