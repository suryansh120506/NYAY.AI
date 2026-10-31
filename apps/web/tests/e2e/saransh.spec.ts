import { expect, test } from "@playwright/test";
import { connectFirst, pickCity, searchFromHome, signIn } from "./helpers";

const pdf = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n% demo\n%%EOF\n"),
});

test.describe("Saransh document summary (free, before the clock)", () => {
  test("attach from the hero: sign-in first, consent required, three bullets with the AI disclaimer", async ({
    page,
  }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: "Attach a document" }).click();
    await signIn(page);

    const sheet = page.getByTestId("saransh-sheet");
    await expect(sheet).toBeVisible();
    // Upload is refused until the consent record exists (DPDP).
    await sheet.locator('input[type="file"]').first().setInputFiles(pdf("notice.pdf"));
    await expect(sheet.getByRole("alert")).toHaveText(/agree to processing/);
    await sheet.getByLabel(/I agree to Nyay.ai processing this document/).check();
    await sheet.locator('input[type="file"]').first().setInputFiles(pdf("notice.pdf"));

    await expect(sheet.getByRole("status")).toBeVisible(); // skeleton while the job runs
    await expect(sheet.getByText("AI summary. Please verify with your advocate.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(sheet.getByRole("listitem")).toHaveCount(3);
    await sheet.getByRole("button", { name: "Use this summary" }).click();
    await expect(page.getByText("notice.pdf · summary ready")).toBeVisible();
  });

  test("rejects unsupported files and reports low confidence", async ({ page }) => {
    await searchFromHome(page);
    await pickCity(page);
    await connectFirst(page);
    await page.getByRole("button", { name: /Attach a document/ }).click();
    const sheet = page.getByTestId("saransh-sheet");
    await sheet.getByLabel(/I agree to Nyay.ai processing this document/).check();
    await sheet
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(sheet.getByRole("alert")).toHaveText("Please choose a PDF, JPG or PNG file.");

    await sheet.locator('input[type="file"]').first().setInputFiles(pdf("blurry-scan.pdf"));
    await expect(sheet.getByText(/hard to read/)).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByRole("button", { name: "Continue without a summary" })).toBeVisible();
    await sheet.getByRole("button", { name: "Use this summary" }).click();
    // The pre-flight card now shows the summary and asks before sharing it with the advocate.
    await expect(page.getByText(/Share this summary with Demo/)).toBeVisible({ timeout: 10_000 });
  });
});
