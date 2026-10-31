import newsJson from "@/fixtures/news.json";
import type { NewsClient } from "@/lib/api/clients";
import type { NewsCategory, NewsItem, NewsPage, NewsQuery } from "@/lib/api/types";

interface FixtureNews {
  id: string;
  source: string;
  title: string;
  excerpt: string;
  canonical_url: string;
  category: NewsCategory;
  /** Fixtures are relative to "now" so the demo always looks current. */
  minutes_ago: number;
  image_url: string | null;
}

const MAX_EXCERPT = 200;
const MAX_LIMIT = 50;

function truncate(text: string): string {
  return text.length <= MAX_EXCERPT ? text : `${text.slice(0, MAX_EXCERPT - 1).trimEnd()}…`;
}

/** Offline news source (brief §1.3 News: built-in fixtures so the UI works with no network). Server-safe. */
export class FixtureNewsClient implements NewsClient {
  constructor(private readonly now: () => number = Date.now) {}

  async list({ category, limit = 7, cursor }: NewsQuery): Promise<NewsPage> {
    const size = Math.min(Math.max(1, limit), MAX_LIMIT);
    const offset = cursor && /^\d{1,4}$/.test(cursor) ? Number(cursor) : 0;
    const all = (newsJson as FixtureNews[])
      .filter((item) => !category || item.category === category)
      .sort((a, b) => a.minutes_ago - b.minutes_ago);
    const now = this.now();
    const items: NewsItem[] = all.slice(offset, offset + size).map((item) => ({
      id: item.id,
      source: item.source,
      title: item.title,
      excerpt: truncate(item.excerpt),
      canonical_url: item.canonical_url,
      category: item.category,
      published_at: new Date(now - item.minutes_ago * 60_000).toISOString(),
      image_url: item.image_url,
    }));
    return { items, next_cursor: offset + size < all.length ? String(offset + size) : null };
  }
}
