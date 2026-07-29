# Adding a stack

Create stacks by infrastructure function and workload:
`stacks/<infrastructure-type>/<workload>`. Do not introduce language-based or
overlapping top-level categories.

Every stack requires `README.md` and `config.example.yml`. Add files, examples,
and smoke tests only when the workload needs them. Keep shared system behavior
in a reusable role and keep the stack limited to differences.

Add the stack to `tests/validate-all.sh` through the standard
`config.example.yml` discovery convention. Add a path-based GitLab CI job.
Changes to a shared role must trigger validation of every dependent stack.

The stack name must match
`^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$`. Never accept a caller-supplied
filesystem path in an operation script.

