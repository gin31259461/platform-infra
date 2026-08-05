"""Secret input adapters."""

from __future__ import annotations

from collections.abc import Callable, Mapping

from platform_infra.domain.errors import RegistrationError


class EnvironmentOrPromptTokenReader:
    """Read the token from an injected environment or hidden prompt."""

    def __init__(
        self,
        environment: Mapping[str, str],
        prompt: Callable[[str], str],
    ) -> None:
        self._environment = environment
        self._prompt = prompt

    def read(self) -> str:
        token = self._environment.get("GITLAB_RUNNER_TOKEN")
        if token is None:
            token = self._prompt("GitLab Runner token: ")
        normalized = token.strip()
        if not normalized.startswith(("glrt-", "glrtr-")):
            raise RegistrationError(
                "GITLAB_RUNNER_TOKEN must be a runner authentication token "
                "beginning with glrt- or glrtr-"
            )
        return normalized
