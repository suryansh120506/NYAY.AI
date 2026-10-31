import advocatesJson from "@/fixtures/advocates.json";
import type { CityOption, CourtRef, PracticeArea, StateCode } from "@/lib/api/types";

export interface FixtureAdvocate {
  id: string;
  display_name: string;
  enrolment_no: string;
  state_bar_council: string;
  verification_status: "verified" | "pending" | "rejected";
  headline: string;
  courts: string[];
  languages: string[];
  practice_areas: PracticeArea[];
  years_experience: number;
  rate_paise_per_min: number;
  available_now: boolean;
  avg_response_seconds: number;
}

export const ADVOCATES = advocatesJson as FixtureAdvocate[];

interface CourtInfo {
  name: string;
  state: StateCode;
  /** District this court sits in; null for high courts. */
  district: string | null;
  kind: "high_court" | "district";
}

export const COURTS: Record<string, CourtInfo> = {
  ALLAHABAD_HC: { name: "Allahabad High Court", state: "UP", district: null, kind: "high_court" },
  ALLAHABAD_HC_LUCKNOW: {
    name: "Allahabad HC, Lucknow Bench",
    state: "UP",
    district: null,
    kind: "high_court",
  },
  DELHI_HC: { name: "Delhi High Court", state: "DL", district: null, kind: "high_court" },
  UP_LUCKNOW_DC: {
    name: "District Court, Lucknow",
    state: "UP",
    district: "lucknow",
    kind: "district",
  },
  UP_KANPUR_NAGAR_DC: {
    name: "District Court, Kanpur Nagar",
    state: "UP",
    district: "kanpur_nagar",
    kind: "district",
  },
  UP_VARANASI_DC: {
    name: "District Court, Varanasi",
    state: "UP",
    district: "varanasi",
    kind: "district",
  },
  UP_PRAYAGRAJ_DC: {
    name: "District Court, Prayagraj",
    state: "UP",
    district: "prayagraj",
    kind: "district",
  },
  UP_AGRA_DC: { name: "District Court, Agra", state: "UP", district: "agra", kind: "district" },
  UP_GAUTAM_BUDDH_NAGAR_DC: {
    name: "District Court, Gautam Buddh Nagar",
    state: "UP",
    district: "gautam_buddh_nagar",
    kind: "district",
  },
  UP_GHAZIABAD_DC: {
    name: "District Court, Ghaziabad",
    state: "UP",
    district: "ghaziabad",
    kind: "district",
  },
  DL_TIS_HAZARI: { name: "Tis Hazari Courts", state: "DL", district: "delhi", kind: "district" },
  DL_PATIALA_HOUSE: {
    name: "Patiala House Courts",
    state: "DL",
    district: "delhi",
    kind: "district",
  },
  DL_SAKET: { name: "Saket Courts", state: "DL", district: "delhi", kind: "district" },
  DL_KARKARDOOMA: { name: "Karkardooma Courts", state: "DL", district: "delhi", kind: "district" },
  DL_ROHINI: { name: "Rohini Courts", state: "DL", district: "delhi", kind: "district" },
  DL_DWARKA: { name: "Dwarka Courts", state: "DL", district: "delhi", kind: "district" },
};

export const PRIMARY_CITIES: CityOption[] = [
  { district: "lucknow", state: "UP" },
  { district: "delhi", state: "DL" },
  { district: "prayagraj", state: "UP" },
  { district: "kanpur_nagar", state: "UP" },
];

export const MORE_CITIES: CityOption[] = [
  { district: "varanasi", state: "UP" },
  { district: "agra", state: "UP" },
  { district: "gautam_buddh_nagar", state: "UP" },
  { district: "ghaziabad", state: "UP" },
];

/**
 * Court-jurisdiction eligibility (brief §1.3 "geo-fencing" = court jurisdiction, not GPS).
 * Phase 1 simplification: a high court of the user's state plus the district courts in the user's district.
 * TODO(human): confirm the exact territorial split between the Allahabad HC principal seat and the Lucknow Bench
 * before Phase 2 encodes it in the `courts` table.
 */
export function eligibleCourts(location: CityOption): string[] {
  return Object.entries(COURTS)
    .filter(([, court]) =>
      court.kind === "high_court"
        ? court.state === location.state
        : court.district === location.district,
    )
    .map(([code]) => code);
}

export function courtRef(code: string): CourtRef {
  return { code, name: COURTS[code]?.name ?? code };
}

export function findAdvocate(id: string): FixtureAdvocate | undefined {
  return ADVOCATES.find((advocate) => advocate.id === id);
}
