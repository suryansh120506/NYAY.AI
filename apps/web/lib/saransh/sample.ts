import type { Clause, ClauseId, Level } from "./analysis";

/**
 * A fictional residential lease used to demonstrate the analyzer. No real parties, addresses or case details
 * (docs/ASSUMPTIONS.md A24). The wording of the explanations lives in messages/*.json under Analysis.clauses.<id>.
 */
export type Block =
  | { type: "title"; text: string }
  | { type: "heading"; text: string }
  | { type: "para"; text: string }
  | { type: "clause"; id: ClauseId };

export interface SamplePage {
  blocks: Block[];
}

interface ClauseSource {
  id: ClauseId;
  level: Level;
  text: string;
}

const CLAUSE_SOURCES: readonly ClauseSource[] = [
  {
    id: "term",
    level: "standard",
    text: "The lease runs for eleven (11) months from the Commencement Date and may be renewed by written agreement.",
  },
  {
    id: "rent",
    level: "standard",
    text: "The Tenant shall pay the monthly rent on or before the 5th day of each month by bank transfer.",
  },
  {
    id: "revision",
    level: "high",
    text: "The Owner may increase the rent by up to 25% at the start of any month by giving notice on the same day.",
  },
  {
    id: "deposit",
    level: "high",
    text: "The security deposit is non-refundable and may be retained by the Owner at the end of the lease for any reason.",
  },
  {
    id: "entry",
    level: "high",
    text: "The Owner or the Owner's agents may enter the Premises at any time, with or without notice.",
  },
  {
    id: "repairs",
    level: "review",
    text: "The Tenant shall bear the cost of all repairs, including structural repairs and repairs caused by ordinary wear.",
  },
  {
    id: "termination",
    level: "standard",
    text: "Either party may end the lease by giving one (1) month's written notice to the other.",
  },
  {
    id: "subletting",
    level: "standard",
    text: "The Tenant shall not sublet or share the Premises without the Owner's written consent.",
  },
  {
    id: "early",
    level: "review",
    text: "If the Tenant leaves before the end of the term, the Tenant shall pay the rent for the remaining months in full.",
  },
  {
    id: "disputes",
    level: "standard",
    text: "Disputes under this Agreement shall be heard by the courts of the city where the Premises are located.",
  },
];

export const SAMPLE_PAGES: readonly SamplePage[] = [
  {
    blocks: [
      { type: "title", text: "Residential Lease Agreement (Sample)" },
      {
        type: "para",
        text: "This Agreement is made between the Owner and the Tenant for the flat described in Schedule A (the Premises). It is a fictional sample used to demonstrate document analysis.",
      },
      { type: "heading", text: "1. Term and rent" },
      { type: "clause", id: "term" },
      { type: "clause", id: "rent" },
      { type: "clause", id: "revision" },
      { type: "heading", text: "2. Deposit" },
      { type: "clause", id: "deposit" },
    ],
  },
  {
    blocks: [
      { type: "heading", text: "3. Use of the Premises" },
      { type: "clause", id: "entry" },
      { type: "clause", id: "repairs" },
      { type: "heading", text: "4. Ending the lease" },
      { type: "clause", id: "termination" },
      { type: "clause", id: "subletting" },
    ],
  },
  {
    blocks: [
      { type: "clause", id: "early" },
      { type: "heading", text: "5. General" },
      { type: "clause", id: "disputes" },
      {
        type: "para",
        text: "Signed by the Owner and the Tenant on the date written at the top of this Agreement.",
      },
    ],
  },
];

/** Clauses in document order, numbered, with the page each one is on. */
export const SAMPLE_CLAUSES: readonly Clause[] = SAMPLE_PAGES.flatMap((page, pageIndex) =>
  page.blocks.flatMap((block) =>
    (block.type === "clause" ? [block.id] : []).map((id) => ({ id, page: pageIndex + 1 })),
  ),
).map((placed, index) => {
  const source = CLAUSE_SOURCES.find((c) => c.id === placed.id);
  if (!source) throw new Error(`sample clause ${placed.id} has no source`);
  return {
    id: source.id,
    number: index + 1,
    level: source.level,
    page: placed.page,
    text: source.text,
  };
});

export const SAMPLE_FILE_NAME = "sample-residential-lease.pdf";
