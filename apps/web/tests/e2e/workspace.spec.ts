import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  backgroundRgb,
  composer,
  connectFirst,
  pickCity,
  searchFromHome,
  startSession,
} from "./helpers";

const isMobile = () => test.info().project.name === "mobile";

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
}

test.describe("news bento grid", () => {
  test("home shows one bento group with images, category badges and a hover lift", async ({
    page,
  }) => {
    await page.goto("/en");
    const cards = page.getByTestId("news-card");
    await expect(cards).toHaveCount(5);
    await expect(cards.first()).toHaveAttribute("data-tile", "feature");
    // Every card draws its own mesh from its headline: no photos, no image requests.
    await expect(page.locator('[data-testid="news-bento"] [data-mesh]')).toHaveCount(5);
    await expect(page.locator("img")).toHaveCount(0);
    const families = await page
      .locator('[data-testid="news-bento"] [data-mesh]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-mesh")));
    expect(families.every((f) => ["navy", "slate", "crimson"].includes(f ?? ""))).toBe(true);
    // The same headline always gets the same picture.
    const before = await cards.first().locator("[data-mesh]").getAttribute("style");
    await page.reload();
    expect(
      await page.getByTestId("news-card").first().locator("[data-mesh]").getAttribute("style"),
    ).toBe(before);
    // The category badge is frosted glass: translucent fill and a blur behind it.
    const badge = page.getByTestId("news-card").first().getByTestId("news-badge");
    expect(await badge.evaluate((e) => getComputedStyle(e).backdropFilter)).toMatch(/blur/);
    expect(await badge.evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(
      /rgba\(255, 255, 255, 0\.12\)/,
    );
    await expect(cards.first().getByTestId("news-badge")).toHaveText(
      /Supreme Court|Allahabad HC|Delhi HC|Legislation/,
    );
    await expect(cards.first().getByText(/^Read on /)).toBeVisible();
    if (!isMobile()) {
      // Tailwind v4 animates the individual `scale` and `translate` properties, not `transform`.
      const art = cards.nth(1).locator("[data-mesh]");
      await expect.poll(() => art.evaluate((e) => getComputedStyle(e).scale)).toBe("none");
      await cards.nth(1).hover();
      await expect.poll(() => art.evaluate((e) => getComputedStyle(e).scale)).toBe("1.05");
      await expect
        .poll(() => cards.nth(1).evaluate((e) => getComputedStyle(e).translate))
        .toBe("0px -2px");
    }
  });

  test("the grid fills its rows on /updates and every card is an external link", async ({
    page,
  }) => {
    await page.goto("/en/updates");
    const cards = page.getByTestId("news-card");
    await expect(cards).toHaveCount(12);
    expect(await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-tile")))).toEqual([
      "feature",
      "small",
      "small",
      "half",
      "half",
      "feature",
      "small",
      "small",
      "half",
      "half",
      "half",
      "half",
    ]);
    await expect(cards.first()).toHaveAttribute("target", "_blank");
    await expect(cards.first()).toHaveAttribute("rel", /noopener/);
    await axe(page, "updates");
  });
});

test.describe("samvaad split-screen workspace", () => {
  test("sections of law mentioned in the chat appear as citation cards with the Bare Act text", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await searchFromHome(page);
    await pickCity(page);
    await connectFirst(page);
    await startSession(page);

    const root = page.locator('[data-theme="night"]').first();
    await expect(root).toBeVisible();
    expect(await backgroundRgb(root)).toBe("rgb(7, 9, 13)");

    const panel = () => page.locator('[data-testid="citation-panel"]:visible');
    if (!isMobile()) {
      await expect(panel()).toBeVisible();
      await expect(panel().getByTestId("citation-empty")).toBeVisible();
    }

    await composer(page).fill("He cheated me and took my money. Is Section 420 IPC applicable?");
    await composer(page).press("Enter");

    if (isMobile()) {
      await expect(page.getByTestId("citations-button")).toContainText("1");
      await page.getByTestId("citations-button").click();
    }
    const card = panel().locator('[data-citation="IPC:420"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole("heading", { name: "Section 420" })).toBeVisible();
    await expect(
      card.getByText("Cheating and dishonestly inducing delivery of property"),
    ).toBeVisible();
    await expect(card.getByText(/term which may extend to seven years/)).toBeVisible();
    await expect(card.getByText(/^Replaced 1 July 2024/)).toBeVisible();
    // Glass: a translucent fill, a blur behind the card, and a hairline edge.
    expect(await card.evaluate((e) => getComputedStyle(e).backdropFilter)).toMatch(/blur/);
    expect(await card.evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(
      /rgba\(255, 255, 255, 0.0(?:59|6)d*\)/,
    );
    expect(await card.evaluate((e) => getComputedStyle(e).borderTopColor)).toMatch(
      /rgba\(255, 255, 255, 0\.1\)/,
    );
    await expect(card.getByText(/Corresponding provision: Section 318\(4\)/)).toBeVisible();
    await expect(card.getByText(/You mentioned this/)).toBeVisible();
    await expect(panel().getByText(/This is not legal advice/)).toBeVisible();
    await axe(page, "workspace with a citation");
    if (isMobile()) await page.keyboard.press("Escape");

    await composer(page).fill("Also Sections 406 and 498A, and section 304.");
    await composer(page).press("Enter");
    if (isMobile()) {
      await expect(page.getByTestId("citations-button")).toContainText("4");
      await page.getByTestId("citations-button").click();
    } else {
      await expect(panel().getByTestId("citation-count")).toHaveText("4");
    }
    await expect(panel().getByTestId("citation-card")).toHaveCount(4);
    await expect(
      panel()
        .locator('[data-citation="IPC:498A"]')
        .getByText(/subjects such woman to cruelty/),
    ).toBeVisible();
    const unknown = panel().locator('[data-citation="?:304"]');
    await expect(unknown.getByText("Not in the reference library yet")).toBeVisible();
    // The newest mention is listed first.
    await expect(panel().getByTestId("citation-card").first()).toHaveAttribute(
      "data-citation",
      /304|498A|406/,
    );
  });
});

test.describe("document analysis", () => {
  const pdf = {
    name: "notice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 demo"),
  };

  test("drop, upload, analyse, then read the document beside its risk analysis", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/en/saransh");
    await expect(page.getByRole("heading", { level: 1, name: "Document analysis" })).toBeVisible();
    await expect(page.getByTestId("dropzone")).toBeVisible();
    await expect(page.getByText("Encrypted in transit. Deleted after 30 days.")).toBeVisible();

    // Consent first, then the type and size rules.
    await page.getByTestId("file-input").setInputFiles(pdf);
    await expect(page.getByText("Please agree before uploading.")).toBeVisible();
    await page.getByLabel(/I agree to Nyay.ai processing this document/).check();
    await page
      .getByTestId("file-input")
      .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByText("Please choose a PDF, JPG or PNG file.")).toBeVisible();
    await page.getByTestId("file-input").setInputFiles({
      name: "big.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
    await expect(page.getByText("This file is larger than 10 MB.")).toBeVisible();

    await page.getByTestId("file-input").setInputFiles(pdf);
    await expect(page.getByTestId("progress-card")).toContainText("notice.pdf");
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("preview-note")).toContainText("not read yet");

    // Score and tallies.
    const dial = page.getByTestId("risk-dial");
    await expect(dial).toHaveAttribute("data-score", "80");
    await expect(dial).toHaveAttribute("data-tier", "high");
    await expect(dial.getByText("High risk")).toBeVisible();
    await expect(page.getByTestId("filter-high")).toContainText("3");
    await expect(page.getByTestId("filter-review")).toContainText("2");
    await expect(page.getByTestId("filter-standard")).toContainText("5");

    // Page one: red, green, no amber; colours come with words.
    const paper = page.getByTestId("pdf-viewer");
    await expect(paper.locator('[data-clause][data-level="high"]')).toHaveCount(2);
    await expect(paper.locator('[data-clause][data-level="standard"]')).toHaveCount(2);
    await expect(paper.locator('[data-clause][data-level="review"]')).toHaveCount(0);
    expect(await backgroundRgb(paper.locator('[data-clause][data-level="high"]').first())).toBe(
      "rgb(253, 230, 230)",
    );
    expect(await backgroundRgb(paper.locator('[data-clause][data-level="standard"]').first())).toBe(
      "rgb(226, 244, 231)",
    );

    // Selecting a clause explains it; a clause on another page turns the page.
    const panel = page.getByTestId("analysis-panel");
    await expect(panel.getByText("Why it is flagged")).toBeVisible();
    await panel.locator('[data-clause-item="entry"]').click();
    await expect(page.getByTestId("page-indicator")).toHaveText("Page 2 of 3");
    await expect(paper.locator('[data-clause="entry"]')).toHaveAttribute("aria-pressed", "true");
    // The previous clause's detail is still animating out for a moment: wait until exactly one is left.
    await expect(panel.getByText("Ask your advocate")).toHaveCount(1);
    await expect(
      panel.getByText("The owner may enter at any time without telling the tenant."),
    ).toBeVisible();

    // Filtering by level.
    await page.getByTestId("filter-high").click();
    await expect(panel.locator("[data-clause-item]")).toHaveCount(3);
    expect(
      await panel
        .locator("[data-clause-item]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-level"))),
    ).toEqual(["high", "high", "high"]);
    await page.getByTestId("filter-high").click();
    await expect(panel.locator("[data-clause-item]")).toHaveCount(10);

    // Viewer controls.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(paper.getByText("115%")).toBeVisible();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByTestId("page-indicator")).toHaveText("Page 3 of 3");
    await expect(page.getByRole("button", { name: "Next page" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await axe(page, "document analysis");
    await page.getByRole("button", { name: "Analyse another document" }).click();
    await expect(page.getByTestId("dropzone")).toBeVisible();
  });

  test("the sample document and the Hindi page work too", async ({ page }) => {
    await page.goto("/hi/saransh");
    await expect(page.getByRole("heading", { level: 1, name: /दस्तावेज़ विश्लेषण/ })).toBeVisible();
    await page.getByTestId("use-sample").click();
    await expect(page.getByTestId("pdf-viewer")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("risk-dial").getByText("अधिक जोखिम")).toBeVisible();
    await axe(page, "document analysis (Hindi)");
  });
});
