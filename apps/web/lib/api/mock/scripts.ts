// Scripted lines for the simulated advocate in the offline demo. They only ask neutral, fact-finding questions:
// the demo never puts legal advice in anyone's mouth.

export const ADVOCATE_GREETING = {
  en: (firstName: string, hasBrief: boolean) =>
    hasBrief
      ? `Namaste, I'm ${firstName}. I've read the summary you shared. Please tell me what happened, in your own words.`
      : `Namaste, I'm ${firstName}. Please tell me what happened, in your own words.`,
  hi: (firstName: string, hasBrief: boolean) =>
    hasBrief
      ? `नमस्ते, मैं ${firstName} हूँ। आपका भेजा सारांश मैंने पढ़ लिया है। अपने शब्दों में बताइए कि क्या हुआ।`
      : `नमस्ते, मैं ${firstName} हूँ। अपने शब्दों में बताइए कि क्या हुआ।`,
};

export const ADVOCATE_REPLIES = {
  en: [
    "Thank you for explaining. When did this start?",
    "Do you have anything in writing about this, such as an agreement, a receipt or a notice?",
    "Understood. Have you spoken to the other party about it yet?",
    "That helps. Let me ask a couple more questions so I understand the full picture.",
    "Could you share the dates, as closely as you remember them?",
  ],
  hi: [
    "बताने के लिए धन्यवाद। यह कब से चल रहा है?",
    "क्या आपके पास इससे जुड़ा कुछ लिखित है, जैसे अनुबंध, रसीद या नोटिस?",
    "समझ गया। क्या आपने दूसरी पार्टी से इस बारे में बात की है?",
    "इससे मदद मिली। पूरी बात समझने के लिए मैं कुछ और सवाल पूछूँगा।",
    "जितना याद हो, तारीख़ें बता सकते हैं?",
  ],
};
