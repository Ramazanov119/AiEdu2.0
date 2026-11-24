import { test, expect, type Page } from "@playwright/test";
// Synthetic browser fixtures only. No request is sent to real Supabase or production API.
const id = "00000000-0000-4000-8000-000000000001",
  orgId = "00000000-0000-4000-8000-000000000002";
const profile = {
  id,
  email: "owner@example.invalid",
  full_name: "Администратор",
  institution: null,
  role: "admin",
  organization_id: null,
  is_active: true,
  subscription_until: null,
  daily_limit: 20,
  created_at: "2026-11-01T00:00:00Z",
  last_active_at: null,
};
async function fixture(page: Page, role = "admin") {
  const user = {
    ...profile,
    id: "00000000-0000-4000-8000-000000000003",
    email: "teacher@example.invalid",
    full_name: "Анна Иванова",
    role: "teacher",
    organization_id: orgId,
    generations_today: 4,
    generations_total: 28,
  };
  const organizations = [
    {
      id: orgId,
      name: "ЕТЭК",
      is_active: true,
      created_at: profile.created_at,
      teachers_count: 1,
    },
  ];
  const state = {
    role,
    fail: false,
    deny: false,
    patches: [] as Record<string, unknown>[],
    requests: [] as string[],
    audits: [] as object[],
  };
  const token =
    [
      { alg: "HS256", typ: "JWT" },
      {
        sub: id,
        aud: "authenticated",
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
      .join(".") + ".test-signature";
  const authUser = {
    id,
    email: profile.email,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: profile.created_at,
  };
  await page.route("http://127.0.0.1:54329/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/token")) {
      const payload = route.request().postDataJSON();
      if (payload.password === "bad-password")
        return route.fulfill({
          status: 400,
          json: {
            error: "invalid_grant",
            error_description: "Invalid login credentials",
          },
        });
      return route.fulfill({
        json: {
          access_token: token,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "synthetic-refresh",
          user: authUser,
        },
      });
    }
    return route.fulfill({
      status: url.pathname.includes("/logout") ? 204 : 200,
      ...(!url.pathname.includes("/logout") ? { json: authUser } : {}),
    });
  });
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    state.requests.push(path + url.search);
    if (path.startsWith("/api/admin/") || path === "/profile/access")
      expect(req.headers().authorization).toBe("Bearer " + token);
    if (path === "/profile/access")
      return route.fulfill({ json: { ...profile, role: state.role } });
    if (path === "/profile")
      return route.fulfill({
        json: { id, full_name: profile.full_name, institution: null },
      });
    if (!path.startsWith("/api/admin/")) return route.fulfill({ json: [] });
    if (state.role !== "admin" || state.deny)
      return route.fulfill({
        status: 403,
        json: { detail: "Нет прав администратора" },
      });
    if (path.endsWith("/me")) return route.fulfill({ json: profile });
    if (path.endsWith("/analytics")) {
      if (state.fail)
        return route.fulfill({
          status: 503,
          json: { detail: "Временно недоступно" },
        });
      return route.fulfill({
        json: {
          date_from: "2026-11-01",
          date_to: "2026-11-23",
          timezone: "Asia/Almaty",
          all_time: url.searchParams.has("all_time"),
          total_users: 13,
          total_teachers: 12,
          enabled_users: 13,
          active_24h: 8,
          active_7d: 11,
          total_generations: 42,
          success: 40,
          error: 2,
          average_duration_ms: 2450,
          tokens_used_reported: 1000,
          generations_without_token_data: 0,
          in_flight_generations: 0,
          by_organization: [
            {
              organization_id: orgId,
              name: "ЕТЭК",
              teachers: 12,
              generations: 42,
              success: 40,
              error: 2,
            },
          ],
          by_agent: {
            coordinator: 20,
            methodist: 12,
            creative: 7,
            assessment: 3,
          },
          by_day: Array.from({ length: 23 }, (_, i) => ({
            date: `2026-11-${String(i + 1).padStart(2, "0")}`,
            generations: i < 19 ? 2 : 1,
            success: (i < 19 ? 2 : 1) - (i < 2 ? 1 : 0),
            error: i < 2 ? 1 : 0,
          })),
        },
      });
    }
    if (path.endsWith("/organizations")) {
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        organizations.push({
          id: "new-org",
          ...body,
          created_at: profile.created_at,
          teachers_count: 0,
        });
        return route.fulfill({ status: 201, json: organizations.at(-1) });
      }
      return route.fulfill({ json: organizations });
    }
    if (req.method() === "PATCH") {
      const body = req.postDataJSON();
      state.patches.push(body);
      Object.assign(user, body);
      state.audits.push({
        id: "audit-1",
        admin_id: id,
        admin_name: profile.full_name,
        target_user_id: user.id,
        target_user_name: user.full_name,
        action: "change_daily_limit",
        details: {
          field: "daily_limit",
          before: 20,
          after: body.daily_limit,
          reason: body.reason,
        },
        created_at: profile.created_at,
      });
      return route.fulfill({ json: user });
    }
    if (path.endsWith("/users")) {
      const q = url.searchParams.get("q"),
        active = url.searchParams.get("is_active");
      const items =
        (!q || user.full_name.includes(q) || user.email.includes(q)) &&
        (active === null || String(user.is_active) === active)
          ? [user]
          : [];
      return route.fulfill({
        json: { items, total: items.length, limit: 20, offset: 0 },
      });
    }
    if (path.endsWith("/audit")) return route.fulfill({ json: state.audits });
    if (path.endsWith("/logs"))
      return route.fulfill({
        json: [
          {
            id: "log1",
            user_id: user.id,
            user_name: user.full_name,
            user_email: user.email,
            organization_id: orgId,
            organization_name: "ЕТЭК",
            agent_type: "methodist",
            action_type: "plan",
            model_name: "fixture-model",
            duration_ms: 1234,
            tokens_reported: false,
            tokens_used: 0,
            status: "error",
            error_message: "Синтетическая ошибка API",
            created_at: profile.created_at,
          },
        ],
      });
    return route.fulfill({
      status: 404,
      json: { detail: "Missing test fixture" },
    });
  });
  return state;
}
async function login(page: Page) {
  await page.goto("/admin");
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.getByLabel("Email", { exact: true }).fill(profile.email);
  await page.getByLabel("Пароль", { exact: true }).fill("test-password");
  await page
    .getByRole("button", { name: "Войти в админ-панель", exact: true })
    .click();
}
test("teacher denied; invalid password and logout work", async ({ page }) => {
  const state = await fixture(page, "teacher");
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill(profile.email);
  await page.getByLabel("Пароль", { exact: true }).fill("bad-password");
  await page
    .getByRole("button", { name: "Войти в админ-панель", exact: true })
    .click();
  await expect(
    page.getByText(
      "Не удалось войти. Проверьте данные и доступность Supabase.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel("Пароль", { exact: true }).fill("test-password");
  await page
    .getByRole("button", { name: "Войти в админ-панель", exact: true })
    .click();
  await expect(
    page.getByText("У этой учётной записи нет прав администратора", {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.requests.some((p) => p.includes("analytics"))).toBe(false);
  await expect(
    page.getByRole("link", { name: "Вернуться в рабочее пространство" }),
  ).toHaveAttribute("href", "/");
  await page
    .getByRole("button", { name: "Выйти / Войти под другим аккаунтом" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Вход в админ-панель" }),
  ).toBeVisible();
});
test("analytics, filters, access changes, organizations and actual audit shape", async ({
  page,
}) => {
  const state = await fixture(page);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Обзор платформы" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Динамика генераций" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../docs/admin-ui/overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Всё время", exact: true }).click();
  await expect
    .poll(() => state.requests.some((p) => p.includes("all_time=true")))
    .toBe(true);
  await page
    .getByRole("button", { name: "Пользователи и доступы", exact: true })
    .click();
  await expect(page.getByText("Анна Иванова", { exact: true })).toBeVisible();
  await page.getByLabel("Статус аккаунта").selectOption("false");
  await expect(
    page.getByText("Пользователи не найдены", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => state.requests.some((p) => p.includes("is_active=false")))
    .toBe(true);
  await page.getByLabel("Статус аккаунта").selectOption("");
  await page
    .getByRole("button", { name: "Изменить доступ: Анна Иванова" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "+30 дней", exact: true }).click();
  await dialog.getByRole("button", { name: "Бессрочно", exact: true }).click();
  await dialog.getByLabel("Дневной лимит генераций").fill("0");
  await dialog.getByLabel("Доступ включён", { exact: true }).uncheck();
  await dialog.getByLabel("Причина изменения").fill("Проверка сохранения");
  await page.screenshot({
    path: "../docs/admin-ui/user-editor.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.patches).toEqual([
    { daily_limit: 0, is_active: false, reason: "Проверка сохранения" },
  ]);
  await expect(
    page.getByRole("table").getByText("Заблокирован", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Колледжи", exact: true }).click();
  await page.getByLabel("Название колледжа").fill("Тестовый колледж");
  await page
    .getByRole("button", { name: "Добавить колледж", exact: true })
    .click();
  await expect(
    page.getByText("Тестовый колледж", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Журнал и аудит", exact: true })
    .click();
  await page.getByText("Текст ошибки", { exact: true }).click();
  await expect(
    page.getByText("Синтетическая ошибка API", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Аудит действий админа" }).click();
  await expect(page.getByText("Дневной лимит:")).toBeVisible();
  await expect(page.getByText("20 → 0", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Вход в админ-панель" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).not.toBeVisible();
});
test("API failure retries and revoked permissions remove data", async ({
  page,
}) => {
  const state = await fixture(page);
  state.fail = true;
  await login(page);
  await expect(
    page.getByText("Временно недоступно", { exact: true }),
  ).toBeVisible();
  state.fail = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Динамика генераций" }),
  ).toBeVisible();
  state.deny = true;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(
    page.getByText("У этой учётной записи нет прав администратора", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Динамика генераций" }),
  ).not.toBeVisible();
});
test("mobile layout, keyboard dialog dismissal, workspace admin link", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Динамика генераций" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../docs/admin-ui/mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Пользователи и доступы", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Изменить доступ: Анна Иванова" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await page.locator(".profile-button").click();
  await expect(
    page.getByRole("link", { name: "Админ-панель", exact: true }),
  ).toBeVisible();
});
test("subscription date, roles, college detach and reset serialize correctly", async ({
  page,
}) => {
  const state = await fixture(page);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Обзор платформы" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Пользователи и доступы", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Изменить доступ: Анна Иванова" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "+90 дней", exact: true }).click();
  await expect(dialog.getByLabel("Подписка действует до")).not.toHaveValue("");
  await dialog.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(dialog.getByLabel("Подписка действует до")).toHaveValue("");
  await dialog.getByLabel("Подписка действует до").fill("2027-02-20");
  await dialog.getByLabel("Роль", { exact: true }).selectOption("methodist");
  await dialog.getByLabel("Официальный колледж").selectOption("");
  await dialog.getByLabel("Причина изменения").fill("Подтверждённая подписка");
  await dialog.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.patches).toEqual([
    {
      role: "methodist",
      organization_id: null,
      subscription_until: "2027-02-20T18:59:59.999Z",
      reason: "Подтверждённая подписка",
    },
  ]);
});
test("teacher workspace has no admin link", async ({ page }) => {
  await fixture(page, "teacher");
  await login(page);
  await expect(
    page.getByText("У этой учётной записи нет прав администратора", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/");
  await page.locator(".profile-button").click();
  await expect(
    page.getByRole("link", { name: "Админ-панель", exact: true }),
  ).not.toBeVisible();
});
