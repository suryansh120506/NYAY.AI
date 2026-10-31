import type { MetadataRoute } from "next";
import { publicConfig } from "@/lib/config";
import { routing } from "@/lib/i18n/routing";

const PATHS = ["", "/updates", "/saransh", "/terms", "/privacy"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: `${publicConfig.siteUrl}/${locale}${path}`,
      alternates: {
        languages: Object.fromEntries(
          routing.locales.map((l) => [l, `${publicConfig.siteUrl}/${l}${path}`]),
        ),
      },
    })),
  );
}
