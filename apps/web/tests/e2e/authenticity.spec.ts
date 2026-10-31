import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { QUERY } from "./helpers";

/** The authenticity sweep, enforced on the rendered pages (the source-level rules live in scripts/check-design.mjs). */

async function visualAudit(page: Page) {
  return page.evaluate(() => {
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const style = getComputedStyle(el);
      const name = `${el.tagName.toLowerCase()}.${el.className.toString().split(" ").slice(0, 3).join(".")}`;
      // Gradients are allowed only inside the generated news art (see A78).
      if (style.backgroundImage.includes("gradient") && !el.closest("[data-mesh]"))
        offenders.push(`gradient: ${name}`);
      const radius = Number.parseFloat(style.borderTopLeftRadius);
      const rect = el.getBoundingClientRect();
      const isControl = el.matches("button, a[class*='min-h'], input, textarea, [role='button']");
      // Controls may have up to 12 px corners; only circles (avatars, dots) may be fully round.
      if (isControl && radius > 12 && rect.width > 0)
        offenders.push(`pill-shaped control (${radius}px): ${name}`);
      if (style.cursor.startsWith("url(")) offenders.push(`custom cursor: ${name}`);
      if (
        style.animationName !== "none" &&
        !/pulse/.test(style.animationName) &&
        style.animationDuration !== "0s"
      )
        offenders.push(`animation ${style.animationName}: ${name}`);
    }
    return offenders;
  });
}

test.describe("authenticity sweep", () => {
  test("home and results have no gradients, pill controls, custom cursors or entrance animations", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/en");
    expect(await visualAudit(page)).toEqual([]);
    await page.getByRole("textbox", { name: "Describe your legal problem" }).fill(QUERY);
    await page.getByRole("textbox", { name: "Describe your legal problem" }).press("Enter");
    await expect(page.getByRole("heading", { name: "Which city is this in?" })).toBeVisible();
    expect(await visualAudit(page)).toEqual([]);
  });

  test("the home page shows no invented reviews, counters or emoji", async ({ page }) => {
    await page.goto("/en");
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(body).not.toMatch(
      /\d[\d,.]*\+?\s*(?:happy |satisfied )?(?:customers|clients|users|consultations|cases)/i,
    );
    expect(body).not.toMatch(/testimonial|★|⭐/i);
    expect(body).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(body).not.toMatch(/—/);
    await expect(page.locator("img")).toHaveCount(0);
  });

  test("terms and privacy are linked from the footer and render as documents", async ({ page }) => {
    await page.goto("/en");
    const footer = page.getByRole("contentinfo");
    await footer.getByRole("link", { name: "Terms" }).click();
    await expect(page).toHaveURL(/\/en\/terms$/);
    await expect(page.getByRole("heading", { level: 1, name: "Terms of Use" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "4. Consultations and billing" })).toBeVisible();

    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/\/en\/privacy$/);
    await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
    await expect(
      page.getByText(/Digital Personal Data Protection Act, 2023/).first(),
    ).toBeVisible();
    // Anchors from the contents list work.
    await page
      .getByRole("navigation", { name: "Contents" })
      .getByRole("link", { name: "6. How long we keep data" })
      .click();
    await expect(page).toHaveURL(/#retention$/);
  });

  test("old legal links redirect to the new pages", async ({ page }) => {
    await page.goto("/en/legal/terms");
    await expect(page).toHaveURL(/\/en\/terms$/);
    await page.goto("/hi/legal/privacy");
    await expect(page).toHaveURL(/\/hi\/privacy$/);
    // Hindi pages say the text is in English.
    await expect(page.getByText(/अंग्रेज़ी में प्रकाशित/)).toBeVisible();
  });

  test("legal pages pass axe in both languages", async ({ page }) => {
    for (const path of ["/en/terms", "/en/privacy", "/hi/terms", "/en/legal/grievance"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => `${path} ${v.id}`)).toEqual([]);
    }
  });

  test("head: favicon, theme colour, manifest and canonical URLs are configured", async ({
    page,
    request,
  }) => {
    await page.goto("/en");
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#1A237E");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en$/);
    await expect(page.locator('link[rel="alternate"][hreflang="hi"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      "content",
      "Nyay.ai",
    );
    await expect(page).toHaveTitle("Nyay.ai: Talk to a verified advocate");

    for (const path of [
      "/icon.svg",
      "/favicon.ico",
      "/apple-icon.png",
      "/manifest.webmanifest",
      "/robots.txt",
      "/sitemap.xml",
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
    }
    const svg = await (await request.get("/icon.svg")).text();
    expect(svg).toContain("#1A237E");
    expect(svg).not.toMatch(/gradient/i);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toMatch(/\/en\/terms/);
    expect(sitemap).toMatch(/\/hi\/privacy/);
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Disallow: \/en\/wallet/);
  });

  test("responses carry the security headers", async ({ request }) => {
    const response = await request.get("/en");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
  });
});
