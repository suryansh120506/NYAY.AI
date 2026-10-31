import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { connectFirst, pickCity, searchFromHome, startSession } from "./helpers";

/** Brief §3.1 / §3.5: WCAG 2.2 AA, no horizontal scroll at 375 / 768 / 1280, reduced motion, keyboard, Hindi. */

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary).toEqual([]);
}

test.describe("accessibility (axe, WCAG 2.2 AA)", () => {
  test("home, results, pre-flight and the live room", async ({ page }) => {
    test.setTimeout(120_000);
    // Check contrast on the settled UI, not on cards caught halfway through their fade-in.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en");
    await expectNoAxeViolations(page);
    await page.goto("/hi");
    await expectNoAxeViolations(page);
    await searchFromHome(page);
    await pickCity(page);
    await expectNoAxeViolations(page);
    await connectFirst(page, 30_000);
    await expectNoAxeViolations(page);
    await startSession(page);
    await expectNoAxeViolations(page);
  });

  test("updates and wallet", async ({ page }) => {
    await page.goto("/en/updates");
    await expectNoAxeViolations(page);
    await page.goto("/en/wallet");
    await expectNoAxeViolations(page);
  });
});

test.describe("responsive", () => {
  for (const width of [375, 768, 1280]) {
    test(`no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        "/en",
        "/hi",
        "/en/updates",
        "/en/wallet",
        "/en/parakh?q=landlord+deposit+lucknow",
      ]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });
  }
});

test.describe("motion", () => {
  test("the hero placeholder never rotates, with or without reduced motion", async ({ page }) => {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ reducedMotion });
      await page.goto("/en");
      const placeholder = page.locator("form[role=search] span[aria-hidden] span");
      await expect(placeholder).toHaveCount(1);
      const first = await placeholder.textContent();
      await page.waitForTimeout(4_600);
      expect(await placeholder.textContent()).toBe(first);
    }
  });
});

test.describe("keyboard", () => {
  test("skip link, search by keyboard, and sheets close with Escape", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium");
    await page.goto("/en");
    await page.keyboard.press("Tab");
    // Headless Chromium spends the first Tab moving focus into the document.
    if (await page.evaluate(() => document.activeElement === document.body))
      await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.getByRole("button", { name: "Sign in" }).focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByTestId("otp-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Mobile number")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    const search = page.getByRole("textbox", { name: "Describe your legal problem" });
    await search.focus();
    await page.keyboard.type("Cheque bounce in Delhi");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/parakh/);
    // The city was in the query, so there is no follow-up question.
    await expect(
      page.getByRole("heading", { name: /verified advocates? for cheque bounce matters in Delhi/ }),
    ).toBeVisible();
  });
});

test.describe("Hindi", () => {
  test("the whole Parakh flow speaks Hindi", async ({ page }) => {
    await page.goto("/hi");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("बताइए, क्या हुआ।");
    const search = page.getByRole("textbox", { name: "अपनी क़ानूनी समस्या बताइए" });
    await search.fill("मेरे चेक का भुगतान नहीं हुआ");
    await expect(search).toHaveAttribute("lang", "hi");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "यह किस शहर का मामला है?" })).toBeVisible();
    await page.getByRole("button", { name: "लखनऊ" }).click();
    await expect(
      page.getByRole("heading", { name: /लखनऊ में चेक बाउंस मामलों के लिए/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /से जुड़ें$/ }).first()).toBeVisible();
  });

  test("switching language keeps the page and the query", async ({ page }) => {
    await page.goto("/en/parakh?q=landlord+deposit+lucknow");
    await page.getByRole("link", { name: "हिन्दी" }).click();
    await expect(page).toHaveURL(/\/hi\/parakh\?q=landlord/);
  });
});
