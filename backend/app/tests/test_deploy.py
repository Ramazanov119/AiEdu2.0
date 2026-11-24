from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.core.config import Settings
from app.services.background import dispatch_agent_team


@pytest.mark.parametrize("redis_url,worker,publish_error,queued", [
    ("", True, False, False),
    ("redis://unused", False, False, False),
    ("redis://unused", True, True, False),
    ("redis://unused", True, False, True),
])
@pytest.mark.asyncio
async def test_dispatch(monkeypatch, redis_url, worker, publish_error, queued):
    import app.workers.celery_app as module
    monkeypatch.setattr("app.services.background.get_settings", lambda: SimpleNamespace(redis_url=redis_url))
    inspect = Mock()
    inspect.ping.return_value = {"worker": {"ok": "pong"}} if worker else {}
    monkeypatch.setattr(module.celery_app.control, "inspect", Mock(return_value=inspect))
    publish = Mock(return_value=SimpleNamespace(id="queued-id"))
    if publish_error:
        publish.side_effect = ConnectionError("broker down")
    monkeypatch.setattr(module.agent_team_task, "apply_async", publish)
    run = Mock()
    monkeypatch.setattr(module.agent_team_task, "run", run)
    background = BackgroundTasks()
    result = dispatch_agent_team(background, "task", "owner")
    assert result == ("queued-id" if queued else None)
    run.assert_not_called()
    await background()
    if queued:
        run.assert_not_called()
    else:
        run.assert_called_once_with("task", "owner")
    if not redis_url:
        module.celery_app.control.inspect.assert_not_called()
        publish.assert_not_called()


def test_gemini_configuration():
    settings = Settings(_env_file=None, gemini_api_key="example", llm_provider="", llm_base_url="", llm_model="", llm_api_key="")
    assert settings.llm_provider == "gemini"
    assert settings.llm_api_key == "example"
    assert settings.llm_model == "gemini-2.5-flash"
    assert settings.llm_base_url.endswith("/v1beta/openai")


@pytest.mark.asyncio
async def test_production_disables_dev_auth(monkeypatch):
    from app.core.auth import get_user_id
    settings = Settings(_env_file=None, environment="production", local_dev_user_id="demo")
    assert settings.local_dev_user_id == ""
    monkeypatch.setattr("app.core.auth.get_settings", lambda: settings)
    with pytest.raises(HTTPException) as exc:
        await get_user_id(None)
    assert exc.value.status_code == 401


@pytest.mark.parametrize("origin,allowed", [
    ("https://preview-123.vercel.app", True),
    ("https://preview.vercel.app.attacker.com", False),
    ("http://preview.vercel.app", False),
])
def test_preview_cors(origin, allowed):
    from fastapi.testclient import TestClient
    from app.main import app
    response = TestClient(app).options("/health", headers={
        "Origin": origin, "Access-Control-Request-Method": "GET",
    })
    assert (response.headers.get("access-control-allow-origin") == origin) == allowed


@pytest.mark.asyncio
async def test_broker_unreachable(monkeypatch):
    import app.workers.celery_app as module
    monkeypatch.setattr("app.services.background.get_settings", lambda: SimpleNamespace(redis_url="redis://unused"))
    monkeypatch.setattr(module.celery_app.control, "inspect", Mock(side_effect=ConnectionError("offline")))
    run = Mock()
    monkeypatch.setattr(module.agent_team_task, "run", run)
    background = BackgroundTasks()
    assert dispatch_agent_team(background, "task", "owner") is None
    await background()
    run.assert_called_once_with("task", "owner")


@pytest.mark.asyncio
async def test_production_requires_persistent_storage(monkeypatch, tmp_path):
    from app.services.storage import upload_private, download_private
    settings = SimpleNamespace(environment="production", supabase_url="", supabase_service_role_key="")
    monkeypatch.setattr("app.services.storage.get_settings", lambda: settings)
    path = tmp_path / "private.txt"
    path.write_text("private")
    with pytest.raises(RuntimeError, match="SUPABASE"):
        await upload_private("owner", path, path.name)
    assert await download_private(str(path), tmp_path / "copy.txt") is None


def test_production_cors_custom_frontend():
    settings = Settings(_env_file=None, environment="production", frontend_url="https://edu.example.com/", cors_origins="http://localhost:3000,http://127.0.0.1:3000,https://another.example.com,*")
    assert settings.allowed_cors_origins == ["https://another.example.com", "https://edu.example.com"]
