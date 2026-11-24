# Серверные роли, доступ и аналитика AI EDU 2.0

Изменения от 23 ноября 2026. Реализована серверная часть; интерфейс администратора и подключение отдельного AiEduAdmin в этот этап не входят. Рабочая Supabase-база не подключалась и не изменялась. Подготовлена миграция `supabase/migrations/20261123000005_access_roles_analytics.sql`.

## 1. Безопасный порядок внедрения

1. Сделайте backup и используйте отдельную staging-копию Supabase. Проверьте действующие нестандартные policies/grants: миграция заменяет политики перечисленных публичных таблиц на явные owner-read/backend-write.
2. Примените предыдущие миграции проекта и затем `20261123000005_access_roles_analytics.sql` через согласованный процесс миграций. Backend больше не вызывает create_all/ALTER TABLE для PostgreSQL при импорте. Автоматический startup не является механизмом production-миграций.
3. Миграция добавляет organizations, поля profiles, generation_logs, generation_reservations и admin_audit_logs. Все существующие Auth identities синхронизируются с profiles строго по UUID; новые регистрации/смена email синхронизируются доверенным Auth trigger. Роли из user_metadata не читаются. Созданные/существующие пользователи получают teacher, is_active=true и daily_limit=20, если ранее соответствующие поля отсутствовали. Существующие имя/institution сохраняются.
4. Runtime DB login должен быть отдельным доверенным серверным логином без владения таблицами, SUPERUSER/BYPASSRLS и DDL. Миграция готовит NOLOGIN-группу aiedu_backend и её RLS/grants. Владелец БД отдельно выполняет `GRANT aiedu_backend TO <runtime_login>` для своего server-only login. Не выдавайте эту группу anon/authenticated или преподавательским credentials. Supabase service_role также получает необходимые серверные table grants; его ключ никогда не должен попадать в браузер.
5. Установите зависимости backend/requirements.txt. В staging/production задайте ENVIRONMENT=staging/production и очистите LOCAL_DEV_USER_ID. Настройте DATABASE_URL, Supabase Auth, Redis/Celery и LLM. Перезапустите API и worker с одной и той же БД.
6. Назначьте первого администратора через CLI ниже. Проверьте обычного teacher/methodist (403 на admin API), active/expired/blocked пользователя, org isolation существующего user API и квоты.
7. Внедрение в production, применение миграции к рабочей базе и deployment требуют отдельного решения владельца; они в этой задаче не выполнялись.

**Важно для текущего .env:** комбинация ENVIRONMENT=local и внешнего PostgreSQL теперь намеренно останавливает запуск. Для local используйте SQLite либо явно локальный PostgreSQL на loopback/Unix socket. Удалённые hosts/hostaddr, смешанные multi-host адреса и libpq service-профили не допускаются в local. ENVIRONMENT по умолчанию — production; LOCAL_DEV_USER_ID без явного local не работает. Настоящий .env с секретами автоматически не изменялся. Пример .env.example приведён к согласованной локальной SQLite-конфигурации.

## 2. Первый администратор

Доверенная CLI, не публичный HTTP endpoint:

```sh
cd backend
export ENVIRONMENT=staging
# DATABASE_URL и SUPABASE_* берутся из вашего защищённого окружения.
export INITIAL_ADMIN_EMAIL='owner@your-domain.kz'
.venv/bin/python -m app.bootstrap_admin --user-id '<Supabase Auth UUID владельца>'
```

CLI проверяет пользователя через Supabase Admin Auth API с server-only service-role key: UUID должен совпасть, email должен быть подтверждён (`email_confirmed_at`) и совпадать с INITIAL_ADMIN_EMAIL. Только после этого роль меняется на admin с audit записью. Никаких встроенных паролей/seed admin нет. Наличие email в браузерном запросе, JWT user_metadata или обычная регистрация не повышают роль. CLI не заменяет уже назначенного администратора и не разблокирует отключённого пользователя. После bootstrap удалите INITIAL_ADMIN_EMAIL из рабочего окружения. Для дальнейших изменений используйте защищённый API.

## 3. Модель доступа и квоты

