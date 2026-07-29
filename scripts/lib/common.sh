#!/usr/bin/env bash
set -Eeuo pipefail

# PROJECT_ROOT is consumed by scripts that source this library.
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC2034
readonly PROJECT_ROOT

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '%s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

as_root() {
  if [[ ${EUID} -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

as_runner_user() {
  local runner_user=$1
  local runner_uid=$2
  local runner_home="/home/${runner_user}"
  shift 2

  if [[ ${EUID} -eq 0 ]]; then
    # shellcheck disable=SC2016 # Expanded by the child shell.
    runuser --user "${runner_user}" -- sh -c '
      cd -- "$1"
      shift
      exec "$@"
    ' sh "${runner_home}" env \
        XDG_RUNTIME_DIR="/run/user/${runner_uid}" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${runner_uid}/bus" \
        "$@"
  else
    # shellcheck disable=SC2016 # Expanded by the child shell.
    sudo -u "${runner_user}" sh -c '
      cd -- "$1"
      shift
      exec "$@"
    ' sh "${runner_home}" env \
        XDG_RUNTIME_DIR="/run/user/${runner_uid}" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${runner_uid}/bus" \
        "$@"
  fi
}
