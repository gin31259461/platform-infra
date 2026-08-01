#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

[[ ${1:-} == -- ]] && shift
project=""
template=""
while (($# > 0)); do
  case $1 in
    --project)
      [[ $# -ge 2 && -z ${project} ]] || die "Missing or duplicate --project."
      project=$2
      shift 2
      ;;
    --template)
      [[ $# -ge 2 && -z ${template} ]] || die "Missing or duplicate --template."
      template=$2
      shift 2
      ;;
    *) die "Usage: pnpm runner:provision -- --project namespace/project --template gitlab-runners/frontend|dotnet" ;;
  esac
done

[[ ${project} =~ ^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)+$ ]] || die "GitLab Project path is invalid."
[[ ${template} == gitlab-runners/frontend || ${template} == gitlab-runners/dotnet ]] ||
  die "Runner Template is unsupported."
[[ -t 0 ]] || die "Project Runner provisioning requires an interactive terminal for sudo."

if [[ ${EUID} -ne 0 ]]; then
  sudo -v
fi

request_output="$(pnpm --silent --filter @gitlab-runner-platform/web exec tsx \
  scripts/request-provisioning-operation.ts \
  --project "${project}" \
  --template "${template}")"
operation_id="$(printf '%s' "${request_output}" | node -e '
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const value = JSON.parse(input);
    if (typeof value.operationId !== "string") process.exit(1);
    process.stdout.write(value.operationId);
  });
')" || die "Provisioning Operation output is invalid."
info "Authorized Provisioning Operation ${operation_id}."

stage_output="$(pnpm --silent --filter @gitlab-runner-platform/web exec tsx \
  scripts/prepare-provisioning-host.ts \
  --operation-id "${operation_id}")"
stack_id="$(printf '%s' "${stage_output}" | node -e '
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const value = JSON.parse(input);
    if (typeof value.stackId !== "string") process.exit(1);
    process.stdout.write(value.stackId);
  });
')" || die "Host preparation output is invalid."
info "Prepared local Runner Stack ${stack_id}."

"${SCRIPT_DIR}/install.sh" "${template}" "${stack_id}"
if [[ ${EUID} -ne 0 ]]; then
  sudo -v
fi
pnpm --silent --filter @gitlab-runner-platform/web exec tsx \
  scripts/run-provisioning-worker.ts \
  --operation-id "${operation_id}"

info "Provisioned ${stack_id} with Host observation enabled; its GitLab Runner Record remains paused for operator verification."
