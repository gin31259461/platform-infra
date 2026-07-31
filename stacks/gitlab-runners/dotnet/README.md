# .NET GitLab Runner

This stack installs one project-scoped .NET Runner on Arch Linux. The manager
runs as `gitlab-runner-dotnet` in rootless Podman and uses the rootless Podman
socket through GitLab Runner's Docker executor protocol.

CI jobs can build and test with a selected .NET SDK image, validate published
output with a selected .NET or ASP.NET Core runtime image, and start a selected
SQL Server image as an isolated per-build service. The service allowlist is
limited to `mcr.microsoft.com/mssql/server:*`.

## Configure

```bash
cp stacks/gitlab-runners/dotnet/config.example.yml \
  stacks/gitlab-runners/dotnet/config.yml
$EDITOR stacks/gitlab-runners/dotnet/config.yml
```

Replace only the GitLab hostname and VPN interface. The Runner configuration
owns the host and registration policy:

- `runner.default_job_image` is the pinned fallback used only when a CI job
  does not declare `image`.
- `runner.allowed_images` limits project-selected job images to the official
  .NET SDK, .NET runtime, and ASP.NET Core repositories.
- `runner.allowed_services` limits project-selected services to the official
  SQL Server repository.

Project paths, SDK/runtime/SQL Server versions, SQL tools, and NuGet sources
do not belong in this file.

For a local configuration copied before `network.validation_image` was added,
add:

```yaml
network:
  validation_image: docker.io/curlimages/curl:8.12.1
```

The pinned image above is used as a temporary migration default when the field
is absent.

If GitLab uses a private CA, set `tls.private_ca_enabled: true` and provide an
absolute path to the public CA certificate. Never place a private key in this
repository. If the VPN changes DNS during startup, set `network.vpn_dns` to
its resolver IP.

## Configure the consuming project

The consuming project's `.gitlab-ci.yml` owns every build parameter. Adapt
`examples/dotnet.gitlab-ci.yml` and set:

- `DOTNET_PROJECT`
- `DOTNET_SDK_IMAGE` and `DOTNET_SDK_VERSION`
- `DOTNET_RUNTIME_IMAGE` and `DOTNET_RUNTIME_VERSION`
- `SQL_SERVER_IMAGE` and `SQL_SERVER_VERSION`
- `SQL_TOOLS_PACKAGE` and `SQL_TOOLS_REPOSITORY_URL`
- `NUGET_SOURCES`

Keep fixed images on explicit version and OS tags. Use
`mcr.microsoft.com/dotnet/runtime` for console or worker applications, or
`mcr.microsoft.com/dotnet/aspnet` for ASP.NET Core applications.

List each NuGet feed in `NUGET_SOURCES` as `name=https://...`. For a protected
feed, create a masked GitLab CI/CD variable named
`NuGetPackageSourceCredentials_<source_name>` using NuGet's credential value
format:

```text
Username=REPLACE_WITH_USERNAME;Password=REPLACE_WITH_TOKEN;ValidAuthenticationTypes=Basic
```

The example pipeline validates source names and HTTPS URLs, creates a job-local
`NuGet.Config`, and removes it after each job. Do not put credentials in source
URLs or committed configuration.

## Install and register

Bootstrap and reboot first so the running Arch kernel has matching networking
modules. Reconnect the manually managed VPN after reboot:

```sh
sudo make bootstrap
sudo reboot
```

After reboot:

```sh
cd gitlab-runner-platform

make check STACK=gitlab-runners/dotnet
make install STACK=gitlab-runners/dotnet
```

Create the Project Runner in GitLab, then use this zsh-compatible token input:

```zsh
read -rs "GITLAB_RUNNER_TOKEN?GitLab Runner token: "
echo
export GITLAB_RUNNER_TOKEN
make register STACK=gitlab-runners/dotnet
unset GITLAB_RUNNER_TOKEN
```

For Bash, use
`read -rsp "GitLab Runner token: " GITLAB_RUNNER_TOKEN` instead.

Configure the Project Runner with tags `dotnet` and `podman`, disable untagged
jobs, and lock it to the project. Verify the installation:

```sh
make verify STACK=gitlab-runners/dotnet
```

Set a strong masked `MSSQL_SA_PASSWORD_UI` CI/CD variable before running a
pipeline. The example reassigns it to `MSSQL_SA_PASSWORD` because GitLab does
not pass UI-defined variables directly to service containers. Do not enable
service debug logging when masked values are in use. Run
`tests/smoke.gitlab-ci.yml` first, then adapt
`examples/dotnet.gitlab-ci.yml` to the project.
