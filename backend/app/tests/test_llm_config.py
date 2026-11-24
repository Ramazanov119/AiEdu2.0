import pytest
from app.services.llm import generate, LLMConfigurationError

@pytest.mark.asyncio
async def test_missing_llm_configuration(monkeypatch):
    monkeypatch.setenv('LLM_PROVIDER','')
    monkeypatch.setenv('LLM_BASE_URL','')
    monkeypatch.setenv('LLM_MODEL','')
    from app.core.config import get_settings
    get_settings.cache_clear()
    with pytest.raises(LLMConfigurationError):
        await generate('тест')