- teacher и methodist не имеют административных permissions. admin допускается к admin API только при is_active=true. Роль читается из БД при каждом запросе, не из JWT claims.
- is_active=false запрещает новые генерации. Login, просмотр собственных данных и безопасное изменение имени/institution не заменяются Supabase Auth ban.
- subscription_until=NULL при is_active=true разрешает базовый/бессрочный доступ согласно заданию. Дата, равная текущему моменту или в прошлом, запрещает генерацию. Для PATCH указывайте ISO timestamp с timezone; явный JSON null снимает срок, отсутствие поля сохраняет его.
- Отключённая назначенная организация также запрещает генерации.
- daily_limit — число реальных LLM попыток за сутки, включая ошибки провайдера. Значение 0 запрещает все генерации. Один комплект занятия может использовать несколько обращений, например 4 материала = 4 вызова; логические события координатора сами по себе не являются LLM-вызовами.
- Сутки определяются ANALYTICS_TIMEZONE (по умолчанию Asia/Almaty). Используется закреплённая пакетная tzdata, чтобы устаревшая системная/Conda база не считала Алматы UTC+6. Времена хранятся в UTC.
- HTTP check_user_access включён на POST /chat/messages, /lessons/generate и /lessons/{id}/retry. Перед фоновой работой и каждым отдельным LLM-вызовом право проверяется заново, поэтому задача, поставленная до блокировки, не обходит её. Уже отправленный провайдеру запрос может завершиться; отменить его задним числом нельзя.
- Перед сетью под PostgreSQL SELECT FOR UPDATE профиля резервируется слот в generation_reservations. Квота считает завершённые logs плюс незавершённые reservations. Транзакция освобождает lock до HTTP-вызова; API/Celery процессы не могут одновременно потратить один оставшийся слот.
- После вызова slot атомарно заменяется generation_log. При аварийной смерти процесса/недоступности финальной записи slot остаётся консервативно занятым на эти сутки; аналитика показывает in_flight_generations. Автоматического удаления таких слотов нет: сначала подтвердите отсутствие выполняющегося вызова и восстановите учёт доверенной операцией. Это исключает тихое превышение лимита.

## 4. Административный API

Канонический prefix — `/api/admin`. Для соответствия запрошенным путям оставлен alias `/admin`, с теми же permissions. Все запросы требуют обычный проверенный Supabase Bearer token пользователя с активной role=admin. Прямой service-role token не является заменой identity пользователя администратора.

| Метод | Путь | Параметры / действие |
|---|---|---|
| GET | /api/admin/analytics | date_from/date_to в YYYY-MM-DD; default последние 30 календарных дней, максимум 367 |
| GET | /api/admin/users | organization_id UUID, role, q (имя/email), limit 1..200, offset; items/total/limit/offset |
| PATCH | /api/admin/users/{user_id} | role, organization_id или null, is_active, subscription_until или null, daily_limit; опциональный reason |
| GET | /api/admin/organizations | Список колледжей |
| POST | /api/admin/organizations | name, необязательный is_active; 201 и созданный объект |
| GET | /api/admin/logs | Последние 100 записей; status=success/error, organization_id UUID |

PATCH сохраняет все изменения и audit одной транзакцией. Аудит отдельный для каждой изменившейся системной характеристики, с before/after и причиной. Неизвестная организация, неверная роль или отрицательный лимит отклоняются. Последнего активного admin нельзя отключить/понизить (409); параллельные административные изменения используют согласованный порядок блокировок.

Обычный GET/PUT /profile остаётся совместимым с текущим frontend: id/full_name/institution. Legacy UI может вернуть свой id в PUT, но он не является authority и должен совпасть с authenticated user. Попытки добавить role/email/is_active/subscription/daily_limit/storage_path в обычный profile PUT дают 422.

## 5. Аналитика и журналирование

GenerationLog фиксирует UUID вызова, user, organization на момент резервирования, agent/action, модель, actual duration_ms, статус и безопасный код ошибки. Prompt, содержимое ответа и API keys в generation_logs не сохраняются. OpenAI-compatible usage.total_tokens (или сумма prompt/completion) и Ollama prompt_eval_count+eval_count учитываются только при наличии корректных чисел. При отсутствии usage tokens_used=0, tokens_reported=false; это «нет данных о токенах», а не доказательство нулевой стоимости. Стоимость не выдумывается и не рассчитывается.

