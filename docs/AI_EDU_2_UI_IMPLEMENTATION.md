# AI EDU 2.0 — интерфейс и живой виртуальный офис

Дата: 5 ноября 2026. Реализовано в существующем проекте AiEdu. Исходный аудит `AI_EDU_2_AUDIT.md` сохранён как исторический срез; актуальные изменения перечислены здесь. LessonAi не изменялся. Production Supabase, платные LLM, deployment, git commit/push не использовались.

## Что реализовано

- **Dashboard:** светлая дизайн-система, Lucide, верхняя навигация/организация/профиль, условный баннер, фактические счётчики, карточки занятий, фильтры, просмотр, скачивание DOCX/PPTX, утверждение одного/всех комплектов, запрос доработки.
- **Виртуальный офис:** отдельная динамически загружаемая PixiJS 8 WebGL-сцена; авторский интерьер и четыре графических персонажа по референсу. GPU-отрисовка не использует React setState в кадровом цикле. Мебель перекрывает сидящих персонажей, рабочие мониторы и доска согласованы с состояниями.
- **Персонажи:** coordinator → Координатор; methodist → Методист; creative → Креативный агент; assessment → Проверяющий. В существующем пути занятий assessment готовит практику, а не выполняет полноценную независимую QA-проверку. Это явно отражено в панели; роль не подменяется обещанием отсутствующей проверки.
- **Анимации:** сидение, спокойные небольшие движения в ожидании, редкие idle-прогулки, двухкадровая ходьба с фазой от пройденного расстояния, отражение по направлению, печать, чтение, передача документа, возврат к рабочему месту. Заданы маршруты через проходы, плавная интерполяция и простое предотвращение сближения движущихся персонажей. При ошибке нет анимации успешной передачи результата.
- **Интерактивность:** клики по персонажам/подписям, подсветка, доступные кнопки команды, панель агента с ролью/задачей/событиями, переход в чат и к результату. Retry поддержан для занятия, не для несуществующего API повтора отдельного агента.
- **Pipeline:** РУП → Анализ → План → Лекция → Практика → Презентация → Проверка → Готово. Этапы открывают детали, имеющиеся временные метки, ошибки и результаты. Проценты — доля завершённых этапов, не оценка прошедшего времени. Финальная проверка/готовность требуют решения преподавателя; существующий слабый автоматический quality check не выдаётся за полноценную экспертизу.
- **Чат:** Агенты / Со мной / События; реальные сохранённые ChatMessage/AgentAudit. Запрос комплекта по точной теме или номеру из подтверждённой РУП создаёт существующее Lesson workflow. Неоднозначный запрос требует уточнения. Отсутствующая LLM даёт понятную 503 и сохраняемое сообщение об ошибке.
- **РУП:** upload DOCX/XLSX/PDF, редактирование предмета/групп/критериев и тем, добавление/удаление тем, подтверждение и повторное сохранение, создание комплекта из выбранной темы.
- **Материалы/история:** реальная библиотека, текстовый редактор с устойчивым фокусом и клавиатурным Escape/Tab, обновление экспортного файла, журнал реальных событий. Визуального DOCX/PPTX renderer и PDF export не добавлено.
- **Demo Mode:** заметная постоянная маркировка, отдельный набор демонстрационных занятий/сообщений/событий. Сценарий запускается кнопкой и может быть приостановлен/сброшен. Запись пользовательских данных и вызовы LLM из demo-операций отключены. Demo не создаёт авторизованную сессию и не даёт доступа к настоящим результатам.
- **Локализация:** типизированный словарь навигации ru/kk и изолированный API/domain layer. Полный перевод всего продукта на казахский пока не выполнен, переключатель полного перевода не показывается.

## Реальные данные и ограничения

| Источник | Использование |
|---|---|
| GET /portfolio и /portfolio/{id} | Список РУП, подтверждение, структурированные темы |
| GET /lessons | Занятия, тексты/статусы материалов, agent_progress, решение преподавателя |
| GET /tasks | Настоящие задания чата, шаги, ошибки, участие агентов |
| GET/POST /chat/messages | Сохранённая переписка и запуск комплекта по подтверждённой теме |
| GET /events | AgentAudit текущего пользователя, до 200 последних записей, поддерживает after |
| POST /lessons/{id}/review | approved/revision; решение хранится в существующем AgentAudit |
| GET/PUT /profile | Имя и организация |
| GET /llm/status | Конфигурация/наличие Ollama-модели, без платного пробного completion |

