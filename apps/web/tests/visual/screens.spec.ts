import { expect, test } from "@playwright/test";

/** Pixel baselines for the screens whose look matters most. Live data (times, news) is masked. */
const SCREENS = [
  { name: "home", path: "/en", ready: "Tell us what happened." },
  { name: "updates", path: "/en/updates", ready: "Legal updates" },
  { name: "analysis", path: "/en/saransh", ready: "Upload a legal document" },
  { name: "terms", path: "/en/terms", ready: "Terms of Use" },
] as const;

for (const screen of SCREENS) {
  test(`${screen.name} looks as it did`, async ({ page }) => {
    await page.goto(screen.path);
    await expect(page.getByText(screen.ready).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${screen.name}.png`, {
      fullPage: true,
      // Relative times and the WebGL hero differ run to run.
      mask: [page.locator("time"), page.locator("canvas")],
    });
  });
}
