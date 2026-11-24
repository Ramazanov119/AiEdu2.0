import pytest
from app.core.config import get_settings
import app.services.llm as llm_service


class FakeResponse:
    status_code = 200
    text = ""

    def json(self):
        return {"message": {"content": "Тестовый ответ Ollama"}}


class FakeClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers, json):
        assert url == "http://127.0.0.1:11434/api/chat"
        assert json["stream"] is False
        return FakeResponse()


@pytest.mark.asyncio
async def test_native_ollama_request(monkeypatch, generation_session):
    get_settings.cache_clear()
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:11434")
    monkeypatch.setenv("LLM_MODEL", "qwen2.5:7b")
    monkeypatch.setattr(llm_service.httpx, "AsyncClient", FakeClient)
    result = await llm_service.generate("Создай вопрос", user_id="teacher-ollama")
    assert result == "Тестовый ответ Ollama"
    get_settings.cache_clear()
