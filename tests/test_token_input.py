"""Secret input adapter behavior."""

from __future__ import annotations

import pytest

from platform_infra.adapters.token_input import EnvironmentOrPromptTokenReader
from platform_infra.domain.errors import RegistrationError


def test_read_token_from_injected_environment_without_prompt() -> None:
    def unexpected_prompt(message: str) -> str:
        raise AssertionError(message)

    reader = EnvironmentOrPromptTokenReader(
        {"GITLAB_RUNNER_TOKEN": "glrt-environment-token"},
        unexpected_prompt,
    )

    assert reader.read() == "glrt-environment-token"


def test_reject_invalid_token_from_prompt() -> None:
    reader = EnvironmentOrPromptTokenReader({}, lambda _: "legacy-token")

    with pytest.raises(RegistrationError, match="authentication token"):
        reader.read()
