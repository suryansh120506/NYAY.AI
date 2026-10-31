import { getTranslations } from "next-intl/server";
import { getNewsClient } from "@/lib/api/news";
import { publicConfig } from "@/lib/config";
import { NewsFeedView } from "./NewsFeedView";

/**
 * "Legal updates" (brief §3.2). Server Component: the page revalidates every 300 s, matching the API cache TTL.
 * Fetches enough items for every category so the pills can filter on the client.
 */
export async function NewsFeed() {
  const t = await getTranslations("News");
  let page;
  try {
    page = await getNewsClient().list({ limit: 30 });
  } catch {
    return <p className="text-callout text-ink-2">{t("loadError")}</p>;
  }
  // Server time for the first render of relative timestamps; the client takes over after hydration.
  const serverNow = Date.now();
  return (
    <>
      {publicConfig.useMocks ? (
        <p className="mt-2 text-caption text-ink-2">{t("fixtureNote")}</p>
      ) : null}
      <NewsFeedView items={page.items} serverNow={serverNow} />
    </>
  );
}