Данные обновляются раз в 6 секунд, опрос при скрытом документе пропускается. Статус LLM — отдельно раз в минуту. Запросы отменяются при размонтировании/смене режима; токен передаётся типизированным API-клиентом и при скачивании. SSE/WebSocket не добавлены.

Расписания и планировщика ночной генерации нет. Заложен nullable ScheduleEntry; backend явно возвращает schedule=null. В рабочем режиме время пары/модуль не выдумываются, «уроков сегодня» и время подготовки показывают прочерк при нехватке данных. Экономия времени не заявляется. При наличии событий начала/завершения среднее время вычисляется из фактических timestamps.

Реальная успешная LLM-генерация остаётся **непроверенной**: в исходном локальном Ollama нет установленной модели; тестовая среда намеренно запускалась без LLM. Графика/переходы demo не являются доказательством реальной генерации. Supabase Auth/RLS/Storage end-to-end не тестировались без отдельного согласованного проекта.

## Исправления блокирующих ошибок аудита

1. Импорт TaskStep в API; непустой список задач больше не падает с NameError.
2. XLSX values_only корректно читается как значение, без обращения к cell.value.
3. РУП разбирается по строкам: часы/вид занятия остаются с темой той же строки, «лекция» больше не становится отдельной темой в проверенном сценарии. Это улучшенный эвристический parser, не гарантия на весь корпус РУП.
4. Невалидные документы возвращают 422, upload ограничен 20 МБ и 80 МБ суммарного распакованного DOCX/XLSX. Ограничения не заменяют полноценную изоляцию обработки недоверенных документов.
5. Экспорт скачивается fetch с Bearer и Blob URL; после использования URL освобождается.
6. Правка пересоздаёт локальный DOCX/PPTX и повторно загружает его в configured Storage, включая исходный supabase:// путь. Upsert разрешён для детерминированных имён. Контракт облачной повторной загрузки проверен spy-тестом; настоящая сеть Supabase не проверена.
7. Локальный cache скачивания разделён по владельцам, имена уникальны; task result хранит возвращённые пути Storage вместо удалённых локальных файлов, download поддерживает storage adapter.
8. При retry активного занятия возвращается 409. Повторная генерация и редактирование требуют повторного утверждения.
9. Подтверждённый JSON РУП используется в prompt генерации занятий, а не старый неотредактированный текст.
10. /llm/status не вызывает cloud chat/completions. Для облака available означает достаточность конфигурации, verified=false явно сообщает, что соединение не проверено. UI различает «настроена» и «доступна».
11. Шаги legacy Celery pipeline сортируются по известному порядку названий, а не по UUID.
12. После выхода из аккаунта очищаются данные интерфейса; используется auth state subscription.

## Проверки

Изолированные серверы: frontend production build на `127.0.0.1:3010`, FastAPI на `127.0.0.1:8010`, SQLite `/tmp/aiedu-ui-runtime/final.db`. Существующие серверы 3000/8000 не останавливались. Собственные временные серверы перезапускались при смене сборки.

| Проверка | Результат |
|---|---|
| TypeScript `npm run typecheck` | PASS |
| Production `npm run build -- --webpack` | PASS: compile, TS, prerender, traces |
| Backend pytest | **17 passed**, 0.81 s; предупреждение устаревшего Starlette/AnyIO API |
| Playwright | **7 passed**, 15.7 s: навигация, health/status, persistence чтений, Demo без API writes, сцена/панель/чат, mobile/reduced motion, редактор, восстановление контекста |
| DOCX upload в браузере | PASS: документ с таблицей → 2 темы → подтверждение |
| Реальная генерация без LLM | Ожидаемая 503; та же понятная ошибка из чата, без фиктивного комплекта |
| Правка/утверждение/скачивание | Backend-тесты: DOCX пересоздан и открыт, решение сбрасывается на revision, чужому владельцу 404 |
| Console | Необработанных JS pageerror в проверенном сценарии нет. Два ожидаемых HTTP 503 отображаются браузером как Failed to load resource при намеренно отсутствующей LLM |
| Мобильный 390×844 | Скриншоты, горизонтального overflow нет; reduced-motion активирует режим reduced |
| ESLint | Старый npm run lint всё ещё вызывает удалённую next lint → exit 1; самостоятельная ESLint-конфигурация не добавлена |

