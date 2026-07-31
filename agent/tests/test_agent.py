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
    parse_config,
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

    def test_retries_the_same_pending_delivery_before_collecting_again(self):
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
                    sender=first_sender,
                    collector=collector,
                )
            pending_id = json.loads(paths.pending_file.read_text(encoding="utf-8"))["deliveryId"]
            self.assertEqual(stat.S_IMODE(paths.pending_file.stat().st_mode), 0o600)

            delivered = []
            result = run_once(
                paths,
                sender=lambda _config, _secret, observation: delivered.append(observation["deliveryId"]) or "accepted",
                collector=collector,
            )
            self.assertEqual(result, "accepted")
            self.assertEqual(delivered, [pending_id])
            self.assertEqual(collector.call_count, 1)
            self.assertFalse(paths.pending_file.exists())


if __name__ == "__main__":
    unittest.main()
