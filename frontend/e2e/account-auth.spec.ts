import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const state = { failRegistration: false };
  await page.route("http://127.0.0.1:54329/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push({ path, body: route.request().postDataJSON() ?? {} });
    if (path.endsWith("/signup") && !state.failRegistration) {
      return route.fulfill({ json: {
        id: "00000000-0000-4000-8000-000000000001", email: "teacher@example.invalid",
        aud: "authenticated", created_at: "2026-11-24T00:00:00Z", identities: [],
        app_metadata: {}, user_metadata: {},
      } });
    }
    return route.fulfill({ status: 400, json: {
      code: path.endsWith("/signup") ? "unexpected_failure" : "invalid_credentials",
      msg: path.endsWith("/signup") ? "Database error saving new user" : "Invalid login credentials",
    } });
  });
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/portfolio/upload") return route.fulfill({ status: 502, json: { detail: "Загрузка в хранилище: bucket portfolio-private не найден" } });
    if (path === "/profile") return route.fulfill({ json: {} });
    if (path === "/llm/status") return route.fulfill({ json: { available: false } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  return { calls, state };
}

async function openAccount(page: Page) {
  await page.locator(".profile-button").click();
  return page.getByRole("dialog", { name: "Ваш аккаунт", exact: true });
}

test("login has only credentials and displays Supabase errors inside modal", async ({ page }) => {
  const { calls } = await fixture(page);
  const modal = await openAccount(page);
  await expect(modal.getByLabel("ФИО преподавателя")).toHaveCount(0);
  await expect(modal.getByLabel("Колледж")).toHaveCount(0);
  await modal.getByLabel("Email", { exact: true }).fill("teacher@example.invalid");
  // Existing accounts are not subjected to a new registration password length rule.
  await modal.getByLabel("Пароль", { exact: true }).fill("old");
  await modal.getByRole("button", { name: "Войти в аккаунт", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("Проверьте email и пароль");
  await expect(modal.getByRole("alert")).toContainText("Invalid login credentials");
  expect(calls.find((call) => call.path.endsWith("/token"))?.body).toMatchObject({ email: "teacher@example.invalid", password: "old" });
});

test("registration requires name, defaults to ETEC and sends full_name and college metadata", async ({ page }) => {
  const { calls } = await fixture(page);
  const modal = await openAccount(page);
  await modal.getByRole("button", { name: "Регистрация", exact: true }).click();
  await expect(modal.getByRole("combobox", { name: "Колледж", exact: true })).toHaveValue("ETEC");
  await expect(modal.getByRole("combobox", { name: "Колледж", exact: true }).locator("option")).toHaveText(["ETEC", "META", "ALT", "Q", "ATKK"]);
  await modal.getByLabel("Email", { exact: true }).fill("teacher@example.invalid");
  await modal.getByLabel("Пароль", { exact: true }).fill("test-password");
  await modal.getByRole("button", { name: "Создать аккаунт" }).click();
  expect(calls.filter((call) => call.path.endsWith("/signup"))).toHaveLength(0);
  await modal.getByLabel("ФИО преподавателя").fill("   ");
  await modal.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(modal.getByRole("alert")).toContainText("Укажите ФИО");
  await modal.getByLabel("ФИО преподавателя").fill(" Анна Иванова ");
  await modal.getByRole("combobox", { name: "Колледж", exact: true }).selectOption("META");
  await modal.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(modal.getByRole("status")).toContainText("подтвердите email");
  expect(calls.find((call) => call.path.endsWith("/signup"))?.body).toMatchObject({
    email: "teacher@example.invalid", password: "test-password",
    data: { full_name: "Анна Иванова", college: "META" },
  });
});

test("registration reports DB trigger failure without closing the modal", async ({ page }) => {
  const { state } = await fixture(page);
  state.failRegistration = true;
  const modal = await openAccount(page);
  await modal.getByRole("button", { name: "Регистрация", exact: true }).click();
  await modal.getByLabel("ФИО преподавателя").fill("Анна Иванова");
  await modal.getByLabel("Email", { exact: true }).fill("teacher@example.invalid");
  await modal.getByLabel("Пароль", { exact: true }).fill("test-password");
  await modal.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(modal.getByRole("alert")).toContainText("Database error saving new user");
  await expect(modal.getByLabel("ФИО преподавателя")).toHaveValue("Анна Иванова");
  await page.screenshot({ path: "test-results/auth/registration-error.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(modal.getByRole("alert")).toBeVisible();
  await page.screenshot({ path: "test-results/auth/registration-mobile.png", fullPage: true });
});

test("RUP error includes server reason and survives background refresh", async ({ page }) => {
  await fixture(page);
  await page.getByRole("navigation").getByRole("button", { name: "РУП", exact: true }).click();
  await page.getByLabel("Загрузить файл РУП").setInputFiles({ name: "rup.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic") });
  const error = page.locator(".upload-feedback");
  await expect(error).toContainText("HTTP 502");
  await expect(error).toContainText("bucket portfolio-private не найден");
  await page.waitForTimeout(6500);
  await expect(error).toBeVisible();
});
