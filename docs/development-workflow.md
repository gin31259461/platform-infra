# Development workflow

This workflow evolves the existing Runner host automation into the target
described by [SPEC.md](../SPEC.md) while preserving the trust boundaries in
[Security](security.md).

## 1. Work from a requirement

Every product change starts from a GitLab issue linked to at least one stable
requirement ID from `SPEC.md`. The issue must state:

- the operator problem and expected observable outcome;
- the affected roles and trust boundaries;
- current behavior and the smallest useful vertical slice;
- acceptance scenarios, including stale data and partial failure;
- whether the change is read-only, mutating, or destructive;
- documentation, migration, rollback, and telemetry impact.

If the behavior is not represented in the specification, update the spec in
the same change or before implementation. Use terms from `CONTEXT.md`; change
the glossary when a domain distinction changes.

## 2. Classify risk before design

| Class | Examples | Required review |
| --- | --- | --- |
| Observation | Health check, inventory field, read-only GitLab data | Contract, privacy, and stale-data handling |
| Reversible operation | Verify, restart, pause, resume | Authorization, threat model, idempotency, timeout, and audit |
| Host reconciliation | Install, upgrade, Desired State apply | Plan, approval, canary, idempotency, rollback, and live validation |
| Destructive operation | Purge data or delete a Runner Record | Separate specification and explicit security approval |

An issue cannot be downgraded because its UI looks harmless. Risk follows the
effect at the GitLab or Runner Host boundary.

## 3. Design the vertical slice

Prefer one end-to-end behavior over building a complete layer in isolation. A
typical slice contains only the pieces needed for one acceptance scenario:

```text
domain contract
    -> API authorization
    -> persistence or queue transition
    -> Host Agent or GitLab adapter
    -> observation/audit event
    -> UI state
```

Before coding:

1. Add concrete examples for success, denial, timeout, duplicate delivery,
   stale observation, and redaction.
2. Version the API, observation, Desired State, or Operation contract when the
   slice crosses a process boundary.
3. Record a focused architecture decision only for a hard-to-reverse trade-off
   that would otherwise surprise future maintainers.
4. For a mutating slice, complete a threat-model review before enabling it.
5. Identify how the feature is disabled or rolled back independently.

The first platform slice should be read-only: enroll one test Runner Host,
report one existing Runner Stack's structured health, correlate it with one
Runner Record, and render the result with source timestamps.

## 4. Implement in small commits

Use a short-lived branch and the repository's Conventional Commit form:

```text
type: concise lowercase message
```

A useful sequence is:

1. `test:` add contract or regression examples that describe the behavior.
2. `feat:` or `fix:` implement the smallest passing domain/API behavior.
3. `feat:` connect the host or GitLab adapter behind a fakeable interface.
4. `feat:` expose the state in the UI with denial and failure states.
5. `docs:` update operations, security, migration, or troubleshooting guidance.

Keep refactoring commits behavior-preserving and separate when that makes the
review easier. Never include real `config.yml`, tokens, `.env` files, VPN
credentials, private keys, or token-bearing Runner configuration.

## 5. Test from narrow to broad

Run the smallest affected test first, then the relevant component suite, then
repository-wide non-destructive checks.

### Existing host automation

| Change | Minimum checks |
| --- | --- |
| Stack configuration | `make validate STACK=gitlab-runners/frontend`, then `make validate-all` |
| DNS or Runner config reconciliation | `./tests/test-vpn-dns.sh`, then `make validate-all` |
| Shell, YAML, Ansible, or security boundary | `make lint`, then `make validate-all` |

Live host commands remain opt-in. Run `make check`, `make install`, `make
verify`, and `make idempotency` only on the supported Arch host with explicit
authorization, an active VPN, and interactive sudo.

### New platform components

Each component must add a documented, non-interactive test command before it
can merge. The root `Makefile` should eventually provide these stable entry
points as the components are introduced:

```text
make test-control-plane
make test-agent
make test-ui
make test-contracts
make test-e2e
```

Do not add empty placeholder targets. `make test-agent` now runs the packaged
Python Host Agent tests; the other component targets remain unavailable until
their components exist.

Use the following test levels:

- **Unit tests** for domain rules, health reasoning, policy, and redaction.
- **Contract tests** for every versioned boundary and backward-compatible
  fixture.
- **Integration tests** with disposable database, queue, GitLab adapter fake,
  and unprivileged host adapter fake.
- **Authorization tests** for every role/action/resource combination, including
  direct API access rather than UI visibility alone.
- **End-to-end tests** for the main fleet, detail, stale-data, denial, and
  Operation-progress paths.
- **Live canary tests** only for changes that reach a real GitLab instance or
  supported Runner Host.

Every reproducible bug receives a focused regression test. Always finish with
`git diff --check`.

## 6. Review gates

A merge request is ready for review when it includes:

- linked requirement IDs and acceptance scenarios;
- screenshots or recordings for visible UI behavior;
- contract fixtures for changed process boundaries;
- test evidence with skipped live checks called out explicitly;
- threat-model notes for any new data flow or permission;
- migration and rollback notes for schema, agent, or Desired State changes;
- confirmation that logs, fixtures, and screenshots contain no secrets.

Require a security-focused reviewer for authentication, authorization,
enrollment, GitLab credentials, Host Agent credentials, remote Operations,
secret handling, or changes to the existing Runner trust boundary.

Reviewers evaluate these concerns independently:

1. Does the change satisfy the linked specification behavior?
2. Does it preserve domain language and component boundaries?
3. Can a lower-privileged actor or compromised component abuse the change?
4. Are denial, duplicate delivery, timeout, stale state, and rollback visible?
5. Is the narrowest sufficient test present?

## 7. Environments and delivery

Use four confidence levels:

1. **Local**: fakes and disposable dependencies; no production credentials.
2. **CI**: lint, unit, contract, integration, authorization, UI, migration, and
   secret-scanning gates.
3. **Staging**: isolated GitLab project and dedicated Runner Host with synthetic
   workloads and credentials.
4. **Production**: canary Host/Stack first, observed rollback window, then
   controlled expansion.

Database migrations must be backward-compatible with the previously deployed
Control Plane during rollout. Host Agent and Control Plane contracts must
support a documented compatibility window so they can be upgraded in either
order. A feature flag must default mutating Operations off until staging
evidence and security review are complete.

Production releases must publish:

- versioned artifacts and dependency inventory;
- database migration and rollback instructions;
- supported Control Plane/Host Agent compatibility;
- changed requirement IDs and operator-visible behavior;
- known limitations and monitoring signals.

## 8. Definition of done

A change is done only when:

- its acceptance scenarios pass at the appropriate test levels;
- authorization and redaction are verified at every affected boundary;
- audit and observation behavior is queryable and understandable;
- partial failure does not falsely report success or current health;
- documentation, migration, rollback, and troubleshooting are updated where
  behavior changed;
- non-destructive repository checks pass;
- live validation is completed when required and authorized, or explicitly
  recorded as pending before production release.

For the read-only MVP, completion is measured by the acceptance criteria in
section 11 of `SPEC.md`; remote operation controls are not pulled forward to
make the dashboard appear complete.
