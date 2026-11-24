# AI EDU 2.0

Независимый SaaS-проект платформы персональных ИИ-ассистентов для преподавателей. Новый каталог, Git-репозиторий, Supabase-конфигурация и база данных не связаны с AI EDU 1.0 или LessonAi.

## Стек

- Frontend: Next.js, TypeScript, Tailwind CSS.
- Backend: FastAPI, SQLAlchemy, python-docx/openpyxl/python-pptx/PyPDF2.
- Authentication/Database/Storage: Supabase Auth/PostgreSQL/Storage.
- Background jobs: FastAPI BackgroundTasks; опционально Redis + Celery.
- LLM: OpenAI-совместимый endpoint, включая Ollama.

## Быстрый запуск

1. Скопируйте `.env.example` в `.env` и заполните реальные значения Supabase и LLM.
2. Выполните в Supabase SQL migrations из каталога `supabase/migrations`.
3. Запустите все сервисы: `docker compose up --build`.
4. Откройте `http://localhost:3000`; API — `http://localhost:8000/docs`.

## Настройка Ollama для MacBook Air M1 (8 ГБ)

Для M1 8 ГБ предпочтительны квантованные компактные модели до примерно 4–5 ГБ:

```bash
ollama serve
ollama pull qwen2.5:3b
# или более компактная модель, если доступна в локальном кеше:
ollama pull llama3.2:3b
```

Проверьте модель до запуска генерации:

```bash
curl http://127.0.0.1:11434/api/tags
curl http://127.0.0.1:8000/llm/status
```

В `.env` для Ollama на Mac:

```env
LLM_PROVIDER=ollama
LLM_BASE_URL=http://127.0.0.1:11434
LLM_MODEL=qwen2.5:3b
```

В Docker Compose backend использует `http://host.docker.internal:11434`; при профиле `ollama` используйте `LLM_BASE_URL=http://ollama:11434`.

Проверка `/llm/status` не возвращает фиктивный ответ: она сообщает `available=false` и отсутствующую модель.

Запуск Ollama как Docker-профиля:

```bash
docker compose --profile ollama up -d ollama redis
ollama pull llama3.2:3b # для Ollama в Docker используйте: docker exec ai-edu-ollama-1 ollama pull llama3.2:3b
```

