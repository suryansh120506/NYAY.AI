import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdvocateCard } from "@/components/parakh/AdvocateCard";
import { SaranshCard } from "@/components/saransh/SaranshCard";
import { Composer } from "@/components/samvaad/Composer";
import { MessageBubble } from "@/components/samvaad/MessageBubble";
import { PriceBreakdown } from "@/components/samvaad/PriceBreakdown";
import { balanceTone } from "@/components/samvaad/SessionMeters";
import type { AdvocateMatch, SaranshDocument } from "@/lib/api/types";
import type { ChatMessage } from "@/lib/samvaad/reducer";
import { renderWithIntl } from "./render";

const message = (partial: Partial<ChatMessage>): ChatMessage => ({
  kind: "message",
  key: "k",
  clientMsgId: "c1",
  seq: null,
  from: "user",
  text: "hello",
  ts: "2026-10-09T10:00:00Z",
  status: "sending",
  ...partial,
});

describe("MessageBubble", () => {
  it("shows Sending… then Sent under the last own message", () => {
    const { rerender } = renderWithIntl(
      <MessageBubble message={message({})} showStatus onRetry={vi.fn()} />,
    );
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    rerender(
      <MessageBubble message={message({ status: "sent", seq: 1 })} showStatus onRetry={vi.fn()} />,
    );
    expect(screen.getByText("Sent")).toBeInTheDocument();
  });

  it("offers Tap to retry on a failed message", async () => {
    const onRetry = vi.fn();
    renderWithIntl(
      <MessageBubble
        message={message({ status: "failed" })}
        showStatus={false}
        onRetry={onRetry}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Failed · Tap to retry/ }));
    expect(onRetry).toHaveBeenCalledWith("c1");
  });

  it("marks Devanagari text as Hindi and shows no status on the advocate's messages", () => {
    renderWithIntl(
      <MessageBubble
        message={message({ from: "advocate", text: "नमस्ते", status: "received" })}
        showStatus
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("नमस्ते")).toHaveAttribute("lang", "hi");
    expect(screen.queryByTestId("message-status")).toBeNull();
  });
});

describe("Composer", () => {
  const setup = (enabled = true, disabledReason: string | null = null) => {
    const onSend = vi.fn();
    const onTyping = vi.fn();
    renderWithIntl(
      <Composer
        enabled={enabled}
        disabledReason={disabledReason}
        advocateName="Demo Aarti Verma"
        onSend={onSend}
        onTyping={onTyping}
      />,
    );
    return {
      onSend,
      onTyping,
      box: screen.getByRole("textbox", { name: "Message Demo Aarti Verma" }),
    };
  };

  it("sends on Enter, keeps Shift+Enter as a new line, and clears the field", async () => {
    const { onSend, onTyping, box } = setup();
    await userEvent.type(box, "first line{Shift>}{Enter}{/Shift}second");
    expect(onSend).not.toHaveBeenCalled();
    expect(onTyping).toHaveBeenCalledWith(true);
    await userEvent.type(box, "{Enter}");
    expect(onSend).toHaveBeenCalledWith("first line\nsecond");
    expect(box).toHaveValue("");
  });

  it("does not send while an IME composition is in progress", () => {
    const { onSend, box } = setup();
    fireEvent.change(box, { target: { value: "नमस्" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps Send disabled for empty input", () => {
    setup();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("explains why it is disabled when the session is not live", () => {
    const { box } = setup(false, "Chat opens when Demo Aarti Verma joins.");
    expect(box).toBeDisabled();
    expect(box).toHaveAccessibleDescription("Chat opens when Demo Aarti Verma joins.");
  });
});

describe("balance chip tone (not colour alone: icon + words too)", () => {
  it("warns at ≤ 2 minutes and turns to danger at ≤ 1 minute", () => {
    expect(balanceTone(null)).toBe("normal");
    expect(balanceTone(121)).toBe("normal");
    expect(balanceTone(120)).toBe("warn");
    expect(balanceTone(61)).toBe("warn");
    expect(balanceTone(60)).toBe("danger");
  });
});

const advocate: AdvocateMatch = {
  advocate_id: "a1",
  display_name: "Demo Aarti Verma",
  enrolment_no: "DEMO/UP/1000/2022",
  state_bar_council: "Bar Council of Uttar Pradesh",
  courts: [
    { code: "ALLAHABAD_HC", name: "Allahabad High Court" },
    { code: "UP_PRAYAGRAJ_DC", name: "District Court, Prayagraj" },
  ],
  languages: ["hi", "en"],
  practice_areas: ["tenancy", "property"],
  years_experience: 12,
  rate_paise_per_min: 3_000,
  platform_fee_paise_per_min: 500,
  available_now: true,
  why: null,
};

describe("AdvocateCard (factual fields only)", () => {
  it("shows verification, courts, languages, experience and the disclosed price", () => {
    renderWithIntl(
      <AdvocateCard advocate={advocate} onConnect={vi.fn()} connecting={false} disabled={false} />,
    );
    expect(
      screen.getByText("Verified · Allahabad High Court and District Court, Prayagraj"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Speaks Hindi and English/)).toBeInTheDocument();
    expect(screen.getByText(/12 years in practice/)).toBeInTheDocument();
    expect(screen.getByText("₹30/min + ₹5 platform fee")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect with Demo Aarti Verma" }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b(best|top|win|guarantee|rating)\b/i);
  });

  it("renders the premium reason only when provided", () => {
    renderWithIntl(
      <AdvocateCard
        advocate={{ ...advocate, why: "Practises tenancy matters at Allahabad High Court." }}
        onConnect={vi.fn()}
        connecting={false}
        disabled={false}
      />,
    );
    expect(screen.getByText("Why this advocate")).toBeInTheDocument();
  });
});

const doc = (partial: Partial<SaranshDocument>): SaranshDocument => ({
  id: "d1",
  file_name: "notice.pdf",
  status: "ready",
  error_code: null,
  is_demo: false,
  result: {
    bullets: ["One.", "Two.", "Three."],
    doc_type: "Legal notice",
    parties: [],
    dates: [],
    amounts: [],
    deadlines_mentioned: [],
    language: "en",
    confidence: 0.9,
  },
  ...partial,
});

describe("SaranshCard", () => {
  it("shows exactly three bullets and the AI disclaimer", () => {
    renderWithIntl(<SaranshCard document={doc({})} loading={false} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("AI summary. Please verify with your advocate.")).toBeInTheDocument();
  });

  it("says so when confidence is low", () => {
    renderWithIntl(
      <SaranshCard
        document={doc({ result: { ...doc({}).result!, confidence: 0.4 } })}
        loading={false}
      />,
    );
    expect(screen.getByText(/hard to read/)).toBeInTheDocument();
  });

  it("uses a skeleton (status region), not a spinner, while processing", () => {
    renderWithIntl(
      <SaranshCard document={doc({ status: "processing", result: null })} loading={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Reading your document");
  });
});

describe("PriceBreakdown", () => {
  it("itemises advocate fee, platform fee and GST before the session starts", () => {
    renderWithIntl(
      <PriceBreakdown
        rates={{ adv_rate_paise: 3_000, plat_rate_paise: 500, gst_rate_paise: 90 }}
        gstRateBps={1_800}
      />,
    );
    expect(screen.getByText("₹30.00/min")).toBeInTheDocument();
    expect(screen.getByText("GST on platform fee (18%)")).toBeInTheDocument();
    expect(screen.getByText("₹35.90/min")).toBeInTheDocument();
  });
});