После последнего уточнения условий баннера дополнительно пройдена проверка навигации Dashboard (1 тест).

Первый Playwright mobile-прогон обнаружил отсутствие доступного имени скрытой кнопки Demo — исправлено aria-label, повторный прогон прошёл. Проверка модального редактора добавлена для регрессии фокуса при React updates. Потеря контекста проверяется синтетическим событием, не физическим отключением GPU.

Turbopack ранее упирался в ограничения IPC среды аудита; webpack build проверен отдельно. Скрипт build по умолчанию не переименован и продолжает использовать штатный Next.js. Первая отдельная dev-компиляция PixiJS с webpack оказалась медленной; полноценная браузерная проверка проведена на production build. Next выводит предупреждение о package-lock.json за пределами текущего репозитория; чужой файл не менялся.

## Производительность: измерения, а не обещание 60 FPS

Измерение в Chromium headless, viewport 1440×1100, renderer **ANGLE / SwiftShader software Vulkan**, 4 персонажа, 3 исходные текстуры. Это программная эмуляция GPU; результаты не эквивалентны аппаратному WebGL на MacBook Air M1.

- Первый прогон: примерно 10 FPS normal, p95 frame 169.7 ms.
- После ограничения resolution=1, отключения MSAA и обрезки foreground texture frames: **26.2 FPS normal**, p95 40.3 ms; **23.4 FPS eco**, p95 67.9 ms. Eco ограничивает потолок 30, normal — 60; сами лимиты не гарантируют достижения частоты. Обратное соотношение задержек возможно из-за софтверного renderer и короткой выборки.
- JS callback анимации: среднее 0.023 ms normal, 0.025 ms eco в записанной выборке.
- CDP TaskDuration вырос на 0.067738 s за 6 s (~1.13% времени одного main thread). Это **не общий CPU процесса** и не включает все расходы software raster/GPU.
- После принудительного GC в 12 повторных открытиях: JS heap 7 548 384 → 8 387 244 bytes; последние три замера 8 357 508 → 8 375 220 → 8 387 244. Рост замедляется, но это не доказательство отсутствия утечек; нужен длительный soak-test и native GPU memory profiling на целевом устройстве.
- Снимки canvas отличаются между кадрами: анимация действительно меняет изображение. Постоянного React render по кадрам нет. Дополнительный прогон подтвердил координаты координатора (326,350) → (407,359) → (551,376) → (608,408) и переход walking → interaction, без JS ошибок: [movement.json](ui-screenshots/movement.json).

Сырые результаты: [performance.json](ui-screenshots/performance.json). Замеры сделаны после основной GPU-оптимизации; последующие изменения затрагивали доступность, диагностическое описание actor states и обработку ошибки агента, не геометрию сцены.

Очистка: ticker stop/destroy, ResizeObserver.disconnect, снятие visibility/media/context listeners, уничтожение sprite frames и принадлежащих сцене texture sources, releaseGlobalResources. Сцена при скрытии документа останавливает ticker, при восстановлении возобновляет. Reduced motion убирает маршруты и ограничивает FPS; eco снижает частоту и отключает дополнительный мониторный эффект. Доступная панель команды остаётся рабочей при недоступном WebGL. 60 FPS и отсутствие native memory leaks на M1 пока **не подтверждены**.

## Скриншоты и сравнение с референсом

- [Главная — Demo](ui-screenshots/dashboard-demo.png)
- [Офис — Demo](ui-screenshots/office-demo.png)
- [Офис — реальные данные](ui-screenshots/office-real.png)
- [Офис — персонаж в движении](ui-screenshots/office-walking.png)
- [Главная — реальные пустые данные](ui-screenshots/dashboard-real.png)
- [Главная — смартфон](ui-screenshots/dashboard-mobile.png)
- [Офис — смартфон](ui-screenshots/office-mobile.png)

