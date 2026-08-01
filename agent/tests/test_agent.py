import datetime as dt
import json
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest import mock
import uuid

from agent.gitlab_runner_agent import (
    AgentConfig,
    AgentError,
    AgentPaths,
    StackConfig,
    collect_observation,
    check_runner_config,
    check_systemd_user,
    load_credential,
    parse_gitlab_health_url,
    parse_config,
    request_observation_refresh,
    run_once,
)


VALID_CONFIG = {
    "allowPlaintextLoopback": False,
    "contractVersion": "1.0",
    "controlPlaneUrl": "https://runner-platform.example.invalid",
    "credentialId": "hac_abcdefghijklmnop",
    "hostId": "host-01",
    "requestTimeoutSeconds": 10,
    "stack": {
        "gitlabHealthPath": "/-/health",
        "gitlabHostname": "gitlab.example.invalid",
        "id": "frontend-main",
        "runnerService": "gitlab-runner-frontend.service",
        "stackName": "gitlab-runners/frontend",
        "tags": ["frontend", "podman"],
        "vpnInterface": "tailscale0",
        "workload": "frontend",
    },
}
SECRET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"


def parsed_config() -> AgentConfig:
    return parse_config(VALID_CONFIG)


def safe_checks():
    keys = (
        "vpn",
        "dns",
        "tls",
        "systemd-user",
        "podman-socket",
        "runner-manager",
        "runner-config",
        "gitlab-connectivity",
    )
    return tuple(
        (lambda key: lambda _config, _paths: {"key": key, "state": "healthy", "summary": f"{key} check passed"})(key)
        for key in keys
    )


class AgentConfigurationTests(unittest.TestCase):
    def test_systemd_unit_uses_the_runner_users_isolated_virtual_environment(self):
        service = (
            Path(__file__).parents[1]
            / "systemd/gitlab-runner-platform-agent.service"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "ExecStart=%h/.local/share/gitlab-runner-platform/venv/bin/python -I ",
            service,
        )
        self.assertNotIn("ExecStart=/usr/bin/python ", service)

    def test_timer_polls_quickly_without_controlling_collection_frequency(self):
        timer = (
            Path(__file__).parents[1]
            / "systemd/gitlab-runner-platform-agent.timer"
        ).read_text(encoding="utf-8")
        self.assertIn("OnBootSec=2s", timer)
        self.assertIn("OnUnitActiveSec=5s", timer)

    def test_parses_the_configured_gitlab_health_path(self):
        self.assertEqual(
            parse_gitlab_health_url("https://gitlab.example.invalid/users/sign_in"),
            ("gitlab.example.invalid", "/users/sign_in"),
        )

    def test_accepts_strict_https_configuration(self):
        config = parsed_config()
        self.assertEqual(config.stack.stack_name, "gitlab-runners/frontend")
        self.assertEqual(config.control_plane_url, "https://runner-platform.example.invalid")

    def test_accepts_explicit_plaintext_only_for_literal_loopback(self):
        for origin in ("http://127.0.0.1:3000", "http://[::1]:3000"):
            config = parse_config({
                **VALID_CONFIG,
                "allowPlaintextLoopback": True,
                "controlPlaneUrl": origin,
            })
            self.assertEqual(config.control_plane_url, origin)

    def test_rejects_plaintext_without_opt_in_or_outside_loopback(self):
        for origin in (
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "http://100.64.0.15:3000",
            "http://192.168.18.226:3000",
        ):
            with self.assertRaisesRegex(AgentError, "loopback HTTP origin"):
                parse_config({**VALID_CONFIG, "controlPlaneUrl": origin})
        with self.assertRaisesRegex(AgentError, "loopback HTTP origin"):
            parse_config({
                **VALID_CONFIG,
                "allowPlaintextLoopback": True,
                "controlPlaneUrl": "http://100.64.0.15:3000",
            })

    def test_rejects_invalid_plaintext_policy_and_unknown_fields(self):
        with self.assertRaisesRegex(AgentError, "plaintext loopback policy"):
            parse_config({**VALID_CONFIG, "allowPlaintextLoopback": "true"})
        with self.assertRaisesRegex(AgentError, "configuration fields"):
            parse_config({**VALID_CONFIG, "credential": SECRET})

    def test_requires_credential_mode_0600(self):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / "credential"
            credential.write_text(SECRET, encoding="utf-8")
            credential.chmod(0o644)
            with self.assertRaisesRegex(AgentError, "permissions"):
                load_credential(credential)
            credential.chmod(0o600)
            self.assertEqual(load_credential(credential), SECRET)

    def test_rejects_a_credential_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.write_text(SECRET, encoding="utf-8")
            target.chmod(0o600)
            credential = root / "credential"
            credential.symlink_to(target)
            with self.assertRaisesRegex(AgentError, "ownership or type"):
                load_credential(credential)


