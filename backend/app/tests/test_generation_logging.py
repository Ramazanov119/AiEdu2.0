import pytest
import httpx
from app.models import Profile, Organization, GenerationLog, GenerationReservation
from app.core.config import get_settings
from app.services.llm import generate, LLMProviderError
from uuid import uuid4


def config(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.invalid/v1")
    monkeypatch.setenv("LLM_MODEL", "test-model")
    get_settings.cache_clear()


class Client:
    payload = {
        "choices": [{"message": {"content": "Synthetic response"}}],
        "usage": {"total_tokens": 17},
    }
    status = 200

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, *a, **kw):
        return httpx.Response(self.status, json=self.payload)


@pytest.mark.asyncio
async def test_real_call_metadata_tokens_and_org_snapshot(
    monkeypatch, generation_session
):
    config(monkeypatch)
    org = str(uuid4())
    other = str(uuid4())
    with generation_session() as db:
        db.add_all(
            [Organization(id=org, name="META"), Organization(id=other, name="АТКК")]
        )
        db.flush()
        db.get(Profile, "teacher-ollama").organization_id = org
        db.commit()

    class MovingClient(Client):
        async def post(self, *a, **kw):
            with generation_session() as db:
                db.get(Profile, "teacher-ollama").organization_id = other
                db.commit()
            return await super().post(*a, **kw)

    monkeypatch.setattr("app.services.llm.httpx.AsyncClient", MovingClient)
    assert (
        await generate(
            "private prompt",
            user_id="teacher-ollama",
            agent_type="creative",
            action_type="presentation",
        )
        == "Synthetic response"
    )
    with generation_session() as db:
        log = db.query(GenerationLog).one()
        assert (
            log.organization_id,
            log.tokens_used,
            log.tokens_reported,
            log.status,
            log.agent_type,
        ) == (org, 17, True, "success", "creative")
        assert log.duration_ms >= 0 and db.query(GenerationReservation).count() == 0
        assert "private prompt" not in str(log.error_message)


@pytest.mark.asyncio
async def test_provider_error_is_counted_without_leaking_body(
    monkeypatch, generation_session
):
    config(monkeypatch)

    class BadClient(Client):
        status = 429
        payload = {"error": "secret-provider-body"}

    monkeypatch.setattr("app.services.llm.httpx.AsyncClient", BadClient)
    with pytest.raises(LLMProviderError):
        await generate("secret prompt", user_id="teacher-ollama")
    with generation_session() as db:
        log = db.query(GenerationLog).one()
        assert log.status == "error" and log.error_message == "LLM_PROVIDER_HTTP_429"
        assert log.tokens_used == 0 and not log.tokens_reported


@pytest.mark.asyncio
async def test_unreported_tokens_and_timeout_are_not_fabricated(
    monkeypatch, generation_session
):
    config(monkeypatch)

    class UnknownClient(Client):
        payload = {"choices": [{"message": {"content": "Unknown tokens"}}]}

    monkeypatch.setattr("app.services.llm.httpx.AsyncClient", UnknownClient)
    await generate("prompt", user_id="teacher-ollama")

    class TimeoutClient(Client):
        async def post(self, *a, **kw):
            raise httpx.ReadTimeout("sensitive-url")

    monkeypatch.setattr("app.services.llm.httpx.AsyncClient", TimeoutClient)
    with pytest.raises(LLMProviderError):
        await generate("prompt", user_id="teacher-ollama")
    with generation_session() as db:
        logs = db.query(GenerationLog).all()
        assert not logs[0].tokens_reported
        assert logs[1].error_message == "LLM_TIMEOUT"


@pytest.mark.asyncio
async def test_no_bypass_when_profile_changes_after_route_preflight(
    monkeypatch, generation_session
):
    from app.services.access import assert_access
    from fastapi import HTTPException

    config(monkeypatch)
    with generation_session() as db:
        assert_access(db, "teacher-ollama")
    with generation_session() as db:
        db.get(Profile, "teacher-ollama").is_active = False
        db.commit()

    class Never(Client):
        async def post(self, *a, **kw):
            raise AssertionError("Provider must never be called")

    monkeypatch.setattr("app.services.llm.httpx.AsyncClient", Never)
    with pytest.raises(HTTPException):
        await generate("prompt", user_id="teacher-ollama")
    with generation_session() as db:
        assert db.query(GenerationLog).count() == 0
