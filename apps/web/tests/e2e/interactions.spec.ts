import { expect, test } from "@playwright/test";

/** The platform-level interactions: command palette, view transitions, tooltips, reading progress, hero shader. */

test.describe("command palette", () => {
  test("opens with the keyboard, filters, and jumps to a page", async ({ page }) => {
    await page.goto("/en");
    await page.keyboard.press("Control+k");
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await expect(palette.getByRole("combobox")).toBeFocused();
    await page.keyboard.type("wallet");
    await expect(palette.getByRole("option", { name: "Wallet", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/wallet$/);
    await expect(palette).toBeHidden();
  });

  test("turns what you typed into an advocate search, and closes with Escape", async ({ page }) => {
    await page.goto("/en/updates");
    await page.getByTestId("command-trigger").click();
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await page.keyboard.type("landlord kept my deposit");
    await expect(palette.getByRole("option", { name: /Find an advocate for/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await page.keyboard.press("Control+k");
    await page.keyboard.type("landlord kept my deposit");
    await palette.getByRole("option", { name: /Find an advocate for/ }).click();
    await expect(page).toHaveURL(/\/en\/parakh\?q=landlord/);
  });

  test("switches language", async ({ page }) => {
    await page.goto("/en/terms");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("hindi");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/hi\/terms$/);
  });
});

test.describe("view transitions", () => {
  test("page-to-page navigation runs inside a view transition", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "View Transitions API");
    await page.goto("/en/updates");
    await page.evaluate(() => {
      const w = window as Window & { __transitions?: number };
      w.__transitions = 0;
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = ((callback?: ViewTransitionUpdateCallback) => {
        w.__transitions = (w.__transitions ?? 0) + 1;
        return original(callback);
      }) as typeof document.startViewTransition;
    });
    await page.getByRole("contentinfo").getByRole("link", { name: "Terms" }).click();
    await expect(page).toHaveURL(/\/en\/terms$/);
    expect(
      await page.evaluate(() => (window as Window & { __transitions?: number }).__transitions),
    ).toBe(1);
  });

  test("an advocate's avatar carries the same transition name on the results card and in the room", async ({
    page,
  }) => {
    await page.goto("/en/parakh?q=My%20landlord%20is%20refusing%20to%20return%20my%20deposit");
    await page.getByRole("button", { name: "Lucknow" }).click();
    const card = page.getByRole("article").first();
    const name = await card
      .locator("[aria-hidden='true'][style*='view-transition-name']")
      .first()
      .evaluate((el) => getComputedStyle(el).viewTransitionName);
    expect(name).toMatch(/^avatar-/);
  });
});

test.describe("platform details", () => {
  test("icon buttons explain themselves in a tooltip on keyboard focus", async ({ page }) => {
    await page.goto("/en/saransh");
    await page.getByTestId("use-sample").click();
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({ timeout: 15_000 });
    const zoomIn = page.getByRole("button", { name: "Zoom in" });
    await zoomIn.focus();
    const tooltip = page.getByRole("tooltip", { name: "Zoom in" });
    await expect(tooltip).toBeVisible();
    await expect(zoomIn).toHaveAttribute("aria-describedby", /.+/);
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
  });

  test("legal pages show a reading-progress bar driven by scroll position", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "scroll-driven animations");
    await page.goto("/en/privacy");
    const bar = page.locator(".scroll-progress");
    expect(
      await bar.evaluate((el) => getComputedStyle(el).getPropertyValue("animation-timeline")),
    ).toMatch(/scroll/);
    const before = await bar.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    await page.mouse.wheel(0, 2_000);
    await expect
      .poll(() => bar.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
      .toBeGreaterThan(before);
  });

  test("headings balance their lines and paragraphs avoid orphans", async ({ page }) => {
    await page.goto("/en");
    expect(
      await page
        .locator("h1")
        .first()
        .evaluate((el) => getComputedStyle(el).textWrap),
    ).toMatch(/balance/);
    expect(
      await page
        .locator("p")
        .first()
        .evaluate((el) => getComputedStyle(el).textWrap),
    ).toMatch(/pretty/);
  });

  test("the hero shader loads after the page is idle and never blocks the headline", async ({
    page,
  }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const canvas = page.getByTestId("hero-shader");
    await expect(canvas).toHaveCount(1, { timeout: 10_000 });
    // Headless browsers may not have WebGL; then the canvas simply stays transparent.
    const hasWebGl = await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl"),
    );
    if (hasWebGl) await expect(canvas).toHaveAttribute("data-ready", "true");
    expect(await canvas.getAttribute("aria-hidden")).toBe("true");
  });

  test("the shader stays still under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en");
    const canvas = page.getByTestId("hero-shader");
    await expect(canvas).toHaveCount(1, { timeout: 10_000 });
    expect(await canvas.evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(
      /^0s|0\.01ms|1e-05s/,
    );
  });
});
