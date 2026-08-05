# Development rules

Priorities:

```text
Correctness
> Readability
> Testability
> Maintainability
> Performance
> Cleverness
```

Python code follows KISS, YAGNI, single responsibility, explicit dependency
injection, immutable typed domain models, specific exception handling, and
I/O isolation through adapters. Public functions and methods require complete
type hints. Core business structures must not use `Any` or `dict[str, Any]`.

Required checks:

```bash
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked mypy --strict src tests bootstrap.py
uv run --locked pytest
uv run --locked yamllint .
uv run --locked ansible-lint
uv run --locked platform-infra validate-all
```

Do not add shell scripts. Use Python for application workflows and Ansible for
managed-host state. Never place tokens or private keys in repository files,
command arguments, logs, fixtures, or example configuration.
