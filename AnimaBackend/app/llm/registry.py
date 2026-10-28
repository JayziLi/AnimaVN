from sqlalchemy import select
from sqlalchemy.orm import Session

from app.llm.anthropic_provider import AnthropicProvider
from app.llm.base import LLMProvider
from app.llm.errors import LLMError
from app.llm.mock_provider import MockProvider
from app.llm.openai_provider import OpenAICompatibleProvider
from app.models import ApiConnection

API_TYPES = ("openai_compatible", "anthropic", "mock")


def provider_for(conn: ApiConnection) -> LLMProvider:
    """Instantiate the right adapter for a stored connection profile."""
    if conn.api_type == "mock":
        return MockProvider()
    if conn.api_type == "anthropic":
        if not conn.api_key:
            raise LLMError(f"Connection '{conn.name}' has no API key")
        return AnthropicProvider(conn.api_key, conn.base_url, conn.thinking)
    if conn.api_type == "openai_compatible":
        return OpenAICompatibleProvider(conn.api_key, conn.base_url, conn.thinking)
    raise LLMError(f"Unknown API type: {conn.api_type}")


def active_connection(db: Session) -> ApiConnection | None:
    return db.scalar(select(ApiConnection).where(ApiConnection.is_active))