## Локальные backend-тесты

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn app.main:app --reload
```

Локальный backend использует SQLite только для разработки; файл `backend/ai_edu.db` сохраняется при перезапуске, а Docker монтирует volumes для данных и файлов. Для Supabase задайте `DATABASE_URL` PostgreSQL и переменные `SUPABASE_*`. Bearer-токен Supabase валидируется через `/auth/v1/user`; заголовок `X-User-ID` не используется для авторизации. В локальной разработке можно задать только серверный `LOCAL_DEV_USER_ID`; браузер не может выбрать произвольного пользователя.

Backend не запустит генерацию без настроенного LLM: показывает явную конфигурационную ошибку и не создаёт фиктивный ответ.

## Первый сквозной сценарий

1. Зарегистрируйтесь через Supabase Auth.
2. В «Портфель» загрузите DOCX/XLSX/PDF с РУП.
3. Проверьте извлечённые данные и нажмите «Подтвердить».
4. В «Командный чат» отправьте запрос на контрольную.
5. Координатор назначит Ассистента; Методист проверит ответ против РУП.
6. Скачайте созданный DOCX из сообщения чата или из `/documents/{task_id}/download`.

LLM-провайдер должен быть OpenAI-совместимым. Пример для Ollama через `/v1`:

```text
LLM_PROVIDER=ollama
LLM_BASE_URL=http://host.docker.internal:11434/v1
LLM_MODEL=qwen2.5:7b
```

## Безопасность

Supabase RLS включён миграциями для всех пользовательских таблиц. Storage bucket приватный, с отдельными policies владельца. Все защищённые операции API требуют токен Supabase; только в ENVIRONMENT=local допускается серверный LOCAL_DEV_USER_ID. Загруженный текст проверяется на признаки prompt injection; обнаружение фиксируется в аудите и команды документа не передаются как системные инструкции. Задания CELERY имеют таймауты, лимит шагов, повторные попытки и поддержку отмены через API.

## Серверные роли, подписки и аналитика

Добавлены защищённые `/api/admin/*` (alias `/admin/*`), teacher/methodist/admin,
блокировка и сроки доступа, атомарная дневная квота LLM, generation/admin audit и
доверенный bootstrap первого администратора по INITIAL_ADMIN_EMAIL. NULL срок
подписки означает базовый/бессрочный доступ, daily_limit по умолчанию 20 реальных
LLM-вызовов в сутки Asia/Almaty. Обычный frontend profile round-trip сохранён.

Перед развёртыванием нужна отдельно проверенная SQL-миграция
`supabase/migrations/20261123000005_access_roles_analytics.sql`. Она в рабочую
Supabase БД автоматически не применялась. `ENVIRONMENT=local` с внешним PostgreSQL
теперь намеренно не запускается; настоящий `.env` с секретами не изменялся.
Первый admin назначается только доверенным CLI, без публичного bootstrap endpoint:

```sh
cd backend
# Настройте отдельное staging окружение и подтверждённую Supabase identity владельца.
INITIAL_ADMIN_EMAIL='owner@your-domain.kz' .venv/bin/python -m app.bootstrap_admin --user-id '<Auth UUID>'
```

Полная настройка, API, права БД и результаты проверок:
[AI_EDU_2_BACKEND_ADMIN.md](docs/AI_EDU_2_BACKEND_ADMIN.md).


## Бесплатный деплой: Vercel + Render

1. В Supabase примените проверенные SQL-миграции из `supabase/migrations` по порядку
   (для существующей legacy-БД см. [FULL_SYNC_PRODUCTION.md](docs/FULL_SYNC_PRODUCTION.md)).
   Нужны Supabase Auth, PostgreSQL и приватный bucket `portfolio-private`.
2. В Render создайте Blueprint из корневого `render.yaml`. Он создаёт один Python
   web-сервис с `plan: free`, корнем `backend` и запуском
   `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
   Заполните `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` и `FRONTEND_URL`.
   `DATABASE_URL` должен использовать установленный драйвер psycopg:
   `postgresql+psycopg://USER:PASSWORD@HOST:6543/postgres?sslmode=require`.
   Возьмите реальные параметры подключения pooler в Supabase; пароль URL-кодируйте.
   `ENVIRONMENT=production` уже задан. `INITIAL_ADMIN_EMAIL` и `SUPABASE_JWT_SECRET`
   можно оставить пустыми при авторизации через Supabase Auth API.
3. Не задавайте `REDIS_URL`: задания команды агентов выполняются через
   `BackgroundTasks` в потоке процесса FastAPI, со своей сессией БД.
   Уроки также используют `BackgroundTasks`. Если Redis задан, проверяется наличие
   worker; при недоступности worker/брокера включается тот же fallback.
   Отдельные Redis и Celery Worker не нужны.
4. В Vercel импортируйте репозиторий, выберите Next.js и Root Directory `frontend`.
   Build Command: `npm run build`, Install Command: `npm ci`.
   Задайте для Production и Preview:
   `NEXT_PUBLIC_API_URL=https://YOUR_API.onrender.com`,
   `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   Секрет service role и Gemini key задаются только в Render.
   Сборка использует поддерживаемый Next.js Webpack (`next build --webpack`),
   чтобы не зависеть от локального порта, который Turbopack открывает для PostCSS.
5. Укажите полученный HTTPS-домен Vercel в `FRONTEND_URL` Render, а также в
   Site URL / Redirect URLs Supabase Auth. После изменения `NEXT_PUBLIC_*`
   пересоберите frontend. Проверьте `/health`, `/llm/status`, вход и генерацию урока.

CORS разрешает `FRONTEND_URL` и HTTPS-поддомены `*.vercel.app` для preview.
В production локальный dev-пользователь отключён, localhost удаляется из CORS,
а локальное хранение файлов без Supabase запрещено.
`GEMINI_API_KEY` включает Gemini через [OpenAI-совместимый API Google](https://aistudio.google.com/docs/openai).
По умолчанию используется `gemini-2.5-flash`; при необходимости задайте `LLM_MODEL`.

Задачи в процессе не переживают рестарт или redeploy. Их нужно запускать повторно
после прерывания; это не устойчивая очередь. [Render Free](https://render.com/docs/free)
засыпает после 15 минут без входящих запросов и использует временную файловую систему,
поэтому постоянные данные и файлы сохраняются в Supabase. Лимиты и стоимость Gemini
определяются выбранной моделью и квотой аккаунта отдельно от бесплатного хостинга.
