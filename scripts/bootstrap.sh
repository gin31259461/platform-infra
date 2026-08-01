#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ${EUID} -ne 0 ]]; then
  echo "This script must be run as root." >&2
  exit 1
fi

if [[ ! -f /etc/arch-release ]]; then
  echo "Only Arch Linux is supported." >&2
  exit 1
fi

pacman -Syu --needed --noconfirm \
  ansible-core \
  git \
  python \
  python-yaml

ansible-galaxy collection install \
  --collections-path /usr/share/ansible/collections \
  -r "${PROJECT_ROOT}/requirements.yml"

echo "Bootstrap completed."
