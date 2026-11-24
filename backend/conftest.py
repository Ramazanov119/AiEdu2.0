"""Test collection must never load production credentials or connect to a working DB."""

import os

for key, value in {
    "ENVIRONMENT": "local",
    "DATABASE_URL": "sqlite://",
    "LOCAL_DEV_USER_ID": "",
    "SUPABASE_URL": "",
    "SUPABASE_ANON_KEY": "",
    "SUPABASE_SERVICE_ROLE_KEY": "",
    "SUPABASE_JWT_SECRET": "",
    "INITIAL_ADMIN_EMAIL": "",
    "LLM_PROVIDER": "",
    "LLM_BASE_URL": "",
    "LLM_MODEL": "",
    "LLM_API_KEY": "",
    "GEMINI_API_KEY": "",
    "FRONTEND_URL": "",
    "REDIS_URL": "",
}.items():
    os.environ[key] = value

import pytest


@pytest.fixture(autouse=True)
def settings_cache():
    from app.core.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def generation_session(monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.models import Base, Profile
    import app.services.generation_tracking as tracking

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        db.add(Profile(id="teacher-ollama"))
        db.commit()
    monkeypatch.setattr(tracking, "SessionLocal", factory)
    yield factory
    engine.dispose()
