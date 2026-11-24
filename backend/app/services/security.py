INJECTION_PATTERNS=(
    'ignore previous instructions','ignore all instructions','system prompt','jailbreak','<script',
    'игнорируй предыдущие','игнорируй инструкции','раскрой системный промпт'
)

def prompt_injection_detected(text: str) -> bool:
    normalized=text.lower()
    return any(pattern in normalized for pattern in INJECTION_PATTERNS)
