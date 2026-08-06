"""Ansible orchestration use cases."""

from __future__ import annotations

import json
import re
from pathlib import Path

from platform_infra.application.ansible_variables import serialize_configuration
from platform_infra.application.ports import ProcessExecutor
from platform_infra.domain.errors import CommandExecutionError
from platform_infra.domain.models import Command, CommandResult, StackConfiguration

_CHANGED_PATTERN = re.compile(r"changed=(?P<count>[0-9]+)")
_RUNNER_TOKEN_ENVIRONMENT = "PLATFORM_INFRA_RUNNER_TOKEN"


class AnsibleAutomation:
    """Run project playbooks through an injected process executor."""

    def __init__(self, project_root: Path, executor: ProcessExecutor) -> None:
        self._project_root = project_root
        self._executor = executor

    def install_collections(self) -> None:
        """Install pinned collections into the repository-local path."""

        self._executor.execute(
            Command(
                arguments=(
                    "ansible-galaxy",
                    "collection",
                    "install",
                    "--force-with-deps",
                    "--collections-path",
                    ".ansible/collections",
                    "--requirements-file",
                    "requirements.yml",
                ),
                working_directory=self._project_root,
            )
        )

    def syntax_check(self, configuration: StackConfiguration) -> None:
        """Validate the main playbook with normalized stack variables."""

        self._run_playbook(
            playbook="playbooks/gitlab-runner.yml",
            inventory="inventory/localhost.yml",
            configuration=configuration,
            extra_arguments=("--syntax-check",),
            ask_become_password=False,
            capture_output=True,
        )

    def check(
        self,
        configuration: StackConfiguration,
        inventory: str,
        *,
        ask_become_password: bool,
    ) -> None:
        """Run read-only prerequisite and network checks."""

        self._run_playbook(
            playbook="playbooks/gitlab-runner-check.yml",
            inventory=inventory,
            configuration=configuration,
            extra_arguments=(),
            ask_become_password=ask_become_password,
            capture_output=False,
        )

    def install(
        self,
        configuration: StackConfiguration,
        inventory: str,
        *,
        ask_become_password: bool,
        capture_output: bool = False,
    ) -> CommandResult:
        """Converge one or more Runner hosts."""

        return self._run_playbook(
            playbook="playbooks/gitlab-runner.yml",
            inventory=inventory,
            configuration=configuration,
            extra_arguments=(),
            ask_become_password=ask_become_password,
            capture_output=capture_output,
        )

    def register(
        self,
        configuration: StackConfiguration,
        inventory: str,
        token: str,
        *,
        ask_become_password: bool,
    ) -> None:
        """Register a Runner without exposing its token in process arguments."""

        self._run_playbook(
            playbook="playbooks/gitlab-runner-register.yml",
            inventory=inventory,
            configuration=configuration,
            extra_arguments=(),
            ask_become_password=ask_become_password,
            capture_output=False,
            environment=((_RUNNER_TOKEN_ENVIRONMENT, token),),
        )

    def verify(
        self,
        configuration: StackConfiguration,
        inventory: str,
        *,
        ask_become_password: bool,
    ) -> None:
        """Run host, Podman, manager, and registration verification tasks."""

        self._run_playbook(
            playbook="playbooks/gitlab-runner-verify.yml",
            inventory=inventory,
            configuration=configuration,
            extra_arguments=(),
            ask_become_password=ask_become_password,
            capture_output=False,
        )

    def status(
        self,
        configuration: StackConfiguration,
        inventory: str,
        *,
        ask_become_password: bool,
    ) -> None:
        """Display manager and registration state for managed hosts."""

        self._run_playbook(
            playbook="playbooks/gitlab-runner-status.yml",
            inventory=inventory,
            configuration=configuration,
            extra_arguments=(),
            ask_become_password=ask_become_password,
            capture_output=False,
        )

    def uninstall(
        self,
        configuration: StackConfiguration,
        inventory: str,
        *,
        ask_become_password: bool,
        purge: bool,
    ) -> None:
        """Remove the Runner service and optionally its host account."""

        self._run_playbook(
            playbook="playbooks/gitlab-runner-uninstall.yml",
            inventory=inventory,
            configuration=configuration,
            extra_arguments=(
                "--extra-vars",
                json.dumps({"runner_purge": purge}),
            ),
            ask_become_password=ask_become_password,
            capture_output=False,
        )

    def assert_idempotent(
        self,
        configuration: StackConfiguration,
        inventory: str,
        *,
        ask_become_password: bool,
    ) -> None:
        """Converge once, then require a zero-change second pass."""

        self.install(
            configuration,
            inventory,
            ask_become_password=ask_become_password,
        )
        result = self.install(
            configuration,
            inventory,
            ask_become_password=ask_become_password,
            capture_output=True,
        )
        changed_counts = tuple(
            int(match.group("count"))
            for match in _CHANGED_PATTERN.finditer(result.standard_output)
        )
        if not changed_counts:
            raise CommandExecutionError(
                "Unable to find Ansible changed counts in the second convergence output"
            )
        if any(count != 0 for count in changed_counts):
            raise CommandExecutionError(
                "The second convergence changed host state; idempotency failed"
            )

    def _run_playbook(
        self,
        *,
        playbook: str,
        inventory: str,
        configuration: StackConfiguration,
        extra_arguments: tuple[str, ...],
        ask_become_password: bool,
        capture_output: bool,
        environment: tuple[tuple[str, str], ...] = (),
    ) -> CommandResult:
        variable_payload = serialize_configuration(configuration)
        arguments = [
            "ansible-playbook",
            "--inventory",
            inventory,
            playbook,
            "--extra-vars",
            json.dumps(variable_payload, separators=(",", ":")),
        ]
        if ask_become_password:
            arguments.append("--ask-become-pass")
        arguments.extend(extra_arguments)
        return self._executor.execute(
            Command(
                arguments=tuple(arguments),
                working_directory=self._project_root,
                environment=environment,
                capture_output=capture_output,
            )
        )
