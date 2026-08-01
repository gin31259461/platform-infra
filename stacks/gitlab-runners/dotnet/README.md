# .NET Runner

Project-scoped .NET Runner using a dedicated Arch Linux user, rootless Podman,
and GitLab Runner's Docker executor protocol.

Jobs may select official .NET SDK, runtime, or ASP.NET Core images. SQL Server
is allowed only as an isolated per-build service from
`mcr.microsoft.com/mssql/server:*`; it is never published on the Host.

## Configure

```bash
cp stacks/gitlab-runners/dotnet/config.example.yml \
  stacks/gitlab-runners/dotnet/config.yml
$EDITOR stacks/gitlab-runners/dotnet/config.yml
```

Set the GitLab origin, VPN interface, and VPN DNS resolver when required. For a
private CA, provide only an absolute path to the public CA certificate.

The Stack config owns Host and image policy. Project paths, SDK/runtime/SQL
Server versions, NuGet sources, and build settings belong in the consuming
pipeline. Adapt `examples/dotnet.gitlab-ci.yml` there.

For protected NuGet feeds, use masked CI variables named
`NuGetPackageSourceCredentials_<source_name>`. Never embed credentials in
source URLs or committed config.

## Install

```bash
make check STACK=gitlab-runners/dotnet
make install STACK=gitlab-runners/dotnet
```

This prepares the Runner Host without creating a GitLab Runner Record. Create
a project-scoped Record with tags `dotnet,podman`, disable untagged jobs, and
lock it to the Project. Then register:

```bash
read -rsp "GitLab Runner token: " RUNNER_AUTH_TOKEN
echo
printf '%s\n' "${RUNNER_AUTH_TOKEN}" | \
  make register STACK=gitlab-runners/dotnet
unset RUNNER_AUTH_TOKEN
```

Alternatively, after Control Plane provisioning setup:

```bash
pnpm runner:provision -- \
  --project namespace/project \
  --template gitlab-runners/dotnet
```

## Verify

```bash
make verify STACK=gitlab-runners/dotnet
```

Set a strong masked `MSSQL_SA_PASSWORD_UI` variable before SQL Server jobs.
Run `tests/smoke.gitlab-ci.yml` before adopting the complete example.

## Uninstall from the Runner Host

Canonical Stack:

```bash
make uninstall STACK=gitlab-runners/dotnet
```

Provisioned instance:

```bash
make uninstall \
  STACK=gitlab-runners/dotnet \
  STACK_INSTANCE_ID=dotnet-REPLACE_WITH_12_HEX
```

After exact confirmation this permanently removes the local Runner user and
all local data. The GitLab Runner Record is preserved.