class ObservationTests(unittest.TestCase):
    def test_runner_config_check_reads_metadata_only(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            runner_config = home / "gitlab-runner/config/config.toml"
            runner_config.parent.mkdir(parents=True)
            runner_config.write_text("this content must not be parsed", encoding="utf-8")
            runner_config.chmod(0o600)
            with mock.patch.object(Path, "read_text", side_effect=AssertionError("content was read")):
                result = check_runner_config(parsed_config(), AgentPaths(home))
            self.assertEqual(result["state"], "healthy")

    def test_systemd_check_uses_fixed_argv_and_runner_home(self):
        completed = subprocess.CompletedProcess([], 0, stdout="running\n", stderr="")
        with mock.patch("agent.gitlab_runner_agent.subprocess.run", return_value=completed) as run:
            result = check_systemd_user(parsed_config(), AgentPaths(Path("/home/runner")))
        self.assertEqual(result["state"], "healthy")
        self.assertEqual(run.call_args.args[0], ["/usr/bin/systemctl", "--user", "is-system-running"])
        self.assertEqual(run.call_args.kwargs["cwd"], Path("/home/runner"))

    def test_collects_only_structured_host_facts(self):
        with mock.patch(
            "agent.gitlab_runner_agent.uuid.uuid4",
            return_value=uuid.UUID("b08629f8-dfa8-4d2f-a720-3f593b195033"),
        ):
            observation = collect_observation(
                parsed_config(),
                AgentPaths(Path("/home/runner")),
                dt.datetime(2026, 7, 31, 9, 0, tzinfo=dt.timezone.utc),
                safe_checks(),
            )
        stack = observation["stacks"][0]
        self.assertEqual(observation["contractVersion"], "1.0")
        self.assertIsNone(stack["runnerVersion"])
        self.assertIsNone(stack["jobsRunning"])
        self.assertIsNone(stack["drift"])
        self.assertNotIn("gitlabState", stack)
        self.assertNotIn("credential", json.dumps(observation).lower())
        fixture_path = Path(__file__).parents[2] / "packages/contracts/fixtures/host-agent-observation-v1.json"
        self.assertEqual(observation, json.loads(fixture_path.read_text(encoding="utf-8")))

    def test_waits_without_collecting_when_the_server_reports_current(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            config_directory = home / ".config/gitlab-runner-platform"
            config_directory.mkdir(parents=True)
            config_file = config_directory / "agent.json"
            config_file.write_text(json.dumps(VALID_CONFIG), encoding="utf-8")
            config_file.chmod(0o600)
            credential_file = config_directory / "credential"
            credential_file.write_text(SECRET, encoding="utf-8")
            credential_file.chmod(0o600)
            collector = mock.Mock()
            sender = mock.Mock()

            result = run_once(
                AgentPaths(home),
                refresher=lambda _config, _secret: (False, "current"),
                sender=sender,
                collector=collector,
            )

            self.assertEqual(result, "current")
            collector.assert_not_called()
            sender.assert_not_called()

    def test_retries_the_same_pending_delivery_before_polling_again(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            config_directory = home / ".config/gitlab-runner-platform"
            config_directory.mkdir(parents=True)
            config_file = config_directory / "agent.json"
            config_file.write_text(json.dumps(VALID_CONFIG), encoding="utf-8")
            config_file.chmod(0o600)
            credential_file = config_directory / "credential"
            credential_file.write_text(SECRET, encoding="utf-8")
            credential_file.chmod(0o600)
            paths = AgentPaths(home)
            collector = mock.Mock(side_effect=lambda config, agent_paths, now: collect_observation(config, agent_paths, now, safe_checks()))
            first_sender = mock.Mock(side_effect=AgentError("Observation delivery failed"))

            with self.assertRaisesRegex(AgentError, "delivery failed"):
                run_once(
                    paths,
                    now=lambda: dt.datetime(2026, 7, 31, 9, 0, tzinfo=dt.timezone.utc),
                    refresher=lambda _config, _secret: (True, "missing"),
                    sender=first_sender,
                    collector=collector,
                )
            pending_id = json.loads(paths.pending_file.read_text(encoding="utf-8"))["deliveryId"]
            self.assertEqual(stat.S_IMODE(paths.pending_file.stat().st_mode), 0o600)

            delivered = []
            result = run_once(
                paths,
                refresher=lambda _config, _secret: (False, "current"),
                sender=lambda _config, _secret, observation: delivered.append(observation["deliveryId"]) or "accepted",
                collector=collector,
            )
            self.assertEqual(result, "current")
            self.assertEqual(delivered[0], pending_id)
            self.assertEqual(len(delivered), 1)
            self.assertEqual(collector.call_count, 1)
            self.assertFalse(paths.pending_file.exists())

    def test_discards_a_pending_delivery_for_a_previous_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            config_directory = home / ".config/gitlab-runner-platform"
            config_directory.mkdir(parents=True)
            config_file = config_directory / "agent.json"
            config_file.write_text(json.dumps(VALID_CONFIG), encoding="utf-8")
            config_file.chmod(0o600)
            credential_file = config_directory / "credential"
            credential_file.write_text(SECRET, encoding="utf-8")
            credential_file.chmod(0o600)
            paths = AgentPaths(home)
            previous_config = parse_config({
                **VALID_CONFIG,
                "hostId": "previous-host",
                "stack": {**VALID_CONFIG["stack"], "id": "previous-stack"},
            })
            previous_observation = collect_observation(
                previous_config,
                paths,
                dt.datetime(2026, 7, 31, 9, 0, tzinfo=dt.timezone.utc),
                safe_checks(),
            )
            paths.state_directory.mkdir(mode=0o700, parents=True)
            paths.pending_file.write_text(json.dumps(previous_observation), encoding="utf-8")
            paths.pending_file.chmod(0o600)
            delivered = []

            def accept_current_identity(config, _secret, observation):
                if (
                    observation["hostId"] != config.host_id
                    or observation["stacks"][0]["id"] != config.stack.id
                ):
                    raise AgentError("Observation delivery failed")
                delivered.append(observation)
                return "accepted"

            result = run_once(
                paths,
                now=lambda: dt.datetime(2026, 7, 31, 10, 0, tzinfo=dt.timezone.utc),
                refresher=lambda _config, _secret: (True, "missing"),
                sender=accept_current_identity,
                collector=lambda config, agent_paths, now: collect_observation(
                    config,
                    agent_paths,
                    now,
                    safe_checks(),
                ),
            )

            self.assertEqual(result, "accepted")
            self.assertEqual(len(delivered), 1)
            self.assertEqual(delivered[0]["hostId"], VALID_CONFIG["hostId"])
            self.assertEqual(delivered[0]["stacks"][0]["id"], VALID_CONFIG["stack"]["id"])
            self.assertFalse(paths.pending_file.exists())

    def test_collects_fresh_health_when_the_server_requests_startup_refresh(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            config_directory = home / ".config/gitlab-runner-platform"
            config_directory.mkdir(parents=True)
            config_file = config_directory / "agent.json"
            config_file.write_text(json.dumps(VALID_CONFIG), encoding="utf-8")
            config_file.chmod(0o600)
            credential_file = config_directory / "credential"
            credential_file.write_text(SECRET, encoding="utf-8")
            credential_file.chmod(0o600)
            paths = AgentPaths(home)
            old_observation = collect_observation(
                parsed_config(),
                paths,
                dt.datetime(2026, 7, 31, 9, 0, tzinfo=dt.timezone.utc),
                safe_checks(),
            )
            paths.state_directory.mkdir(mode=0o700, parents=True)
            paths.pending_file.write_text(json.dumps(old_observation), encoding="utf-8")
            paths.pending_file.chmod(0o600)
            delivered = []

            result = run_once(
                paths,
                now=lambda: dt.datetime(2026, 7, 31, 10, 0, tzinfo=dt.timezone.utc),
                refresher=lambda _config, _secret: (True, "startup"),
                sender=lambda _config, _secret, observation: delivered.append(observation) or "accepted",
                collector=lambda config, agent_paths, now: collect_observation(config, agent_paths, now, safe_checks()),
            )

            self.assertEqual(result, "accepted")
            self.assertEqual(len(delivered), 2)
            self.assertEqual(delivered[0]["deliveryId"], old_observation["deliveryId"])
            self.assertEqual(delivered[1]["observedAt"], "2026-07-31T10:00:00.000Z")
            self.assertNotEqual(delivered[1]["deliveryId"], old_observation["deliveryId"])
            self.assertFalse(paths.pending_file.exists())

    def test_refresh_request_rejects_an_unbounded_or_inconsistent_response(self):
        class Response:
            status = 200
            headers = {"Content-Type": "application/json"}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _maximum):
                return json.dumps({
                    "contractVersion": "1.0",
                    "reason": "current",
                    "refresh": True,
                }).encode("utf-8")

        opener = mock.Mock()
        opener.open.return_value = Response()
        with mock.patch("agent.gitlab_runner_agent.urllib.request.build_opener", return_value=opener):
            with self.assertRaisesRegex(AgentError, "invalid"):
                request_observation_refresh(parsed_config(), SECRET)

    def test_refresh_request_accepts_a_strict_current_response(self):
        class Response:
            status = 200
            headers = {"Content-Type": "application/json; charset=utf-8"}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _maximum):
                return json.dumps({
                    "contractVersion": "1.0",
                    "reason": "current",
                    "refresh": False,
                }).encode("utf-8")

        opener = mock.Mock()
        opener.open.return_value = Response()
        with mock.patch("agent.gitlab_runner_agent.urllib.request.build_opener", return_value=opener):
            self.assertEqual(request_observation_refresh(parsed_config(), SECRET), (False, "current"))


if __name__ == "__main__":
    unittest.main()
