import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * @api: runs against a real-API build (`pnpm build` with NEXT_PUBLIC_USE_MOCKS=false) and a running API + seeded DB:
 *   pnpm e2e:api
 * Not part of the default (offline) suite.
 */

/** Seeded demo advocates sign in as +91 80000 00001 … in fixture order (services/api/scripts/seed.py). */
const advocates: Array<{ display_name: string }> = JSON.parse(
  readFileSync(join(__dirname, "../../../../services/api/app/fixtures/advocates.json"), "utf-8"),
);
function advocatePhone(name: string): string {
  const index = advocates.findIndex((a) => a.display_name === name);
  if (index < 0) throw new Error(`unknown advocate ${name}`);
  return `800000${String(index + 1).padStart(4, "0")}`;
}

/** SCREENSHOTS=1 saves the advocate-side screens for the Gate 3 report. */
async function shot(page: Page, name: string) {
  if (!process.env.SCREENSHOTS) return;
  await page.screenshot({
    path: join(__dirname, "../../../../docs/screenshots/phase3", `${name}.png`),
  });
}

async function signIn(page: Page, phone: string) {
  const sheet = page.getByTestId("otp-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Mobile number").fill(phone);
  await sheet.getByRole("button", { name: "Send code" }).click();
  await sheet.getByLabel("6-digit code").fill("000000");
  await expect(sheet).toBeHidden({ timeout: 15_000 });
}

test.describe("@api real backend", () => {
  test("search, sign in, see the real wallet, top up through the API", async ({ page }) => {
    test.setTimeout(90_000);
    const apiCalls = new Set<string>();
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.pathname.startsWith("/v1/"))
        apiCalls.add(`${r.method()} ${url.pathname.replace(/fake_order_\w+/, ":id")}`);
    });

    await page.goto("/en");
    const search = page.getByRole("textbox", { name: "Describe your legal problem" });
    await search.fill("My landlord is refusing to return my deposit in Lucknow");
    await search.press("Enter");
    await expect(page.getByRole("article")).toHaveCount(3, { timeout: 20_000 });

    await page
      .getByRole("button", { name: /^Connect with Demo/ })
      .first()
      .click();
    await signIn(page, "9000000001");
    await expect(page).toHaveURL(/\/samvaad\//, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Before you start" })).toBeVisible();
    // Leaving before the clock starts cancels the reservation and releases the hold.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).not.toHaveURL(/\/samvaad\//, { timeout: 15_000 });

    // Full reload: the session must come back from the httpOnly refresh cookie.
    await page.goto("/en/wallet");
    const balance = page.getByTestId("wallet-balance");
    await expect(balance).toBeVisible({ timeout: 15_000 });
    const before = Number((await balance.textContent())?.replace(/[^\d.]/g, ""));
    await page.getByRole("button", { name: /Add ₹200 with UPI/ }).click();
    await expect(page.getByText("₹200 added to your wallet")).toBeVisible({ timeout: 15_000 });
    await expect(balance).toHaveText(
      `₹${(before + 200).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
    );

    expect([...apiCalls]).toEqual(
      expect.arrayContaining([
        "POST /v1/parakh/match",
        "POST /v1/auth/otp/verify",
        "POST /v1/auth/refresh",
        "GET /v1/wallet",
        "POST /v1/wallet/topups",
        "POST /v1/dev/payments/:id/capture",
      ]),
    );
  });

  test("a client and an advocate consult over the real WebSocket and the bill is prorated", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const clientCtx = await browser.newContext();
    const advocateCtx = await browser.newContext();
    const client = await clientCtx.newPage();
    const advocate = await advocateCtx.newPage();

    // Client: search, connect, sign in → pre-flight.
    await client.goto("/en");
    const search = client.getByRole("textbox", { name: "Describe your legal problem" });
    await search.fill("Cheque bounce case in Lucknow, the cheque was dishonoured");
    await search.press("Enter");
    await expect(client.getByRole("article").first()).toBeVisible({ timeout: 20_000 });
    await client
      .getByRole("button", { name: /^Connect with Demo/ })
      .first()
      .click();
    // A fresh client each run (wallet starts at ₹0), so leftovers from earlier runs can't interfere.
    await signIn(client, `98${String(Date.now()).slice(-8)}`);
    // The wallet can't cover the 5-minute hold yet: top up through the sheet, as a client would.
    const addMoney = client.getByRole("button", { name: /^Add ₹\d+ with UPI/ });
    await expect(
      addMoney.or(client.getByRole("heading", { name: "Before you start" })),
    ).toBeVisible({ timeout: 20_000 });
    if (await addMoney.isVisible()) await addMoney.click();
    await expect(client).toHaveURL(/\/samvaad\//, { timeout: 20_000 });
    await expect(client.getByRole("heading", { name: "Before you start" })).toBeVisible();
    const advocateName =
      (
        await client.locator("header p.font-semibold span.truncate").first().textContent()
      )?.trim() ?? "";

    // Advocate: their desk shows the request (polled from Postgres).
    await advocate.goto("/en/advocate");
    await advocate.getByRole("button", { name: "Sign in" }).first().click();
    await signIn(advocate, advocatePhone(advocateName));
    const requests = advocate.getByTestId("advocate-requests");
    await expect(requests).toBeVisible({ timeout: 20_000 });
    await shot(advocate, "01-advocate-desk-request");

    // Client consents and starts; the advocate joins; billing starts when both are connected.
    await client.getByLabel(/Store this chat for the consultation/).check();
    await client.getByRole("button", { name: "Start paid session" }).click();
    await expect(requests.getByText("The client is ready. Join to start.")).toBeVisible({
      timeout: 20_000,
    });
    await requests.getByRole("link", { name: "Join" }).first().click();
    await expect(client.getByText(/joined · billing started/)).toBeVisible({ timeout: 20_000 });
    await expect(advocate.getByTestId("earned-chip")).toBeVisible({ timeout: 20_000 });
    await shot(advocate, "02-advocate-desk-joined");

    // Chat both ways.
    await client
      .getByRole("textbox", { name: /^Message Demo/ })
      .fill("Hello, I received a notice about a cheque.");
    await client.keyboard.press("Enter");
    await expect(advocate.getByText("Hello, I received a notice about a cheque.")).toBeVisible({
      timeout: 10_000,
    });
    await advocate
      .getByRole("textbox", { name: /^Message/ })
      .fill("Namaste. When was the cheque returned?");
    await advocate.keyboard.press("Enter");
    await expect(client.getByText("Namaste. When was the cheque returned?")).toBeVisible({
      timeout: 10_000,
    });
    await shot(client, "03-client-live-room");
    await shot(advocate, "04-advocate-live-room");

    // The client ends it: the summary is prorated to the second, and the advocate sees it end too.
    await client.getByRole("button", { name: "End session" }).first().click();
    await client.getByTestId("end-sheet").getByRole("button", { name: "End session" }).click();
    const summary = client.getByTestId("summary-sheet");
    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect(summary.getByText("Time used")).toBeVisible();
    await expect(summary.getByText(/Charged to the second/)).toBeVisible();
    await expect(advocate.getByTestId("advocate-summary")).toBeVisible({ timeout: 20_000 });
    await shot(client, "05-client-prorated-summary");
    await shot(advocate, "06-advocate-ended");

    await advocate.getByRole("link", { name: "Back to your consultations" }).click();
    await expect(advocate.getByTestId("advocate-payable")).toBeVisible({ timeout: 15_000 });
    await shot(advocate, "07-advocate-desk-earnings");
    await clientCtx.close();
    await advocateCtx.close();
  });
});
