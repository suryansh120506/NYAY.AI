#!/usr/bin/env node
// Generates fixtures/advocates.json: 40 clearly fictional demo advocates (brief §2.5).
// Names are always prefixed "Demo" and enrolment numbers use a DEMO/ prefix, so they can never be mistaken for
// real people. Deterministic: re-running produces the same file. Phase 2's `make seed` reuses this file.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIRST = [
  "Aarti",
  "Rohan",
  "Sana",
  "Vikram",
  "Meera",
  "Arjun",
  "Farah",
  "Kunal",
  "Neha",
  "Imran",
  "Pooja",
  "Rahul",
  "Kavya",
  "Sameer",
  "Anjali",
  "Deepak",
  "Ritu",
  "Aditya",
  "Zoya",
  "Manish",
  "Shweta",
  "Harsh",
  "Nidhi",
  "Tarun",
  "Isha",
  "Varun",
  "Priya",
  "Faisal",
  "Swati",
  "Nikhil",
  "Rekha",
  "Amit",
  "Gauri",
  "Sanjay",
  "Tanvi",
  "Yusuf",
  "Pallavi",
  "Rajat",
  "Simran",
  "Alok",
];
const LAST = [
  "Verma",
  "Srivastava",
  "Khan",
  "Singh",
  "Mishra",
  "Gupta",
  "Ansari",
  "Tiwari",
  "Sharma",
  "Siddiqui",
  "Yadav",
  "Pandey",
  "Kapoor",
  "Rizvi",
  "Chauhan",
  "Saxena",
  "Mehra",
  "Joshi",
  "Malhotra",
  "Dubey",
];
const AREAS = [
  "tenancy",
  "cheque_bounce",
  "consumer",
  "matrimonial",
  "criminal_bail",
  "property",
  "employment",
];
const AREA_LABEL = {
  tenancy: "tenancy",
  cheque_bounce: "cheque bounce",
  consumer: "consumer",
  matrimonial: "matrimonial",
  criminal_bail: "criminal and bail",
  property: "property",
  employment: "employment",
};

// [court codes, state] per advocate slot. 24 in UP, 16 in Delhi.
const COURT_PLAN = [
  ...Array.from({ length: 8 }, (_, i) => [
    i % 2 === 0 ? ["ALLAHABAD_HC", "UP_PRAYAGRAJ_DC"] : ["ALLAHABAD_HC"],
    "UP",
  ]),
  ...Array.from({ length: 4 }, () => [["ALLAHABAD_HC_LUCKNOW", "UP_LUCKNOW_DC"], "UP"]),
  ...[
    "UP_LUCKNOW_DC",
    "UP_KANPUR_NAGAR_DC",
    "UP_VARANASI_DC",
    "UP_AGRA_DC",
    "UP_GAUTAM_BUDDH_NAGAR_DC",
    "UP_GHAZIABAD_DC",
  ].flatMap((code) => [
    [[code], "UP"],
    [[code], "UP"],
  ]),
  ...Array.from({ length: 4 }, (_, i) => [
    i % 2 === 0 ? ["DELHI_HC", "DL_PATIALA_HOUSE"] : ["DELHI_HC"],
    "DL",
  ]),
  ...[
    "DL_TIS_HAZARI",
    "DL_PATIALA_HOUSE",
    "DL_SAKET",
    "DL_KARKARDOOMA",
    "DL_ROHINI",
    "DL_DWARKA",
  ].flatMap((code) => [
    [[code], "DL"],
    [[code], "DL"],
  ]),
];

const COURT_NAME = {
  ALLAHABAD_HC: "Allahabad High Court",
  ALLAHABAD_HC_LUCKNOW: "Allahabad HC, Lucknow Bench",
  DELHI_HC: "Delhi High Court",
  UP_LUCKNOW_DC: "District Court, Lucknow",
  UP_KANPUR_NAGAR_DC: "District Court, Kanpur Nagar",
  UP_VARANASI_DC: "District Court, Varanasi",
  UP_PRAYAGRAJ_DC: "District Court, Prayagraj",
  UP_AGRA_DC: "District Court, Agra",
  UP_GAUTAM_BUDDH_NAGAR_DC: "District Court, Gautam Buddh Nagar",
  UP_GHAZIABAD_DC: "District Court, Ghaziabad",
  DL_TIS_HAZARI: "Tis Hazari Courts",
  DL_PATIALA_HOUSE: "Patiala House Courts",
  DL_SAKET: "Saket Courts",
  DL_KARKARDOOMA: "Karkardooma Courts",
  DL_ROHINI: "Rohini Courts",
  DL_DWARKA: "Dwarka Courts",
};

const advocates = COURT_PLAN.map(([courts, state], i) => {
  const years = 3 + ((i * 5) % 26);
  const areaCount = 1 + (i % 3);
  const practiceAreas = Array.from(
    { length: areaCount },
    (_, k) => AREAS[(i + k * 3) % AREAS.length],
  );
  const languages = ["hi"];
  if (i % 5 !== 4) languages.push("en");
  if (state === "UP" && courts.includes("UP_VARANASI_DC")) languages.push("bho");
  if ((courts.includes("UP_LUCKNOW_DC") || state === "DL") && i % 3 === 0) languages.push("ur");
  if (state === "DL" && i % 4 === 1) languages.push("pa");
  const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
  return {
    id,
    display_name: `Demo ${FIRST[i]} ${LAST[i % LAST.length]}`,
    enrolment_no: `DEMO/${state}/${1000 + i}/${2025 - years}`,
    state_bar_council: state === "UP" ? "Bar Council of Uttar Pradesh" : "Bar Council of Delhi",
    verification_status: "verified",
    headline: `${practiceAreas.map((a) => AREA_LABEL[a]).join(", ")} matters at ${courts.map((c) => COURT_NAME[c]).join(" and ")}`,
    courts,
    languages,
    practice_areas: practiceAreas,
    years_experience: years,
    rate_paise_per_min: 1500 + ((i * 7) % 10) * 500,
    available_now: i % 4 !== 3,
    avg_response_seconds: 30 + ((i * 13) % 120),
  };
});

const out = fileURLToPath(new URL("../fixtures/advocates.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(advocates, null, 2)}\n`);
console.log(`wrote ${advocates.length} demo advocates to ${out}`);
