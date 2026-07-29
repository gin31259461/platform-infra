#!/usr/bin/env python
"""Reconcile non-secret settings in a registered GitLab Runner config."""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import tempfile
import tomllib
from pathlib import Path

DOCKER_SECTION = re.compile(r"^\s*\[runners\.docker\]\s*(?:#.*)?$")
TABLE_HEADER = re.compile(r"^\s*\[\[?.+?\]?\]\s*(?:#.*)?$")
DNS_SETTING = re.compile(r"^(?P<indent>\s*)dns\s*=.*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--dns", required=True)
    return parser.parse_args()


def reconcile_dns(contents: str, dns: str) -> str:
    """Set dns in every registered [runners.docker] section."""
    ipaddress.ip_address(dns)
    tomllib.loads(contents)

    lines = contents.splitlines(keepends=True)
    section_starts = [
        index
        for index, line in enumerate(lines)
        if DOCKER_SECTION.fullmatch(line.rstrip("\r\n"))
    ]

    for start in reversed(section_starts):
        end = next(
            (
                index
                for index in range(start + 1, len(lines))
                if TABLE_HEADER.fullmatch(lines[index].rstrip("\r\n"))
            ),
            len(lines),
        )
        dns_lines = [
            index
            for index in range(start + 1, end)
            if DNS_SETTING.fullmatch(lines[index].rstrip("\r\n"))
        ]

        if dns_lines:
            first = dns_lines[0]
            match = DNS_SETTING.fullmatch(lines[first].rstrip("\r\n"))
            assert match is not None
            newline = "\r\n" if lines[first].endswith("\r\n") else "\n"
            lines[first] = (
                f"{match.group('indent')}dns = {json.dumps([dns])}{newline}"
            )
            for duplicate in reversed(dns_lines[1:]):
                del lines[duplicate]
        else:
            section_indent = re.match(r"^\s*", lines[start]).group()
            lines.insert(
                start + 1,
                f"{section_indent}  dns = {json.dumps([dns])}\n",
            )

    reconciled = "".join(lines)
    tomllib.loads(reconciled)
    return reconciled


def atomic_write(path: Path, contents: str) -> None:
    metadata = path.stat()
    temporary_path: str | None = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as stream:
            temporary_path = stream.name
            os.fchmod(stream.fileno(), metadata.st_mode)
            if (
                metadata.st_uid != os.getuid()
                or metadata.st_gid != os.getgid()
            ):
                os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            Path(temporary_path).unlink(missing_ok=True)


def main() -> None:
    args = parse_args()
    original = args.config.read_text(encoding="utf-8")
    reconciled = reconcile_dns(original, args.dns)

    if reconciled == original:
        print("unchanged")
        return

    atomic_write(args.config, reconciled)
    print("changed")


if __name__ == "__main__":
    main()