analytics возвращает total_users, enabled_users, active_24h/active_7d, total_generations/success/error, by_organization/by_agent/by_day, tokens_used_reported, generations_without_token_data и in_flight_generations. Активность — authenticated backend requests, обновляемая не чаще раза в минуту; это не импортированная историческая DAU. Старые данные не превращаются в вымышленные generation_logs. organization_id сохраняется в событии и не меняется при последующем переводе пользователя.

Для больших объёмов требуется отдельная нагрузочная проверка и дальнейшее масштабирование агрегаций; production performance в этом этапе не сертифицировалась.

## 6. Защита данных

Миграция оставляет обычным authenticated пользователям только owner SELECT для audit, generation logs и бизнес-таблиц; в profiles разрешены только UPDATE(full_name,institution). Прямые клиентские INSERT/UPDATE путей файлов и состояний генерации запрещены. Backend продолжает выполнять те же операции после проверки owner/permissions. Agent/admin/generation logs append-only: UPDATE/DELETE и TRUNCATE заблокированы grants и триггерами. Владение БД и DDL не должны выдаваться runtime; владелец БД принципиально может изменить сами защитные механизмы.

## 7. Проверки

Обычный локальный набор:

```sh
cd backend
.venv/bin/python -m pytest app/tests -p no:cacheprovider
```

Native security tests без специального URL будут skipped. Полный воспроизводимый запуск с новым одноразовым PostgreSQL кластером, ролями и синтетическими Supabase auth/storage схемами:

```sh
PG_BIN=/Library/PostgreSQL/18/bin bash backend/scripts/test_postgres.sh \
  --junitxml=../docs/backend-admin-test-results.xml --tb=short
```

Скрипт запускается из корня репозитория; PG_BIN на Linux укажите для своей установки PostgreSQL. Нужен непривилегированный пользователь ОС. Он не читает рабочий DATABASE_URL, слушает только Unix socket, применяет SQL только в новом disposable кластере и удаляет его после проверки. Тестовый conftest до импорта приложения очищает внешние credentials, выбирает memory SQLite для обычных тестов и не подключается к рабочим базам.

Подтверждённый итог: **64 passed, 0 skipped, 0 failures**, в том числе старые 17 тестов, новый RBAC/access/logging набор и 14 native PostgreSQL тестов. Проверены запреты прямого SQL изменения ролей/подписки/путей/audit, owner-read, безопасные profile edits, backfill/trigger Auth profiles, native UUID admin API/bootstrap и конкуренция четырёх worker за один слот. Есть один upstream DeprecationWarning Starlette/AnyIO; это не ошибка приложения.

Артефакт: docs/backend-admin-test-results.xml. Реальные Supabase SMTP/Auth credentials, облачная LLM, внешний Redis/Celery и production deployment в этих тестах не использовались.

## 8. Откат

До применения сохраните backup и предыдущую версию backend. Нельзя запускать старый runtime с новыми административными изменениями без проверки совместимости. При откате остановите API/worker, сохраните generation/admin audit, сверяйте незавершённые reservations. Не стирайте audit ради отката и не помечайте неизвестные вызовы успешными. Восстановление production БД — отдельная согласованная операция; destructive down-миграция автоматически не выполняется.

## 8. Дополнения для клиентской админ-панели

Реализован frontend `/admin`: [подключение и проверка](AI_EDU_2_FRONTEND_ADMIN.md). Прежний `/profile` и пользовательский PUT сохранены без системных полей. Новый authenticated `GET /profile/access` возвращает только собственный сериализованный профиль с ролью/доступом.

Все следующие read endpoints защищены прежним require_admin: `GET /api/admin/me` (текущий профиль), `GET /api/admin/audit?limit=100&offset=0` (реальные append-only записи с именами участников), существующие logs дополнены user_name/user_email/organization_name. Audit details сохраняет прежний формат `{field,before,after,reason}` — отдельная запись на изменённое поле.

Analytics дополнен `average_duration_ms` (null при отсутствии вызовов), `total_teachers` (teacher+methodist), `by_organization[].teachers` (текущий состав), `all_time=true` (история от первого реального generation_log до сегодня). all_time нельзя сочетать с date_from/date_to. По умолчанию прежние 30 дней и ограничение явного периода до 367 дней сохранены. GET organizations добавляет teachers_count, GET users — необязательный серверный фильтр is_active; фильтрация применяется перед count/пагинацией. Схема БД для этих read-дополнений не меняется.
