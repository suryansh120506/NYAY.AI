import { LEGAL_VERSION, type LegalDocument } from "./types";

/**
 * Terms of Use. Standard marketplace terms written to match how the product works (prepaid per-minute wallet,
 * independent advocates, AI summaries). TODO(human): counsel must review before launch, and confirm the operating
 * entity, registered address and the courts named in section 13 (docs/ASSUMPTIONS.md A25, A71).
 */
export const TERMS: LegalDocument = {
  version: LEGAL_VERSION,
  intro:
    "These Terms of Use govern your access to and use of Nyay.ai, a platform that connects people in Uttar Pradesh and Delhi with independent advocates for paid consultations. Please read them with the Privacy Policy.",
  sections: [
    {
      id: "acceptance",
      heading: "1. Acceptance of these terms",
      body: [
        "By creating an account or using Nyay.ai (the Platform), you agree to these Terms and to the Privacy Policy. If you do not agree, do not use the Platform.",
        "You must be at least 18 years old and capable of entering into a binding contract under Indian law.",
      ],
    },
    {
      id: "role",
      heading: "2. What Nyay.ai is, and what it is not",
      body: [
        "Nyay.ai is a technology platform and an intermediary. It is not a law firm and does not practise law. Nyay.ai does not give legal advice, does not represent you in any matter, and does not form an advocate-client relationship with you.",
        "Consultations take place between you and an independent advocate who is enrolled with a State Bar Council. The advocate alone is responsible for the advice they give and for their professional conduct under the Advocates Act, 1961 and the rules of the Bar Council of India.",
        "Search results are ordered by relevance to your description, jurisdiction and availability. Advocates cannot pay for placement. A result is not an endorsement of an advocate and is not a prediction or guarantee of the outcome of any matter.",
        "Nyay.ai is not an emergency service. If you or someone else is in immediate danger, contact the police or emergency services.",
      ],
    },
    {
      id: "accounts",
      heading: "3. Accounts",
      body: [
        "You sign in with an Indian mobile number and a one-time code. You are responsible for activity under your account and for keeping your device and codes secure. Tell us promptly if you suspect unauthorised use.",
        "You may have one open consultation at a time. You must give accurate information and must not create accounts on behalf of others without their authority.",
      ],
    },
    {
      id: "consultations",
      heading: "4. Consultations and billing",
      body: [
        "Before you start, the Platform shows the advocate's per-minute fee, the platform fee, and the GST charged on the platform fee. The advocate receives their full per-minute fee. The platform fee and GST are charged to you separately.",
        "A consultation begins, and billing starts, when you press Start and the advocate has joined. Each minute is paid in advance from your wallet. When a consultation ends before a prepaid minute is used up, you are charged only for the time used, calculated to the second, and the unused amount is returned to your wallet.",
        "A consultation ends when you or the advocate ends it, when your wallet balance cannot cover the next minute, or when a participant is disconnected for more than 30 seconds. The Platform warns you before your balance runs out.",
        "Messages are stored and deleted according to the Privacy Policy. Nyay.ai does not guarantee that an advocate will be available, will respond, or will accept a particular matter.",
      ],
    },
    {
      id: "wallet",
      heading: "5. Wallet, payments and refunds",
      body: [
        "Your wallet is a closed-loop prepaid balance in Indian rupees. It can be used only for consultations on the Platform. It does not earn interest and cannot be withdrawn to a bank account or transferred to another person, except where the law requires otherwise.",
        "Top-ups are processed by a third-party payment provider. Nyay.ai does not store your card, UPI or bank credentials. A top-up is credited when the payment provider confirms the payment. If a payment fails or is not confirmed, the amount is returned by the payment provider under its own rules.",
        "Money held for a consultation that is not used is returned to your wallet when the consultation ends, or when an unstarted reservation expires.",
        "Promotional credit, where offered, is not refundable, has no cash value, expires on the date shown, and is used before your paid balance.",
        "If you believe a charge is wrong, write to the Grievance Officer with the date and amount. Each charge can be traced to a consultation and a ledger entry.",
      ],
    },
    {
      id: "documents",
      heading: "6. Documents and automated summaries",
      body: [
        "You may upload a document for a short summary. You decide whether to share the summary with an advocate. Processing starts only after you give consent.",
        "Summaries are produced by automated systems. They may be incomplete or wrong, they are not legal advice, and they are not a substitute for reading the document or asking an advocate. Always verify a summary with your advocate before acting on it.",
        "Do not upload documents you have no right to share. Uploads are limited in size, type and number as shown on the Platform.",
      ],
    },
    {
      id: "conduct",
      heading: "7. Acceptable use",
      body: [
        "You agree not to:",
        {
          list: [
            "use the Platform for unlawful purposes or to seek help with committing an offence;",
            "harass, threaten or abuse advocates, other users or Nyay.ai staff;",
            "impersonate another person or misstate your identity or qualifications;",
            "copy, scrape or reverse engineer the Platform, or overload it with automated requests;",
            "attempt to avoid or manipulate billing, or interfere with the security of the Platform;",
            "record or share a consultation in a way that breaches another person's rights.",
          ],
        },
        "Nyay.ai or an advocate may end a consultation immediately for a breach of this section.",
      ],
    },
    {
      id: "advocates",
      heading: "8. Advocates",
      body: [
        "Advocates are independent professionals, not employees or agents of Nyay.ai. An advocate is listed only after their enrolment details have been checked, and may be removed if they are no longer enrolled or breach their terms.",
        "Advocates set their own per-minute fee within the range the Platform allows. A change applies to new consultations only.",
      ],
    },
    {
      id: "ip",
      heading: "9. Intellectual property",
      body: [
        "The Platform, its design and its software belong to Nyay.ai or its licensors. You may use it only as these Terms allow.",
        "You keep ownership of what you submit. You give Nyay.ai a limited licence to store, process and display it as needed to run the Platform for you and to meet legal obligations.",
      ],
    },
    {
      id: "liability",
      heading: "10. Disclaimers and limits of liability",
      body: [
        "The Platform is provided as available. Nyay.ai does not promise uninterrupted or error-free service.",
        "Nyay.ai is not liable for the advice given by an advocate, for the outcome of any matter, or for decisions you make based on a consultation or an automated summary.",
        "To the extent the law permits, Nyay.ai's total liability to you for any claim relating to a consultation is limited to the amount you paid for that consultation. Nothing in these Terms excludes liability that cannot be excluded under law, including your rights under the Consumer Protection Act, 2019.",
      ],
    },
    {
      id: "termination",
      heading: "11. Suspension and closing your account",
      body: [
        "We may suspend or close an account that breaches these Terms, that is used for fraud, or where required by law. You may stop using the Platform at any time and may ask for your account and data to be deleted as described in the Privacy Policy. Records we must keep by law are kept.",
      ],
    },
    {
      id: "changes",
      heading: "12. Changes to these terms",
      body: [
        "We may update these Terms. The version in force is shown at the top of this page. If a change materially affects you, we will tell you in the Platform before it applies. Continuing to use the Platform after that means you accept the updated Terms.",
      ],
    },
    {
      id: "law",
      heading: "13. Governing law and disputes",
      body: [
        "These Terms are governed by the laws of India. Subject to your statutory rights as a consumer, the courts in India with jurisdiction over the matter may hear any dispute.",
        "Before starting formal proceedings, please contact the Grievance Officer so that we can try to resolve the matter.",
      ],
    },
    {
      id: "contact",
      heading: "14. Contact",
      body: [
        "Questions about these Terms and complaints should be sent to the Grievance Officer. Contact details are on the Grievance Officer page.",
      ],
    },
  ],
};
