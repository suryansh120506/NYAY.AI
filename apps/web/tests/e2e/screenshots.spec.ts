import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { composer, devControl, pickCity, searchFromHome, startSession } from "./helpers";

/**
 * Gate screenshots (not part of the default run): SCREENSHOTS=1 pnpm test:e2e screenshots
 * Writes PNGs to docs/screenshots/<project>/.
 */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture gate screenshots");

const outDir = (project: string) => {
  const dir = join(__dirname, "..", "..", "..", "..", "docs", "screenshots", project);
  mkdirSync(dir, { recursive: true });
  return dir;
};

async function shot(page: Page, project: string, name: string, fullPage = false) {
  await page.waitForTimeout(450); // let 250-300 ms transitions settle
  await page.screenshot({ path: join(outDir(project), `${name}.png`), fullPage });
}

test("capture key screens", async ({ page }, info) => {
  test.setTimeout(180_000);
  const project = info.project.name;

  await page.goto("/en");
  await shot(page, project, "01-home", true);
  await page.goto("/hi");
  await shot(page, project, "02-home-hi");

  await searchFromHome(page);
  await expect(page.getByRole("heading", { name: "Which city is this in?" })).toBeVisible();
  await shot(page, project, "03-parakh-follow-up");
  await pickCity(page, "Lucknow");
  await shot(page, project, "04-parakh-results", true);

  await page
    .getByRole("button", { name: /^Connect with Demo/ })
    .first()
    .click();
  await expect(page.getByTestId("otp-sheet")).toBeVisible();
  await shot(page, project, "05-otp-sheet");
  const sheet = page.getByTestId("otp-sheet");
  await sheet.getByLabel("Mobile number").fill("9876543210");
  await sheet.getByRole("button", { name: "Send code" }).click();
  await sheet.getByLabel("6-digit code").fill("000000");
  await expect(page).toHaveURL(/\/en\/samvaad\/sess_/);
  await page.goto(`${page.url()}?mockMinuteMs=4000`);
  await expect(page.getByRole("heading", { name: "Before you start" })).toBeVisible();
  await shot(page, project, "06-preflight", true);

  await startSession(page);
  await composer(page).fill("Hello, I need help getting my deposit back from my landlord.");
  await composer(page).press("Enter");
  await expect(page.getByText(/^Namaste, I'm /)).toBeVisible({ timeout: 10_000 });
  await composer(page).fill(
    "He says the paint was damaged, but it was already like that when I moved in.",
  );
  await composer(page).press("Enter");
  await expect(page.getByText(/When did this start\?|Do you have anything in writing/)).toBeVisible(
    { timeout: 10_000 },
  );
  await shot(page, project, "07-chat-live");

  await devControl(page, "low");
  await expect(page.getByTestId("low-balance-sheet")).toBeVisible();
  await shot(page, project, "08-low-balance");
  await page.getByTestId("low-balance-sheet").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("summary-sheet")).toBeVisible({ timeout: 30_000 });
  await shot(page, project, "09-summary");

  await page.goto("/en/wallet");
  await expect(page.getByRole("heading", { name: "Wallet" })).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, project, "10-wallet", true);
});

test("capture the bento news, split-screen workspace and document analysis", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const project = info.project.name;
  const dir = outDir("phase3");
  const save = async (name: string, fullPage = false) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(dir, `${name}-${project}.png`), fullPage });
  };

  await page.goto("/en/updates");
  await expect(page.getByTestId("news-card").first()).toBeVisible();
  await save("20-news-bento", true);

  await searchFromHome(page);
  await pickCity(page, "Lucknow");
  await page
    .getByRole("button", { name: /^Connect with Demo/ })
    .first()
    .click();
  const sheet = page.getByTestId("otp-sheet");
  await sheet.getByLabel("Mobile number").fill("9876543210");
  await sheet.getByRole("button", { name: "Send code" }).click();
  await sheet.getByLabel("6-digit code").fill("000000");
  await expect(page).toHaveURL(/\/en\/samvaad\/sess_/);
  await page.goto(`${page.url()}?mockMinuteMs=60000`);
  await startSession(page);
  await composer(page).fill("He took my money and never delivered. Is Section 420 IPC applicable?");
  await composer(page).press("Enter");
  await expect(page.getByText(/^Namaste, I'm /)).toBeVisible({ timeout: 10_000 });
  await composer(page).fill("He also kept my documents, so maybe Sections 406 and 498A too.");
  await composer(page).press("Enter");
  if (info.project.name === "mobile") {
    await page.getByTestId("citations-button").click();
    await expect(
      page.locator('[data-testid="citation-panel"]:visible').getByTestId("citation-card").first(),
    ).toBeVisible();
  } else {
    await expect(page.getByTestId("citation-count")).toHaveText("3");
  }
  await save("21-workspace-citations");

  await page.goto("/en/saransh");
  await save("22-analysis-dropzone");
  await page.getByTestId("use-sample").click();
  await expect(page.getByTestId("pdf-viewer")).toBeVisible({ timeout: 15_000 });
  await save("23-analysis-split-view");
});
