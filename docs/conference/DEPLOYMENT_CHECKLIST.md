# AI EDU 2.0 — публичное развёртывание

## Архитектура
- Frontend: Next.js на Vercel.
- Backend: FastAPI на Render Web Service.
- Auth/DB/Storage: новый отдельный проект Supabase для AI EDU 2.0.
- LLM: OpenAI-compatible API или настроенный внешний provider.

## Ограничения бесплатных тарифов
Перед публикацией проверить текущие правила провайдеров, поскольку ограничения могут меняться:
- Vercel: лимиты serverless-функций, bandwidth и build minutes; HTTPS и preview deployments включены.
- Render: сервисы могут засыпать на free tier, cold start возможен, local disk эпhemerный; внешняя PostgreSQL/без persistent storage.
- Supabase: лимиты проекта, хранения, Auth, database bandwidth и egress.

## Сервисные проверки
1. Создать новый Supabase-проект, не использующий старый LessonAi.
2. Применить все SQL-файлы из `supabase/migrations`.
3. Настроить Email/Password Auth и URL redirect.
4. Создать приватный Storage bucket согласно migration policies.
5. Настроить Render `DATABASE_URL`, Supabase, LLM и `CORS_ORIGINS=https://<vercel-domain>`.
6. `ENVIRONMENT=production` обязателен; не задавать `LOCAL_DEV_USER_ID`.
7. Задать Vercel `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`.
8. Проверить `/health`, HTTPS, регистрацию, загрузку РУП и реальную генерацию.

## Фоновые задачи и таймауты
FastAPI использует `BackgroundTasks` синхронного процесса. Для MVP это подходит, но на Render/Vercel не гарантирует надёжное долгоживущее выполнение. Для конференционной публичной версии предпочтителен внешний Celery/Redis worker или отдельный managed job queue с persistent storage. Не публиковать, пока real-time status и retry подтверждены.
