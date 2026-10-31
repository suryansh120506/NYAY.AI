export type LegalBlock = string | { list: string[] };

export interface LegalSection {
  id: string;
  heading: string;
  body: LegalBlock[];
}

export interface LegalDocument {
  /** Identifies the published text; also recorded with each consent (see CHAT_POLICY_VERSION in the API). */
  version: string;
  intro: string;
  sections: LegalSection[];
}

export const LEGAL_VERSION = "2026-10";
