# Migration from the shell-based repository

The migration archive contains a Python installer that replaces the working
tree while preserving local configuration files.

Preserved by default:

- `stacks/**/config.yml`
- `stacks/**/files/certs/**`
- `inventory/hosts.yml`
- any additional inventory YAML files not supplied by the new payload

Removed by replacement:

- `scripts/**/*.sh`
- shell test wrappers
- the Makefile command layer
- Arch-only package roles
- Quadlet templates from the previous implementation
- obsolete generated caches and local environments

After applying the migration:

```bash
python3 bootstrap.py
uv run --locked platform-infra validate-all
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked mypy --strict src tests bootstrap.py
uv run --locked pytest
uv run --locked yamllint .
uv run --locked ansible-lint
```

Review your local stack files. Existing fields remain compatible. The new
portable fields are optional for the original `frontend` and `dotnet` stacks,
but explicitly setting `runner.home`, `runner.subuid_start`,
`runner.subgid_start`, and `runner.subordinate_id_count` is recommended.

## Legacy home-directory compatibility

When an existing local stack omits `runner.home`, the parser preserves the old
`/home/<runner.user>` behavior. New examples explicitly use `/var/lib/...`.
Add `runner.home` to each local config only after confirming the existing Linux
account uses that exact path.
