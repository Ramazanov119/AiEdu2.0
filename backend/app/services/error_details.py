"""Useful upload diagnostics without credentials, SQL or bound parameters."""
import re
from urllib.parse import urlsplit, unquote

from app.core.config import get_settings


def error_reason(error: Exception) -> str:
    diag = getattr(error, "diag", None)
    reason = getattr(diag, "message_primary", None) or str(error) or type(error).__name__
    settings = get_settings()
    secrets = [settings.supabase_service_role_key, settings.supabase_anon_key,
               settings.supabase_jwt_secret, settings.gemini_api_key, settings.llm_api_key]
    try:
        password = urlsplit(settings.database_url).password
        if password:
            secrets.extend([password, unquote(password)])
    except ValueError:
        pass
    for secret in sorted(filter(None, secrets), key=len, reverse=True):
        reason = reason.replace(secret, "[скрыто]")
    reason = re.sub(r"(?i)Bearer\s+\S+", "Bearer [скрыто]", reason)
    return reason[:1000]
