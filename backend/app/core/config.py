from functools import lru_cache
from urllib.parse import urlsplit, parse_qs
from app.core.timezones import load_zone
import os
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "production"
    database_url: str = "sqlite:///./ai_edu.db"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    local_dev_user_id: str = ""
    initial_admin_email: str = ""
    analytics_timezone: str = "Asia/Almaty"
    llm_provider: str = ""
    llm_base_url: str = ""
    llm_model: str = ""
    llm_api_key: str = ""
    gemini_api_key: str = ""
    redis_url: str = ""
    frontend_url: str = ""
    generated_dir: str = "./generated"
    max_task_steps: int = 12
    task_timeout_seconds: int = 300
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def allowed_cors_origins(self) -> list[str]:
        origins = [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]
        if self.frontend_url.strip():
            origins.append(self.frontend_url.strip().rstrip("/"))
        if self.environment == "production":
            origins = [
                origin for origin in origins
                if origin != "*" and urlsplit(origin).hostname not in ("localhost", "127.0.0.1", "::1")
            ]
        return list(dict.fromkeys(origins))

    @model_validator(mode="after")
    def validate_runtime(self):
        self.environment = self.environment.strip().lower()
        if self.environment == "production":
            self.local_dev_user_id = ""
        if self.gemini_api_key and (not self.llm_provider or self.llm_provider == "gemini"):
            self.llm_provider = "gemini"
            self.llm_base_url = self.llm_base_url or "https://generativelanguage.googleapis.com/v1beta/openai"
            self.llm_model = self.llm_model or "gemini-2.5-flash"
            self.llm_api_key = self.llm_api_key or self.gemini_api_key
        load_zone(self.analytics_timezone)
        if self.environment == "local" and self.database_url.startswith(
            ("postgresql:", "postgresql+", "postgres:")
        ):
            url = urlsplit(self.database_url)
            hosts = [url.hostname] if url.hostname else []
            query = parse_qs(url.query)
            hosts += query.get("host", []) + query.get("hostaddr", [])
            if query.get("service") or os.environ.get("PGSERVICE"):
                raise ValueError(
                    "ENVIRONMENT=local не допускает libpq service-профили с неявными адресами."
                )
            if not url.hostname and not query.get("host") and os.environ.get("PGHOST"):
                hosts.append(os.environ["PGHOST"])
            if not query.get("hostaddr") and os.environ.get("PGHOSTADDR"):
                hosts.append(os.environ["PGHOSTADDR"])
            for host in hosts:
                for candidate in host.split(","):
                    if candidate not in (
                        "localhost",
                        "127.0.0.1",
                        "::1",
                    ) and not candidate.startswith("/"):
                        raise ValueError(
                            "ENVIRONMENT=local запрещён с внешней PostgreSQL. Используйте отдельную локальную БД или явно задайте staging/production без LOCAL_DEV_USER_ID."
                        )

        return self

    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", hide_input_in_errors=True
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
