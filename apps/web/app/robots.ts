import type { MetadataRoute } from "next";
import { publicConfig } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Signed-in screens and the dev styleguide are never indexed.
        disallow: [
          "/en/samvaad/",
          "/hi/samvaad/",
          "/en/wallet",
          "/hi/wallet",
          "/en/advocate",
          "/hi/advocate",
          "/en/dev",
          "/hi/dev",
        ],
      },
    ],
    sitemap: `${publicConfig.siteUrl}/sitemap.xml`,
  };
}
