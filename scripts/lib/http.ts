import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.resolve(".cache");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export interface FetchResult {
  status: number;
  url: string;
  text: string;
  contentType: string;
}

interface Options {
  /** Cache hits younger than this are served from disk. 0 = no cache. */
  ttlMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
  retries?: number;
}

/** fetch() with a browser UA, a timeout, one retry on network errors, and an
 *  optional disk cache. Never throws — a failure is status 0. */
export async function get(url: string, opts: Options = {}): Promise<FetchResult> {
  const { ttlMs = 0, timeoutMs = 15000, headers = {}, method = "GET", body, retries = 1 } = opts;
  const cacheKey = ttlMs > 0 ? createHash("sha1").update(method + url + (body ?? "")).digest("hex") : null;
  const cachePath = cacheKey ? path.join(CACHE_DIR, cacheKey + ".json") : null;

  if (cachePath) {
    try {
      const s = await stat(cachePath);
      if (Date.now() - s.mtimeMs < ttlMs) return JSON.parse(await readFile(cachePath, "utf8")) as FetchResult;
    } catch {
      /* miss */
    }
  }

  let last: FetchResult = { status: 0, url, text: "", contentType: "" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method,
        body,
        headers: { "user-agent": UA, accept: "text/html,application/xml,application/json;q=0.9,*/*;q=0.8", ...headers },
        signal: ctl.signal,
        redirect: "follow",
      });
      last = { status: r.status, url: r.url, text: await r.text(), contentType: r.headers.get("content-type") ?? "" };
      break;
    } catch (e) {
      last = { status: 0, url, text: "", contentType: String((e as Error).message ?? e) };
      if (attempt < retries) await sleep(500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  // Definitive answers only: a 429 or a 5xx is the network's mood, not the URL's.
  if (cachePath && last.status > 0 && last.status !== 429 && last.status !== 408 && last.status < 500) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath, JSON.stringify(last));
  }
  return last;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` over `items` with at most `limit` in flight. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“")
    .replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}
