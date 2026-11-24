import { test, expect } from "@playwright/test";
test("demo is explicit, opens GPU scene and supports agent panels without API writes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Демо", exact: true }).click();
  await expect(
    page.getByText("Демонстрационный режим", { exact: true }),
  ).toBeVisible();
  const writes: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() !== "GET" &&
      r.url().includes(process.env.E2E_API_URL || ":8000")
    )
      writes.push(r.url());
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Виртуальный офис", exact: true })
    .click();
  await expect(page.getByTestId("office-scene")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator("canvas")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Открыть агента Методист", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Методист", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Закрыть панель агента" }).click();
  await page.getByRole("button", { name: "Со мной", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Сообщение команде" })
    .fill("Подготовьте комплект");
  await page.getByRole("button", { name: "Отправить сообщение" }).click();
  await expect(
    page.getByText("Демонстрация: сообщение не отправлено backend.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
test("mobile layout fits viewport and reduced-motion mode is respected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Демо", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Виртуальный офис", exact: true })
    .click();
  await expect(page.getByTestId("office-scene")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await page
            .getByTestId("office-scene")
            .getAttribute("data-metrics")) || "{}",
        ).mode,
    )
    .toBe("reduced");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("material editor keeps keyboard focus through React updates", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Демо", exact: true }).click();
  await page
    .getByRole("button", { name: "Просмотреть", exact: true })
    .first()
    .click();
  const editor = page.getByRole("textbox", { name: "Содержимое материала" });
  await editor.fill("");
  await editor.pressSequentially("Новая версия материала");
  await expect(editor).toHaveValue("Новая версия материала");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("office recovers its own canvas after a context-loss event", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Демо", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Виртуальный офис", exact: true })
    .click();
  await expect(page.getByTestId("office-scene")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page
    .locator("canvas")
    .evaluate((canvas) =>
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
    );
  await expect(
    page.getByRole("alert").filter({ hasText: "Графический контекст потерян" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Восстановить", exact: true }).click();
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(
    page.getByRole("alert").filter({ hasText: "Графический контекст потерян" }),
  ).toHaveCount(0);
});