Сохранены композиционные ориентиры: светлая фиолетовая система, насыщенный градиентный баннер, белые карточки, верхняя навигация, тёплый изометрический интерьер с окнами/стеллажами/растениями, четыре рабочих места, pipeline и нижние панели. Интерьер и персонажи — отдельные растровые игровые assets, не скриншот интерфейса. Графика интерпретирует референс и не совпадает с ним попиксельно. Метрики/действия изменены там, где исходная система ещё не даёт оснований показывать обещанный результат.

## Изменённые и добавленные файлы

| Файл | Назначение |
|---|---|
| frontend/src/app/page.tsx | Вход в новый workspace |
| frontend/src/app/globals.css | Дизайн-система, desktop/mobile, reduced motion |
| frontend/src/app/layout.tsx | Форматирование существующего layout, содержательная структура сохранена |
| frontend/src/components/workspace.tsx | Dashboard, РУП, библиотека, офисные панели, чат, pipeline, диалоги |
| frontend/src/components/office/OfficeScene.tsx | PixiJS scene lifecycle, sprites, маршруты, masks, diagnostics |
| frontend/src/lib/types.ts | Typed domain/API models, связь ролей с состояниями |
| frontend/src/lib/api.ts | Авторизованные JSON/upload/download, timeouts |
| frontend/src/lib/demo.ts | Изолированные демонстрационные данные/шаги |
| frontend/src/lib/i18n.ts | ru/kk foundation |
| frontend/src/lib/supabase.ts | Форматирование существующего adapter |
| frontend/public/office/{staffroom,agents,working}.png | Интерьер и 2 sprite atlas |
| frontend/package.json и package-lock.json | pixi.js 8.22, lucide-react 1.69, typecheck script |
| frontend/next.config.mjs | AI_EDU_BUILD_DIR для отдельных сборок без конфликта dev |
| frontend/.gitignore | Отдельные build/test артефакты |
| frontend/tsconfig.json, next-env.d.ts | Обновлены Next.js для generated types отдельных сборок |
| frontend/playwright.config.ts | Тестовые URL через env, WebGL launch options |
| frontend/e2e/{home-navigation,backend-health,local-persistence}.spec.ts | Актуальные навигация и настраиваемые тестовые API URL |
| frontend/e2e/office-demo.spec.ts | Сцена, demo isolation, mobile/reduced motion, редактор, context recovery |
| backend/app/main.py | Events/review endpoints, chat lesson routing, timestamps, import/validation/storage fixes |
| backend/app/services/documents.py | XLSX и построчная связь данных РУП |
| backend/app/services/llm.py | Безопасный status без платных completions, точное имя модели Ollama |
| backend/app/services/storage.py | Upsert, создание download cache directories |
| backend/app/workers/celery_app.py | Порядок шагов, сохранение облачных путей результатов |
| backend/app/tests/test_ui_workflows.py | 8 новых регрессионных backend-тестов |
| docs/AI_EDU_2_UI_IMPLEMENTATION.md | Этот отчёт |
| docs/AI_EDU_2_OFFICE_ASSETS.md | Происхождение assets и финальные prompts встроенного image_gen |
| docs/ui-screenshots/* | Скриншоты и JSON измерений |

Два новых API используют существующий AgentAudit; изменения production-схемы или новые миграции не потребовались. В Git проект исходно untracked; список составлен по выполненным изменениям, не по commit diff.

## Точные команды локального запуска

Для уже запущенного безопасного preview: `http://127.0.0.1:3010`, backend health `http://127.0.0.1:8010/health`. Это локальная временная БД, без внешних ключей. Demo включается кнопкой в верхней панели.

Ниже команды повторного запуска **в свободных терминалах/портах**, без необходимости останавливать существующие 3000/8000.

Backend (изолированная SQLite и явно отключённые внешние сервисы):

```bash
mkdir -p /tmp/aiedu-ui-local
cd /tmp/aiedu-ui-local
ENVIRONMENT=local LOCAL_DEV_USER_ID=ui-local \
DATABASE_URL=sqlite:////tmp/aiedu-ui-local/local.db \
SUPABASE_URL='' SUPABASE_SERVICE_ROLE_KEY='' SUPABASE_ANON_KEY='' \
LLM_PROVIDER='' LLM_BASE_URL='' LLM_MODEL='' \
CORS_ORIGINS=http://127.0.0.1:3010 \
PYTHONPATH=/Users/esimkhanramazanov/projects/AiEdu/backend \
/Users/esimkhanramazanov/projects/AiEdu/backend/.venv/bin/python \
-m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Frontend dev:

```bash
cd /Users/esimkhanramazanov/projects/AiEdu/frontend
npm ci
AI_EDU_BUILD_DIR=.next-local NEXT_PUBLIC_API_URL=http://127.0.0.1:8010 \
NEXT_PUBLIC_SUPABASE_URL='' NEXT_PUBLIC_SUPABASE_ANON_KEY='' \
npm run dev -- --hostname 127.0.0.1 --port 3010 --webpack
```

Production build/start вместо dev:

```bash
AI_EDU_BUILD_DIR=.next-local-production NEXT_PUBLIC_API_URL=http://127.0.0.1:8010 \
NEXT_PUBLIC_SUPABASE_URL='' NEXT_PUBLIC_SUPABASE_ANON_KEY='' \
npm run build -- --webpack
AI_EDU_BUILD_DIR=.next-local-production npm start -- --hostname 127.0.0.1 --port 3010
```

Проверки:

```bash
# frontend/
npm run typecheck
E2E_BASE_URL=http://127.0.0.1:3010 E2E_API_URL=http://127.0.0.1:8010 \
npm run test:e2e -- --workers=1 --output=/tmp/aiedu-ui-playwright
# backend/
DATABASE_URL=sqlite:///:memory: ENVIRONMENT=test LOCAL_DEV_USER_ID='' \
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider
```

Для настоящей локальной генерации вместо пустых LLM settings требуется запущенная Ollama и **установленная** модель; перед использованием проверить `ollama list`, задать LLM_PROVIDER=ollama, LLM_BASE_URL=http://127.0.0.1:11434 и точное LLM_MODEL. Облачный ключ и платный тест в ходе этой работы не использовались. Native local API и production режимы нельзя смешивать: локальный bypass предназначен только для разработки.

## Что остаётся до Vercel/Render

- Отдельно согласовать тестовый Supabase, применить исходные миграции и проверить реальные JWT, refresh/expiry, RLS, Storage upload/edit/download с двумя владельцами. Проверить права прямого DATABASE_URL и размер connection pool.
- Vercel Root Directory=frontend; NEXT_PUBLIC_API_URL/SUPABASE_URL/ANON_KEY задавать до build. Серверные ключи в browser не передавать. Подтвердить штатный build в целевой среде; webpack — проверенный fallback.
- Render ENVIRONMENT=production, CORS_ORIGINS frontend HTTPS, PostgreSQL, storage, реальные LLM provider/model/key. Local bypass убрать. Перед публичным доступом — rate/concurrency/token/budget limits; исправление status endpoint не заменяет лимиты генераций.
- BackgroundTasks занятий всё ещё in-process: нужны durable worker, блокировки/idempotency/recovery и реальные автоматические retries. Redis и Celery worker требуются legacy control-task path; текущий render.yaml их не создаёт.
- Не выдавать генерацию практики assessment-агентом за независимую проверку качества; внедрить реальный review gate, нормальный раздельный экспорт контрольной/ключей (legacy worker пока включает assessment_text целиком).
- Подключить структурированное расписание и scheduler ночных комплектов отдельным этапом. Добавить PDF converter/render preview при необходимости.
- Исправить ESLint workflow, добавить .dockerignore, использовать production start в frontend Dockerfile, CI/security checks, retention/cache cleanup, backups и наблюдаемость.
- Профилировать офис на физическом MacBook M1, проверить длительную работу/утечки native GPU памяти; при необходимости оптимизировать atlas/изображения и качество рендера. Файлы графики сейчас суммарно около 5.2 МБ.

Публикация и git push не выполнялись.
