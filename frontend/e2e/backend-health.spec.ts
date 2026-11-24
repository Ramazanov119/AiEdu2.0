import { test, expect } from "@playwright/test";

test("API health and honest LLM status remain verifiable", async ({
  request,
}) => {
  const health = await request.get(
    (process.env.E2E_API_URL || "http://127.0.0.1:8000") + "/health",
  );
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    status: "ok",
    service: "ai-edu-2-api",
  });

  const llm = await request.get(
    (process.env.E2E_API_URL || "http://127.0.0.1:8000") + "/llm/status",
  );
  expect(llm.status()).toBe(200);
  const llmBody = await llm.json();
  expect(llmBody.available).toBe(false);
  expect(String(llmBody.error || "")).toContain("LLM");
});
