"""Domain-specific exceptions."""


class PlatformInfraError(Exception):
    """Base exception for expected platform-infra failures."""


class ConfigurationError(PlatformInfraError):
    """Raised when stack configuration is invalid."""


class CommandExecutionError(PlatformInfraError):
    """Raised when an external command fails."""


class RegistrationError(PlatformInfraError):
    """Raised when runner registration cannot be completed safely."""
