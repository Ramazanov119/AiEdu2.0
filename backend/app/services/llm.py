import httpx
from app.core.config import get_settings


class LLMConfigurationError(RuntimeError):
    pass


class LLMProviderError(RuntimeError):
    pass


async def check_availability() -> dict:
    s = get_settings()
    if not s.llm_base_url or not s.llm_model or not s.llm_provider:
        return {
            "available": False,
            "provider": s.llm_provider or None,
            "model": s.llm_model or None,
            "error": "LLM не настроена: задайте LLM_PROVIDER, LLM_BASE_URL и LLM_MODEL.",
        }
    provider = s.llm_provider.lower()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            if provider == "ollama":
                base = s.llm_base_url.rstrip("/")
                if base.endswith("/v1"):
                    base = base[:-3].rstrip("/")
                response = await client.get(base + "/api/tags")
                if response.status_code >= 400:
                    return {
                        "available": False,
                        "provider": "ollama",
                        "model": s.llm_model,
                        "error": f"Ollama недоступна: HTTP {response.status_code}",
                    }
                names = {m.get("name") for m in response.json().get("models", [])}
                exact = s.llm_model in names
                prefixed = ":" not in s.llm_model and any(
                    n and n.split(":")[0] == s.llm_model for n in names
                )
                if not exact and not prefixed:
                    return {
                        "available": False,
                        "provider": "ollama",
                        "model": s.llm_model,
                        "error": f"Модель {s.llm_model} не установлена в Ollama",
                        "installed_models": sorted(str(n) for n in names if n),
                    }
                return {
                    "available": True,
                    "provider": "ollama",
                    "model": s.llm_model,
                    "error": None,
                }
            # Readiness must never generate tokens or incur a charge.
            return {
                "available": bool(s.llm_api_key),
                "configured": True,
                "verified": False,
                "provider": provider,
                "model": s.llm_model,
                "error": (
                    None
                    if s.llm_api_key
                    else "Задайте LLM_API_KEY для облачного провайдера."
                ),
            }
    except Exception as exc:
        return {
            "available": False,
            "provider": provider,
            "model": s.llm_model,
            "error": f"Не удалось подключиться к LLM: {exc}",
        }


async def generate(
    prompt: str,
    system: str = "Ты полезный методический ассистент.",
    *,
    user_id: str | None = None,
    agent_type: str = "coordinator",
    action_type: str = "chat",
) -> str:
    from time import perf_counter
    from app.services.generation_tracking import reserve_generation, finish_generation

    s = get_settings()
    if not s.llm_base_url or not s.llm_model or not s.llm_provider:
        raise LLMConfigurationError(
            "LLM не настроена: задайте LLM_PROVIDER, LLM_BASE_URL и LLM_MODEL. Генерация не выполнена."
        )
    if not user_id:
        raise LLMConfigurationError("Для генерации требуется проверенный пользователь.")
    if (
        agent_type not in ("coordinator", "methodist", "creative", "assessment")
        or not action_type
        or len(action_type) > 100
    ):
        raise ValueError("Неверные метаданные генерации")
    provider = s.llm_provider.lower()
    headers = {"Content-Type": "application/json"}
    if s.llm_api_key:
        headers["Authorization"] = "Bearer " + s.llm_api_key
    if provider == "ollama":
        base = s.llm_base_url.rstrip("/")
        if base.endswith("/v1"):
            base = base[:-3].rstrip("/")
        url = base + "/api/chat"
        payload = {
            "model": s.llm_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "options": {"temperature": 0.2},
        }
    else:
        url = s.llm_base_url.rstrip("/") + "/chat/completions"
        payload = {
            "model": s.llm_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
        }
    reservation = reserve_generation(user_id)
    start = perf_counter()
    tokens = 0
    reported = False
    status = "error"
    error = "LLM_RESPONSE_ERROR"
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(url, headers=headers, json=payload)
        if response.status_code >= 400:
            error = "LLM_PROVIDER_HTTP_" + str(response.status_code)
            raise LLMProviderError(
                f"LLM провайдер вернул ошибку {response.status_code}"
            )
        data = response.json()
        if provider == "ollama":
            counts = [data.get("prompt_eval_count"), data.get("eval_count")]
            content = data.get("message", {}).get("content")
        else:
            usage = data.get("usage") or {}
            counts = (
                [usage["total_tokens"]]
                if "total_tokens" in usage
                else [usage.get("prompt_tokens"), usage.get("completion_tokens")]
            )
            choices = data.get("choices") or []
            content = choices[0].get("message", {}).get("content") if choices else None
        if counts and all(type(value) is int and value >= 0 for value in counts):
            tokens = sum(counts)
            reported = True
        if not isinstance(content, str) or not content.strip():
            error = "LLM_INVALID_RESPONSE"
            raise LLMProviderError("Ответ LLM имеет неизвестный или пустой формат")
        status = "success"
        error = None
        return content
    except httpx.TimeoutException:
        error = "LLM_TIMEOUT"
        raise LLMProviderError("Превышено время ожидания LLM") from None
    except httpx.RequestError:
        error = "LLM_TRANSPORT_ERROR"
        raise LLMProviderError("Не удалось подключиться к LLM") from None
    finally:
        finish_generation(
            reservation,
            agent_type=agent_type,
            action_type=action_type,
            model_name=s.llm_model,
            tokens_used=tokens,
            tokens_reported=reported,
            duration_ms=max(0, int((perf_counter() - start) * 1000)),
            status=status,
            error_message=error,
        )
