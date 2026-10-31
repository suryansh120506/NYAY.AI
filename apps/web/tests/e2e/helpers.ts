import { expect, type Locator, type Page } from "@playwright/test";

export const QUERY = "My landlord is refusing to return my deposit";

/** The header renders the chip in a desktop slot and a phone row; only one is visible at a time. */
export const walletChip = (page: Page) => page.locator('[data-testid="wallet-chip"]:visible');

export async function devControl(page: Page, id: "drop" | "fail" | "low") {
  const panel = page.locator("details", { hasText: "Demo controls" });
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click();
  await page.getByTestId(`dev-${id}`).click();
}

/** Fake OTP provider: any valid Indian mobile number, code 000000. */
export async function signIn(page: Page, phone = "9876543210") {
  const sheet = page.getByTestId("otp-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Mobile number").fill(phone);
  await sheet.getByRole("button", { name: "Send code" }).click();
  await sheet.getByLabel("6-digit code").fill("000000");
  await expect(sheet).toBeHidden();
}

export async function searchFromHome(page: Page, query = QUERY) {
  await page.goto("/en");
  const search = page.getByRole("textbox", { name: "Describe your legal problem" });
  await search.fill(query);
  await search.press("Enter");
  await expect(page).toHaveURL(/\/en\/parakh\?q=/);
}

export async function pickCity(page: Page, city = "Lucknow") {
  await expect(page.getByRole("heading", { name: "Which city is this in?" })).toBeVisible();
  await page.getByRole("button", { name: city }).click();
  await expect(page.getByRole("article")).toHaveCount(3);
}

/** From results to a reserved session's pre-flight card, signing in on the way. */
export async function connectFirst(page: Page, minuteMs?: number) {
  await page
    .getByRole("button", { name: /^Connect with Demo/ })
    .first()
    .click();
  await signIn(page);
  await expect(page).toHaveURL(/\/en\/samvaad\/sess_/);
  if (minuteMs) await page.goto(`${page.url()}?mockMinuteMs=${minuteMs}`);
  await expect(page.getByRole("heading", { name: "Before you start" })).toBeVisible();
}

export async function startSession(page: Page) {
  await page.getByLabel(/Store this chat for the consultation/).check();
  await page.getByRole("button", { name: "Start paid session" }).click();
  await expect(page.getByText(/joined · billing started/)).toBeVisible({ timeout: 15_000 });
}

export function composer(page: Page) {
  return page.getByRole("textbox", { name: /^Message Demo/ });
}

/** An element's background as `rgb(r, g, b)`, whatever colour space the token is written in (OKLCH computes as oklch()). */
export function backgroundRgb(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!ctx) return getComputedStyle(el).backgroundColor;
    ctx.fillStyle = getComputedStyle(el).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  });
}
