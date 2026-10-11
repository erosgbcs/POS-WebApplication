"""Typed errors for the POS chatbot backend."""


class ChatError(Exception):
    """Base error for the chat pipeline."""
    status = 500

    def __init__(self, message, status=None):
        super().__init__(message)
        if status is not None:
            self.status = status


class ValidationError(ChatError):
    status = 400


class AuthError(ChatError):
    status = 401


class ForbiddenError(ChatError):
    status = 403


class NotFoundError(ChatError):
    status = 404


class ProviderError(ChatError):
    """Error raised by an external AI provider."""

    def __init__(self, message, retryable=False, status=502):
        super().__init__(message, status=status)
        self.retryable = retryable


class ConfigError(ChatError):
    status = 500


class DBError(ChatError):
    status = 503