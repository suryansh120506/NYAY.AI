import { expect, test } from "@playwright/test";
import {
  composer,
  connectFirst,
  devControl,
  pickCity,
  searchFromHome,
  startSession,
  walletChip,
} from "./helpers";

/**
 * Brief §5 happy path on the offline mocks:
 * hero search → follow-up → match → OTP → pre-flight → live chat → low-balance top-up (no disconnect)
 * → termination at zero balance → summary.
 */

// Shortened billed minutes for the demo clock (docs/ASSUMPTIONS.md A23).
const MINUTE_MS = 2_500;

test("hero search to a settled consultation", async ({ page }) => {
  test.setTimeout(120_000);

  // ---- Home → Parakh, one follow-up question as chips
  await searchFromHome(page);
  await pickCity(page, "Lucknow");
  await expect(
    page.getByRole("heading", { name: /verified advocates? for tenancy matters in Lucknow/ }),
  ).toBeVisible();
  // Regulatory guardrail: no superlatives or scores on cards.
  await expect(page.getByText(/\b(best|top|win rate|guarantee)/i)).toHaveCount(0);

  // ---- Connect → progressive sign-in → reserve → pre-flight
  await connectFirst(page, MINUTE_MS);
  await expect(page.getByText("Total per minute")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start paid session" })).toBeDisabled();

  // ---- Advocate joins, billing starts, chat is live and optimistic
  await startSession(page);
  await expect(walletChip(page)).toBeVisible();
  await composer(page).fill("Hello, I need help getting my deposit back.");
  await composer(page).press("Enter");
  await expect(page.getByText("Hello, I need help getting my deposit back.")).toBeVisible();
  await expect(page.getByTestId("message-status")).toHaveText("Sent");
  await expect(page.getByText(/^Namaste, I'm /)).toBeVisible({ timeout: 10_000 });

  // ---- Low balance → top up inside the room (socket stays up)
  await devControl(page, "low");
  const lowSheet = page.getByTestId("low-balance-sheet");
  await expect(lowSheet).toBeVisible();
  await expect(walletChip(page)).not.toHaveAttribute("data-tone", "normal");
  await lowSheet.getByRole("button", { name: "Add ₹200 with UPI" }).click();
  await expect(page.getByText("₹200 added to your wallet")).toBeVisible({ timeout: 10_000 });
  await expect(lowSheet).toBeHidden();
  await expect(walletChip(page)).toHaveAttribute("data-tone", "normal");
  await expect(page.getByText("Reconnecting…")).toHaveCount(0);

  // ---- Run the balance down: warning again, then termination at zero
  await devControl(page, "low");
  await expect(lowSheet).toBeVisible();
  await lowSheet.getByRole("button", { name: "Close" }).click();
  const summary = page.getByTestId("summary-sheet");
  await expect(summary).toBeVisible({ timeout: 20_000 });
  await expect(summary.getByText("Your balance ran out, so the session ended.")).toBeVisible();
  await expect(summary.getByTestId("session-summary")).toBeVisible();
  await expect(summary.getByText("Returned to your wallet")).toBeVisible();
  await expect(summary.getByRole("button", { name: "Top up and continue" })).toBeVisible();

  // ---- Optional rating
  await summary.getByRole("radio", { name: "4 stars" }).click();
  await summary.getByRole("button", { name: "Send rating" }).click();
  await expect(summary.getByText("Thank you for the feedback.")).toBeVisible();
});
