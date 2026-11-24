import { test, expect } from "@playwright/test";
test("home navigation reaches RUP, materials and history", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "РУП", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "РУП и темы", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Материалы", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Занятия", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "История", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История", exact: true }),
  ).toBeVisible();
});
