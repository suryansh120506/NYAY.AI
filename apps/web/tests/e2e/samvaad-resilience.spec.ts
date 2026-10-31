import { expect, test } from "@playwright/test";
import {
  composer,
  connectFirst,
  devControl,
  pickCity,
  searchFromHome,
  startSession,
} from "./helpers";

/** Optimistic chat under bad networks (brief §3.1, §3.3): the composer never blocks on the network. */
test.describe("Samvaad resilience", () => {
  // Each scenario waits through a simulated outage (≈4 s + backoff) or the 8 s ack timeout on top of the setup.
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await searchFromHome(page);
    await pickCity(page);
    await connectFirst(page, 30_000);
    await startSession(page);
  });

  test("keeps accepting messages while reconnecting and flushes the outbox", async ({ page }) => {
    await devControl(page, "drop");
    await expect(page.getByText(/Reconnecting…/)).toBeVisible();
    await composer(page).fill("Sent while the connection was down");
    await composer(page).press("Enter");
    const bubble = page.getByText("Sent while the connection was down");
    await expect(bubble).toBeVisible();
    await expect(page.getByTestId("message-status")).toHaveText("Sending…");
    // The simulated outage lasts ~4 s; backoff reconnects and the outbox is resent and acked.
    await expect(page.getByTestId("message-status")).toHaveText("Sent", { timeout: 15_000 });
    await expect(page.getByText(/Reconnecting…/)).toHaveCount(0);
    await expect(bubble).toHaveCount(1);
  });

  test("marks an unacknowledged message failed and retries it", async ({ page }) => {
    await devControl(page, "fail");
    await composer(page).fill("This one gets lost");
    await composer(page).press("Enter");
    const retry = page.getByRole("button", { name: /Failed · Tap to retry/ });
    await expect(retry).toBeVisible({ timeout: 12_000 });
    await retry.click();
    await expect(page.getByTestId("message-status")).toHaveText("Sent", { timeout: 5_000 });
    await expect(page.getByText("This one gets lost")).toHaveCount(1);
  });

  test("ends on request after confirmation and shows the itemised summary", async ({ page }) => {
    await page.locator("button:visible", { hasText: "End session" }).first().click();
    const confirm = page.getByTestId("end-sheet");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "End session" }).click();
    const summary = page.getByTestId("summary-sheet");
    await expect(summary).toBeVisible();
    await expect(summary.getByText("You ended the session.")).toBeVisible();
    await expect(summary.getByText("Time used")).toBeVisible();
    await expect(summary.getByRole("link", { name: "Back to home" })).toBeVisible();
    await expect(composer(page)).toBeDisabled();
  });
});
