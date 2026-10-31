import { LEGAL_VERSION, type LegalDocument } from "./types";

/**
 * Privacy Policy, written for the Digital Personal Data Protection Act, 2023 and matched to what the product stores
 * and deletes today (retention jobs, consents, export). It does not promise features that do not exist (for example,
 * erasure is by request to the Grievance Officer, not a self-service button). TODO(human): counsel must review
 * before launch, confirm the data fiduciary entity and sub-processor list, and the cross-border position
 * (docs/ASSUMPTIONS.md A25, A71).
 */
export const PRIVACY: LegalDocument = {
  version: LEGAL_VERSION,
  intro:
    "This Privacy Policy explains what personal data Nyay.ai collects, why, who receives it, how long it is kept, and the choices and rights you have under the Digital Personal Data Protection Act, 2023 (DPDP Act).",
  sections: [
    {
      id: "who",
      heading: "1. Who is responsible for your data",
      body: [
        "Nyay.ai decides why and how your personal data is processed on the Platform and is the data fiduciary under the DPDP Act. Questions, requests and complaints go to the Grievance Officer (see section 13).",
      ],
    },
    {
      id: "collect",
      heading: "2. Data we collect",
      body: [
        {
          list: [
            "Account: your mobile number, an optional display name, and your language preference.",
            "Search: the description of your problem that you type, its language, and the city you choose.",
            "Consultations: session times, the rates charged, and the messages you and the advocate send.",
            "Documents: files you upload and the summary generated from them.",
            "Wallet and payments: top-up orders, amounts and your wallet ledger. Card, UPI and bank details are handled by the payment provider and are not stored by Nyay.ai.",
            "Technical: IP address, browser and device type, request logs, and two cookies described in section 10.",
          ],
        },
        "For advocates we also hold professional details: enrolment number, State Bar Council, courts, languages, practice areas and fee.",
      ],
    },
    {
      id: "use",
      heading: "3. Why we use your data",
      body: [
        {
          list: [
            "to sign you in and keep your account secure;",
            "to find advocates relevant to your problem, language and location;",
            "to run consultations, bill them correctly and keep your wallet accurate;",
            "to summarise a document when you ask us to;",
            "to prevent fraud and abuse, to fix faults, and to answer your requests;",
            "to meet legal, tax and accounting obligations.",
          ],
        },
        "We do not sell personal data. We do not use the content of consultations or documents for advertising.",
      ],
    },
    {
      id: "consent",
      heading: "4. Consent",
      body: [
        "Where we need your consent, we ask for it separately and in plain language before the activity starts: once to store your chat during a consultation, once before a document is processed, and again if you choose to keep a transcript longer than the default period or to share a document summary with an advocate. Each consent is recorded with its date and the version of the notice.",
        "You can withdraw a consent at any time by writing to the Grievance Officer. Withdrawing does not affect processing already done, and a feature that depends on the consent will stop working.",
      ],
    },
    {
      id: "share",
      heading: "5. Who receives your data",
      body: [
        {
          list: [
            "The advocate you consult sees your messages in that consultation, your display name (or the word Client) and, only if you choose to share it, the document summary. They never see your mobile number.",
            "Service providers that process data for us: cloud hosting and database providers, a payment provider, an SMS provider for one-time codes, and AI model providers (currently Google Gemini and Groq) that interpret search text and summarise or read documents. They may process data outside India.",
            "Authorities, courts or regulators, when the law requires us to disclose data.",
          ],
        },
        "We give service providers only what they need to perform the task, under written terms.",
      ],
    },
    {
      id: "retention",
      heading: "6. How long we keep data",
      body: [
        {
          list: [
            "Chat messages are deleted 30 days after the consultation ends, unless you chose to keep the transcript longer.",
            "Uploaded documents and their summaries are deleted 30 days after upload, or earlier if you delete them.",
            "Wallet, payment and ledger records, consent records and audit logs are kept for as long as law and accounting rules require, even after you ask for erasure. Where possible they are kept without information that identifies you.",
            "Account and search data are kept while your account is active and are erased on a verified request, subject to the point above.",
          ],
        },
      ],
    },
    {
      id: "rights",
      heading: "7. Your rights",
      body: [
        "Under the DPDP Act you may:",
        {
          list: [
            "ask for a summary of the personal data we process and who we have shared it with;",
            "ask us to correct or update inaccurate or incomplete data;",
            "ask us to erase your personal data, subject to section 6;",
            "withdraw consent you have given;",
            "nominate another person to exercise these rights if you die or become unable to do so;",
            "complain to us, and if you are not satisfied, to the Data Protection Board of India.",
          ],
        },
        "We can give you a copy of your data in a machine-readable format. Write to the Grievance Officer from the mobile number registered on your account. We may need to confirm your identity first, and we will respond within the time the law allows.",
      ],
    },
    {
      id: "security",
      heading: "8. How we protect data",
      body: [
        "Data is encrypted in transit. One-time codes and session tokens are stored only in hashed form. Access to personal data is limited to what each task needs. Mobile numbers, message text and document text are kept out of our application logs. The wallet ledger is reconciled automatically every night.",
        "No system is completely secure. If a personal data breach affects you, we will notify you and the Data Protection Board of India as the law requires.",
      ],
    },
    {
      id: "children",
      heading: "9. Children",
      body: [
        "The Platform is for people aged 18 and over. We do not knowingly collect data from children. If we learn that we have, we delete it.",
      ],
    },
    {
      id: "cookies",
      heading: "10. Cookies",
      body: [
        "We use two strictly necessary cookies: one that keeps you signed in, and one that lets a visitor who is not signed in search without being counted as a new visitor each time. We do not use advertising cookies or third-party analytics.",
      ],
    },
    {
      id: "location",
      heading: "11. Where data is stored",
      body: [
        "Data is stored with the cloud providers we use, which may keep it on servers outside India. We transfer personal data outside India only as the DPDP Act and Government notifications permit.",
      ],
    },
    {
      id: "changes",
      heading: "12. Changes to this policy",
      body: [
        "We may update this policy. The version in force is shown at the top of this page. If a change materially affects how your data is used, we will tell you in the Platform and ask for consent again where required.",
      ],
    },
    {
      id: "contact",
      heading: "13. Contact",
      body: [
        "Requests, questions and complaints about your personal data should be sent to the Grievance Officer. Contact details are on the Grievance Officer page.",
      ],
    },
  ],
};
