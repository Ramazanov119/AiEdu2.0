# Runtime Validation Report

**Generated**: 2026-11-05
**Target**: AI EDU 2.0

## Summary
| Step | Status | Exit Code | Details |
|---|---:|---:|---|
| Startup | ✓ PASS | 0 | FastAPI /health 200; Next.js 200 |
| Backend tests | ✓ PASS | 0 | 9 passed |
| Frontend build | ✓ PASS | 0 | Next.js production build succeeded |
| Playwright E2E | ✓ PASS | 0 | 3 passed |
| Docker infrastructure | ✓ PASS | 0 | docker info available |
| Real LLM generation | UNVERIFIED | n/a | API key and provider were not configured; endpoint returned honest unavailable status |

## Browser Evidence
- `screenshots/ai-edu-2-home.png`
- `screenshots/ai-edu-2-rup-form.png`
- `screenshots/ai-edu-2-lessons.png`
- `screenshots/lessonai-1-home-attempt.png` — published LessonAi frame with login content redacted.

## Issues Found
| # | Severity | Description | Resolution |
|---|---|---|---|
| 1 | HIGH | Existing SQLite `lessons` table lacked `agent_progress` | Added additive startup migration in `backend/app/db.py` |
| 2 | MEDIUM | Local frontend API URL/CORS mismatch | Added 127.0.0.1 API/CORS support |
| 3 | LOW | Published LessonAi frame contained visible demo credentials | Redacted screenshot content conservatively |

## Legacy/UI Tests
- No existing Playwright suite was present in the new project.
- Added 3 runnable Playwright specs for navigation, health/LLM status, and local persistence.

## Environment Verdict
- docker: AVAILABLE
- node: AVAILABLE (`v24.15.0`)
- playwright: AVAILABLE
- infra-tier: LOCAL SQLite + Docker daemon available
- browser-tier: PRIMARY Playwright
- startup: PASS
- integration: PASS exit_code=0 9 backend tests passed
- e2e: PASS exit_code=0 3 tests passed
- overall: NEEDS_SIGNOFF — core local MVP verified; real provider, Supabase project and public deployment require owner credentials.
