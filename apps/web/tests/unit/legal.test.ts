import { describe, expect, it } from "vitest";
import { PRIVACY } from "@/lib/legal/privacy";
import { TERMS } from "@/lib/legal/terms";
import type { LegalDocument } from "@/lib/legal/types";

const text = (doc: LegalDocument) =>
  [
    doc.intro,
    ...doc.sections.flatMap((s) => [
      s.heading,
      ...s.body.flatMap((b) => (typeof b === "string" ? [b] : b.list)),
    ]),
  ].join("\n");

describe.each([
  ["terms", TERMS],
  ["privacy", PRIVACY],
])("%s document", (_name, doc) => {
  it("has numbered sections with unique anchors", () => {
    const ids = doc.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    doc.sections.forEach((section, index) =>
      expect(section.heading).toMatch(new RegExp(`^${index + 1}\\. `)),
    );
  });

  it("follows the writing rules: no em dashes, no hype, no emoji", () => {
    const body = text(doc);
    expect(body).not.toMatch(/—/);
    expect(body).not.toMatch(
      /revolutioni|seamless|unlock|supercharg|leverag|empower|cutting[- ]edge|effortless/i,
    );
    expect(body).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("points to the Grievance Officer", () => {
    expect(text(doc)).toMatch(/Grievance Officer/);
  });
});

describe("what the documents must say", () => {
  it("terms: intermediary status, prepaid per-minute billing, prorated end, no outcome promise", () => {
    const body = text(TERMS);
    expect(body).toMatch(/not a law firm/);
    expect(body).toMatch(/does not give legal advice/);
    expect(body).toMatch(/calculated to the second/);
    expect(body).toMatch(/closed-loop prepaid/);
    expect(body).toMatch(/not (?:a )?(?:an endorsement|.*guarantee)/);
  });

  it("privacy: DPDP rights, retention, consent and no sale of data", () => {
    const body = text(PRIVACY);
    expect(body).toMatch(/Digital Personal Data Protection Act, 2023/);
    expect(body).toMatch(/30 days/);
    expect(body).toMatch(/withdraw/i);
    expect(body).toMatch(/do not sell personal data/);
    expect(body).toMatch(/Data Protection Board/);
    expect(body).toMatch(/never see your mobile number/);
  });
});
