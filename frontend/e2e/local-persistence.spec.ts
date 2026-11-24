import { test, expect } from "@playwright/test";

test("local API persistence lists stable empty user-scoped history", async ({
  request,
}) => {
  const first = await request.get(
    (process.env.E2E_API_URL || "http://127.0.0.1:8000") + "/portfolio",
  );
  expect(first.status()).toBe(200);
  expect(Array.isArray(await first.json())).toBe(true);

  const lessons = await request.get(
    (process.env.E2E_API_URL || "http://127.0.0.1:8000") + "/lessons",
  );
  expect(lessons.status()).toBe(200);
  expect(Array.isArray(await lessons.json())).toBe(true);

  const second = await request.get(
    (process.env.E2E_API_URL || "http://127.0.0.1:8000") + "/portfolio",
  );
  expect(second.status()).toBe(200);
  expect(await first.json()).toEqual(await second.json());
});
