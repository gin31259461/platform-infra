#!/usr/bin/env python3
"""Collect bounded Runner health facts and deliver one versioned observation."""

from __future__ import annotations

import datetime as dt
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Callable, Mapping
import urllib.error
import urllib.parse
import urllib.request
import uuid


AGENT_VERSION = "0.1.0"
CONTRACT_VERSION = "1.0"
MAX_OBSERVATION_BYTES = 64 * 1024
SECRET_PATTERN = re.compile(
    r"(glrt-|glpat-|gldt-|authorization\s*:\s*bearer|-----begin [^-]*private key-----)",
    re.IGNORECASE,
)


class AgentError(RuntimeError):
    """A bounded error safe to print without leaking observation or credentials."""


@dataclass(frozen=True)
class StackConfig:
    gitlab_health_path: str
    gitlab_hostname: str
    id: str
    runner_service: str
    stack_name: str
    tags: tuple[str, ...]
    vpn_interface: str
    workload: str


@dataclass(frozen=True)
class AgentConfig:
    allow_plaintext_loopback: bool
    control_plane_url: str
    credential_id: str
    host_id: str
    request_timeout_seconds: int
    stack: StackConfig


@dataclass(frozen=True)
class AgentPaths:
    home: Path

    @property
    def config_file(self) -> Path:
        return self.home / ".config/gitlab-runner-platform/agent.json"

    @property
    def credential_file(self) -> Path:
        return self.home / ".config/gitlab-runner-platform/credential"

    @property
    def pending_file(self) -> Path:
        return self.state_directory / "pending-observation.json"

    @property
    def state_directory(self) -> Path:
        return self.home / ".local/state/gitlab-runner-platform"


def _require_exact_keys(value: object, expected: set[str], name: str) -> Mapping[str, object]:
    if not isinstance(value, dict) or set(value) != expected:
        raise AgentError(f"Invalid {name} fields")
    return value


def _require_string(value: object, pattern: str, name: str, maximum: int = 120) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= maximum or not re.fullmatch(pattern, value):
        raise AgentError(f"Invalid {name}")
    return value


