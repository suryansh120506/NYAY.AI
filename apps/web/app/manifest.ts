import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nyay.ai",
    short_name: "Nyay.ai",
    description:
      "Consult a verified advocate in Uttar Pradesh or Delhi. Pay only for the minutes you use.",
    start_url: "/en",
    display: "standalone",
    background_color: "#F5F5F7", // design-check-ignore: manifest needs a literal
    theme_color: "#1A237E", // design-check-ignore: manifest needs a literal
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
