import { get, decodeEntities } from "./http.ts";

export interface FeedItem {
  title: string;
  link: string;
  date: Date;
  /** Outlet name, from <source> (Google News) or the feed itself. */
  outlet: string;
  feed: string;
}

function field(item: string, tag: string): string | null {
  const m = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return m && m[1] !== undefined ? decodeEntities(m[1]).trim() : null;
}

/** Parse RSS 2.0 items. Tolerant of CDATA and namespaced tags. */
export function parseRss(xml: string, feedName: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1]!;
    const title = field(it, "title");
    const link = field(it, "link") ?? it.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? null;
    const pub = field(it, "pubDate") ?? field(it, "dc:date");
    if (!title || !link || !pub) continue;
    const date = new Date(pub);
    if (Number.isNaN(date.getTime())) continue;
    const source = field(it, "source") ?? feedName;
    items.push({ title, link, date, outlet: source, feed: feedName });
  }
  return items;
}

export async function fetchFeed(url: string, feedName: string, ttlMs: number): Promise<FeedItem[]> {
  const r = await get(url, { ttlMs, timeoutMs: 20000 });
  if (r.status !== 200) {
    console.warn(`  feed ${feedName}: HTTP ${r.status} ${url}`);
    return [];
  }
  return parseRss(r.text, feedName);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Google News RSS with a date window. `q` is a plain query string. */
export function googleNewsUrl(q: string, after: Date, before: Date): string {
  const query = `${q} after:${iso(after)} before:${iso(before)}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}