def _validate_control_plane_url(value: object, allow_plaintext_loopback: bool) -> str:
    if not isinstance(value, str):
        raise AgentError("Invalid Control Plane URL")
    try:
        parsed = urllib.parse.urlsplit(value)
        parsed.port
    except ValueError as error:
        raise AgentError("Invalid Control Plane URL") from error
    secure_origin = parsed.scheme == "https"
    staging_loopback_origin = (
        allow_plaintext_loopback
        and parsed.scheme == "http"
        and parsed.hostname in ("127.0.0.1", "::1")
    )
    if (
        not (secure_origin or staging_loopback_origin)
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise AgentError("Control Plane URL must be an HTTPS origin or explicitly allowed loopback HTTP origin")
    return value.rstrip("/")


def parse_config(value: object) -> AgentConfig:
    root = _require_exact_keys(
        value,
        {
            "allowPlaintextLoopback",
            "contractVersion",
            "controlPlaneUrl",
            "credentialId",
            "hostId",
            "requestTimeoutSeconds",
            "stack",
        },
        "Agent configuration",
    )
    if root["contractVersion"] != CONTRACT_VERSION:
        raise AgentError("Unsupported observation contract version")
    timeout = root["requestTimeoutSeconds"]
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 30:
        raise AgentError("Invalid request timeout")
    allow_plaintext_loopback = root["allowPlaintextLoopback"]
    if not isinstance(allow_plaintext_loopback, bool):
        raise AgentError("Invalid plaintext loopback policy")

    stack_value = _require_exact_keys(
        root["stack"],
        {"gitlabHealthPath", "gitlabHostname", "id", "runnerService", "stackName", "tags", "vpnInterface", "workload"},
        "Runner Stack configuration",
    )
    workload = _require_string(stack_value["workload"], r"frontend|dotnet", "workload")
    stack_name = _require_string(stack_value["stackName"], r"[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*", "Stack name")
    if stack_name != f"gitlab-runners/{workload}":
        raise AgentError("Stack name does not match workload")
    tags = stack_value["tags"]
    if (
        not isinstance(tags, list)
        or len(tags) > 20
        or any(not isinstance(tag, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", tag) for tag in tags)
    ):
        raise AgentError("Invalid Runner tags")
    health_path = _require_string(stack_value["gitlabHealthPath"], r"/[A-Za-z0-9_./-]*", "GitLab health path", 200)
    if ".." in health_path.split("/"):
        raise AgentError("Invalid GitLab health path")

    return AgentConfig(
        allow_plaintext_loopback=allow_plaintext_loopback,
        control_plane_url=_validate_control_plane_url(root["controlPlaneUrl"], allow_plaintext_loopback),
        credential_id=_require_string(root["credentialId"], r"hac_[A-Za-z0-9_-]{12,64}", "credential ID", 68),
        host_id=_require_string(root["hostId"], r"[A-Za-z0-9][A-Za-z0-9_-]{0,119}", "Host ID"),
        request_timeout_seconds=timeout,
        stack=StackConfig(
            gitlab_health_path=health_path,
            gitlab_hostname=_require_string(stack_value["gitlabHostname"], r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}", "GitLab hostname", 253),
            id=_require_string(stack_value["id"], r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", "Stack ID"),
            runner_service=_require_string(stack_value["runnerService"], r"[a-zA-Z0-9@_.-]+\.service", "Runner service"),
            stack_name=stack_name,
            tags=tuple(tags),
            vpn_interface=_require_string(stack_value["vpnInterface"], r"[A-Za-z0-9_.-]{1,15}", "VPN interface", 15),
            workload=workload,
        ),
    )


def _validate_file(path: Path, *, secret: bool) -> os.stat_result:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise AgentError(f"Required Agent file is missing: {path.name}") from error
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
        raise AgentError(f"Agent file ownership or type is unsafe: {path.name}")
    forbidden = 0o077 if secret else 0o022
    if stat.S_IMODE(metadata.st_mode) & forbidden:
        raise AgentError(f"Agent file permissions are unsafe: {path.name}")
    return metadata


def load_config(path: Path) -> AgentConfig:
    metadata = _validate_file(path, secret=False)
    if metadata.st_size > 16 * 1024:
        raise AgentError("Agent configuration is too large")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise AgentError("Agent configuration is unreadable") from error
    return parse_config(value)


def load_credential(path: Path) -> str:
    metadata = _validate_file(path, secret=True)
    if metadata.st_size > 256:
        raise AgentError("Agent credential is too large")
    try:
        secret = path.read_text(encoding="utf-8").removesuffix("\n")
    except (OSError, UnicodeError) as error:
        raise AgentError("Agent credential is unreadable") from error
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", secret):
        raise AgentError("Agent credential format is invalid")
    return secret


def _check(key: str, state: str, summary: str) -> dict[str, str]:
    if SECRET_PATTERN.search(summary) or not 1 <= len(summary) <= 240:
        raise AgentError("Unsafe diagnostic summary")
    return {"key": key, "state": state, "summary": summary}


def check_vpn(config: AgentConfig, _paths: AgentPaths) -> dict[str, str]:
    available = (Path("/sys/class/net") / config.stack.vpn_interface).is_dir()
    return _check("vpn", "healthy" if available else "unhealthy", "VPN interface is available" if available else "VPN interface is missing")


def check_dns(config: AgentConfig, _paths: AgentPaths) -> dict[str, str]:
    started = time.monotonic()
    try:
        socket.getaddrinfo(config.stack.gitlab_hostname, 443, type=socket.SOCK_STREAM)
    except OSError:
        return _check("dns", "unhealthy", "GitLab hostname is unresolved")
    milliseconds = min(9999, round((time.monotonic() - started) * 1000))
    state = "healthy" if milliseconds < 500 else "degraded"
    return _check("dns", state, f"GitLab resolved in {milliseconds} ms")


def check_tls(config: AgentConfig, _paths: AgentPaths) -> dict[str, str]:
    try:
        context = ssl.create_default_context()
        with socket.create_connection((config.stack.gitlab_hostname, 443), timeout=config.request_timeout_seconds) as raw:
            with context.wrap_socket(raw, server_hostname=config.stack.gitlab_hostname) as connection:
                certificate = connection.getpeercert()
        expires = certificate.get("notAfter")
        if not isinstance(expires, str):
            return _check("tls", "unknown", "TLS certificate expiry is unavailable")
        remaining = int((ssl.cert_time_to_seconds(expires) - time.time()) // 86400)
        state = "healthy" if remaining >= 14 else "degraded" if remaining >= 0 else "unhealthy"
        return _check("tls", state, f"TLS certificate is valid for {max(0, remaining)} days")
    except (OSError, ssl.SSLError, ValueError):
        return _check("tls", "unhealthy", "TLS verification failed")


def _systemctl(*arguments: str, home: Path) -> tuple[int, str]:
    try:
        result = subprocess.run(
            ["/usr/bin/systemctl", "--user", *arguments],
            check=False,
            cwd=home,
            stderr=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            text=True,
            timeout=5,
        )
        return result.returncode, result.stdout.strip()[:32]
    except (OSError, subprocess.TimeoutExpired):
        return 1, ""


def check_systemd_user(_config: AgentConfig, paths: AgentPaths) -> dict[str, str]:
    code, state = _systemctl("is-system-running", home=paths.home)
    if code == 0 and state == "running":
        return _check("systemd-user", "healthy", "systemd user manager is running")
    if state == "degraded":
        return _check("systemd-user", "degraded", "systemd user manager is degraded")
    return _check("systemd-user", "unhealthy", "systemd user manager is unavailable")


def check_podman_socket(_config: AgentConfig, _paths: AgentPaths) -> dict[str, str]:
    path = Path(f"/run/user/{os.getuid()}/podman/podman.sock")
    try:
        available = stat.S_ISSOCK(path.lstat().st_mode)
    except OSError:
        available = False
    return _check("podman-socket", "healthy" if available else "unhealthy", "Podman socket exists" if available else "Podman socket is missing")


def check_runner_manager(config: AgentConfig, paths: AgentPaths) -> dict[str, str]:
    code, state = _systemctl("is-active", config.stack.runner_service, home=paths.home)
    active = code == 0 and state == "active"
    return _check("runner-manager", "healthy" if active else "unhealthy", "Runner Manager is active" if active else "Runner Manager is inactive")


def check_runner_config(_config: AgentConfig, paths: AgentPaths) -> dict[str, str]:
    path = paths.home / "gitlab-runner/config/config.toml"
    try:
        metadata = path.lstat()
        secure = stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.getuid() and stat.S_IMODE(metadata.st_mode) == 0o600
    except OSError:
        secure = False
    return _check("runner-config", "healthy" if secure else "unhealthy", "Runner configuration exists with mode 0600" if secure else "Runner configuration is missing or has unsafe permissions")


def check_gitlab_connectivity(config: AgentConfig, _paths: AgentPaths) -> dict[str, str]:
    connection = None
    try:
        connection = http.client.HTTPSConnection(
            config.stack.gitlab_hostname,
            443,
            context=ssl.create_default_context(),
            timeout=config.request_timeout_seconds,
        )
        connection.request("GET", config.stack.gitlab_health_path, headers={"User-Agent": f"gitlab-runner-platform-agent/{AGENT_VERSION}"})
        response = connection.getresponse()
        response.read(1)
        healthy = 200 <= response.status < 300
        return _check("gitlab-connectivity", "healthy" if healthy else "degraded", "GitLab HTTPS health endpoint is available" if healthy else "GitLab HTTPS health endpoint returned a non-success status")
    except (OSError, ssl.SSLError, http.client.HTTPException):
        return _check("gitlab-connectivity", "unhealthy", "GitLab HTTPS health endpoint is unavailable")
    finally:
        if connection is not None:
            connection.close()


CHECKS: tuple[Callable[[AgentConfig, AgentPaths], dict[str, str]], ...] = (
    check_vpn,
    check_dns,
    check_tls,
    check_systemd_user,
    check_podman_socket,
    check_runner_manager,
    check_runner_config,
    check_gitlab_connectivity,
)


def collect_observation(
    config: AgentConfig,
    paths: AgentPaths,
    now: dt.datetime,
    checks: tuple[Callable[[AgentConfig, AgentPaths], dict[str, str]], ...] = CHECKS,
) -> dict[str, object]:
    if now.tzinfo is None:
        raise AgentError("Observation clock must include a timezone")
    return {
        "contractVersion": CONTRACT_VERSION,
        "deliveryId": str(uuid.uuid4()),
        "hostId": config.host_id,
        "observedAt": now.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "agentVersion": AGENT_VERSION,
        "stacks": [{
            "id": config.stack.id,
            "stackName": config.stack.stack_name,
            "workload": config.stack.workload,
            "runnerVersion": None,
            "tags": list(config.stack.tags),
            "jobsRunning": None,
            "checks": [check(config, paths) for check in checks],
            "drift": None,
        }],
    }


def _secure_state_directory(path: Path) -> None:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    metadata = path.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise AgentError("Agent state directory permissions are unsafe")


def write_pending(path: Path, observation: dict[str, object]) -> None:
    encoded = json.dumps(observation, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    if len(encoded) > MAX_OBSERVATION_BYTES:
        raise AgentError("Observation exceeds 64 KiB")
    _secure_state_directory(path.parent)
    temporary = path.parent / f".pending-{uuid.uuid4()}.tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def load_pending(path: Path) -> dict[str, object] | None:
    if not path.exists():
        return None
    metadata = _validate_file(path, secret=True)
    if metadata.st_size > MAX_OBSERVATION_BYTES:
        raise AgentError("Pending observation exceeds 64 KiB")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise AgentError("Pending observation is unreadable") from error
    if not isinstance(value, dict) or value.get("contractVersion") != CONTRACT_VERSION or not isinstance(value.get("deliveryId"), str):
        raise AgentError("Pending observation is invalid")
    return value


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):  # noqa: ANN001
        return None


def send_observation(config: AgentConfig, secret: str, observation: dict[str, object]) -> str:
    data = json.dumps(observation, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    request = urllib.request.Request(
        f"{config.control_plane_url}/api/v1/observations",
        data=data,
        headers={
            "Authorization": f"Bearer {config.credential_id}.{secret}",
            "Content-Type": "application/json",
            "User-Agent": f"gitlab-runner-platform-agent/{AGENT_VERSION}",
        },
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()), _NoRedirect())
    try:
        with opener.open(request, timeout=config.request_timeout_seconds) as response:
            if response.status == 202:
                return "accepted"
            if response.status == 200:
                return "duplicate"
    except (urllib.error.URLError, TimeoutError, OSError):
        pass
    raise AgentError("Observation delivery failed")


def run_once(
    paths: AgentPaths,
    *,
    now: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.timezone.utc),
    sender: Callable[[AgentConfig, str, dict[str, object]], str] = send_observation,
    collector: Callable[[AgentConfig, AgentPaths, dt.datetime], dict[str, object]] = collect_observation,
) -> str:
    config = load_config(paths.config_file)
    secret = load_credential(paths.credential_file)
    pending = load_pending(paths.pending_file)
    if pending is None:
        pending = collector(config, paths, now())
        write_pending(paths.pending_file, pending)
    result = sender(config, secret, pending)
    paths.pending_file.unlink()
    return result


def main() -> int:
    try:
        status = run_once(AgentPaths(Path.home()))
    except AgentError as error:
        sys.stderr.write(f"Host Agent failed: {error}\n")
        return 1
    sys.stdout.write(f"Observation {status}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
