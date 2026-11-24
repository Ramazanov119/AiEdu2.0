import pytest
from app.services.llm import check_availability

@pytest.mark.asyncio
async def test_llm_status_reports_missing_config(monkeypatch):
    monkeypatch.setenv('LLM_PROVIDER','')
    monkeypatch.setenv('LLM_BASE_URL','')
    monkeypatch.setenv('LLM_MODEL','')
    from app.core.config import get_settings
    get_settings.cache_clear()
    result=await check_availability()
    assert result['available'] is False
    assert 'не настроена' in result['error']
    get_settings.cache_clear()
