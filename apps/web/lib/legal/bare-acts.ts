/**
 * A small reference library of Bare Act provisions for the citation panel. Only provisions whose text is included
 * here render as a full card; any other section a conversation mentions renders as a "not in the library yet" card
 * that links to India Code.
 *
 * TODO(human): every entry must be checked word for word against the official text on India Code
 * (indiacode.nic.in) by someone qualified, and the BNS correspondence confirmed against the Government's table,
 * before launch. The panel itself tells readers to verify against the official publication (docs/ASSUMPTIONS.md A74).
 */

export type ActId = "IPC" | "BNS" | "CRPC" | "BNSS" | "NI";

export const ACT_NAMES: Record<ActId, string> = {
  IPC: "Indian Penal Code, 1860",
  BNS: "Bharatiya Nyaya Sanhita, 2023",
  CRPC: "Code of Criminal Procedure, 1973",
  BNSS: "Bharatiya Nagarik Suraksha Sanhita, 2023",
  NI: "Negotiable Instruments Act, 1881",
};

export interface Provision {
  act: ActId;
  /** Section number as written, for example "420" or "498A". */
  section: string;
  title: string;
  /** The text of the section, one entry per paragraph. */
  text: string[];
  /** Set when the Act has been replaced; the section then applies to events before `until`. */
  replaced?: { by: ActId; section: string; on: string };
}

const IPC_REPLACED = (section: string) => ({ by: "BNS" as const, section, on: "1 July 2024" });

export const PROVISIONS: readonly Provision[] = [
  {
    act: "IPC",
    section: "420",
    title: "Cheating and dishonestly inducing delivery of property",
    text: [
      "Whoever cheats and thereby dishonestly induces the person deceived to deliver any property to any person, or to make, alter or destroy the whole or any part of a valuable security, or anything which is signed or sealed, and which is capable of being converted into a valuable security, shall be punished with imprisonment of either description for a term which may extend to seven years, and shall also be liable to fine.",
    ],
    replaced: IPC_REPLACED("318(4)"),
  },
  {
    act: "IPC",
    section: "406",
    title: "Punishment for criminal breach of trust",
    text: [
      "Whoever commits criminal breach of trust shall be punished with imprisonment of either description for a term which may extend to three years, or with fine, or with both.",
    ],
    replaced: IPC_REPLACED("316(2)"),
  },
  {
    act: "IPC",
    section: "379",
    title: "Punishment for theft",
    text: [
      "Whoever commits theft shall be punished with imprisonment of either description for a term which may extend to three years, or with fine, or with both.",
    ],
    replaced: IPC_REPLACED("303(2)"),
  },
  {
    act: "IPC",
    section: "498A",
    title: "Husband or relative of husband of a woman subjecting her to cruelty",
    text: [
      "Whoever, being the husband or the relative of the husband of a woman, subjects such woman to cruelty shall be punished with imprisonment for a term which may extend to three years and shall also be liable to fine.",
      "Explanation. For the purposes of this section, cruelty means (a) any wilful conduct which is of such a nature as is likely to drive the woman to commit suicide or to cause grave injury or danger to life, limb or health (whether mental or physical) of the woman; or (b) harassment of the woman where such harassment is with a view to coercing her or any person related to her to meet any unlawful demand for any property or valuable security or is on account of failure by her or any person related to her to meet such demand.",
    ],
    replaced: IPC_REPLACED("85"),
  },
];

export const keyOf = (act: ActId, section: string) => `${act}:${section.toUpperCase()}`;

const INDEX = new Map(PROVISIONS.map((p) => [keyOf(p.act, p.section), p]));

export function findProvision(act: ActId, section: string): Provision | null {
  return INDEX.get(keyOf(act, section)) ?? null;
}

/** Official home of the Acts. Deep links are not guessed: a wrong link is worse than the landing page. */
export const INDIA_CODE_URL = "https://www.indiacode.nic.in/";
