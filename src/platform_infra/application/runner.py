"""Runner registration use case."""

from __future__ import annotations

from typing import Protocol

from platform_infra.application.ports import TokenReader
from platform_infra.domain.models import StackConfiguration


class RunnerRegistrar(Protocol):
    """Register a Runner through an automation backend."""

    def register(
        self,
        configuration: StackConfiguration,
        inventory: str,
        token: str,
        *,
        ask_become_password: bool,
    ) -> None:
        """Register and reconcile one Runner stack."""
        ...


class RegisterRunner:
    """Read a token at the boundary and delegate safe registration."""

    def __init__(
        self,
        token_reader: TokenReader,
        registrar: RunnerRegistrar,
    ) -> None:
        self._token_reader = token_reader
        self._registrar = registrar

    def execute(
        self,
        configuration: StackConfiguration,
        inventory: str,
        *,
        ask_become_password: bool,
    ) -> None:
        """Register one Runner without storing the token in project files."""

        token = self._token_reader.read()
        self._registrar.register(
            configuration,
            inventory,
            token,
            ask_become_password=ask_become_password,
        )
