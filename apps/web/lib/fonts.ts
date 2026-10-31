import localFont from "next/font/local";

export const inter = localFont({
  src: "../app/fonts/inter-latin-wght.woff2",
  weight: "100 900",
  style: "normal",
  // "swap": Inter always replaces the fallback once it arrives. "optional" kept the fallback for the whole visit
  // whenever Inter missed its ~100 ms window, so the site rendered in Arial. The fallback is size-adjusted
  // (next/font), so the swap moves almost nothing.
  display: "swap",
  variable: "--font-inter",
});

// Not preloaded: only fetched when Devanagari glyphs are on the page. ₹ (U+20B9) is deliberately left out of the
// range so prices on English pages render with system fonts instead of downloading this file.
export const devanagari = localFont({
  src: "../app/fonts/noto-sans-devanagari-wght.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  variable: "--font-devanagari",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF",
    },
  ],
});
