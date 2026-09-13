// Step 1: funding events from headlines.
//
// Google News RSS, queried per week with after:/before: so the last WINDOW days
// backfill on a cold run; Entrackr, Inc42 and YourStory RSS for the freshest
// items with real article URLs. Everything is parsed by src/shared/headline.ts
// and deduplicated per company per round.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseHeadline, stripOutlet } from "../src/shared/headline.ts";
import type { FundingEvent } from "../src/shared/types.ts";
import { fetchFeed, googleNewsUrl, type FeedItem } from "./lib/feeds.ts";
import { pool, sleep } from "./lib/http.ts";

export const WINDOW_DAYS = 120;
const DAY = 86_400_000;
const OUT = "data/funding.json";

const QUERIES = [
  "startup raises india",
  "startup raises funding india",
  "raises crore startup",
  "raises seed round india startup",
  "raises series a india startup",
  "raises series b india startup",
  "secures funding indian startup",
  "bags funding startup india",
  "startup raises pre-seed india",
  "raises million led by india startup",
];

const DIRECT_FEEDS: Array<[string, string]> = [
  ["Entrackr", "https://entrackr.com/rss"],
  ["Inc42", "https://inc42.com/feed/"],
  ["Inc42 Buzz", "https://inc42.com/buzz/feed/"],
  ["YourStory", "https://yourstory.com/feed"],
];

// Outlets that only cover Indian startups, so an item from them is an Indian
// startup even when the headline does not say so. Broad Indian business
// press (ET, Mint, Moneycontrol) covers Databricks too, so it is not enough.
const STARTUP_OUTLETS =
  /entrackr|inc42|yourstory|vccircle|the ken|startup story|indian startup news|indianstartupnews|indianstartuptimes|startuptalky|techcircle|medianama|analytics india|the arc|indian retailer|startup pedia|startupedia|siliconindia|digital health news|bw (?:disrupt|healthcare)|ettech|et entrepreneur|entrepreneur india|yourstory|vcbay|startup news india|startup reporter|the tech portal|techgraph|ceo insights|business outreach/i;

// Social posts, PR wires and content farms that Google News indexes anyway.
const OUTLET_BLOCKLIST =
  /instagram|facebook|linkedin|youtube|twitter|\bx\.com|reddit|quora|prnewswire|businesswire|newswire|einpresswire|openpr|devdiscourse|wansom|press release|substack|medium\.com|blogspot|wordpress|tumblr|pinterest|threads\.net/i;

// Strong: only an Indian startup gets written up this way.
const INDIA_STRONG =
  /\b(bengaluru|bangalore|mumbai|delhi|gurugram|gurgaon|noida|hyderabad|pune|chennai|kolkata|ahmedabad|jaipur|kochi|indore|rs\.?|inr|crore|cr|lakh|₹)\b|\bindian startup\b|\bindia-based\b|\bhomegrown\b/i;
// Weak: the word alone; "Revolut ... enters India" also matches.
const INDIA_WEAK = /\bindia'?s?\b|\bindian\b/i;
// Negative: the founder is Indian, the company is not.
const NOT_INDIA = /indian[- ]origin|india[- ]born|indian[- ]american|indian[- ]founded|\bnri\b|of indian (?:origin|descent)|indian founders?|desi founders?/i;

function isGoogleLink(url: string): boolean {
  return /news\.google\.com/.test(url);
}

async function collect(): Promise<FeedItem[]> {
  const now = new Date();
  const items: FeedItem[] = [];

  // Direct feeds: short TTL, they are the freshest signal.
  for (const [name, url] of DIRECT_FEEDS) {
    const got = await fetchFeed(url, name, 30 * 60_000);
    console.log(`  ${name}: ${got.length} items`);
    items.push(...got);
  }

  // Google News: weekly windows back to WINDOW_DAYS. Past weeks are cached for
  // a day, the current week for an hour.
  const weeks: Array<[Date, Date]> = [];
  for (let end = new Date(now.getTime() + DAY); end.getTime() > now.getTime() - WINDOW_DAYS * DAY; ) {
    const start = new Date(end.getTime() - 7 * DAY);
    weeks.push([start, end]);
    end = start;
  }
  const tasks = QUERIES.flatMap((q) => weeks.map(([a, b]) => ({ q, a, b })));
  let done = 0;
  const results = await pool(tasks, 3, async ({ q, a, b }) => {
    const current = b.getTime() > now.getTime();
    const got = await fetchFeed(googleNewsUrl(q, a, b), "Google News", current ? 60 * 60_000 : 24 * 60 * 60_000);
    await sleep(250);
    if (++done % 20 === 0) console.log(`  google news: ${done}/${tasks.length} queries`);
    return got;
  });
  for (const r of results) items.push(...r);
  console.log(`  google news: ${results.flat().length} items from ${tasks.length} queries`);
  return items;
}

export function eventsFromItems(items: FeedItem[], now = new Date()): FundingEvent[] {
  const cutoff = now.getTime() - WINDOW_DAYS * DAY;
  const byKey = new Map<string, FundingEvent[]>();
  let parsed = 0;

  for (const it of items) {
    if (it.date.getTime() < cutoff || it.date.getTime() > now.getTime() + DAY) continue;
    const p = parseHeadline(it.title);
    if (!p || !p.key) continue;
    parsed++;
    const { title, outlet: outletFromTitle } = stripOutlet(it.title);
    const outlet = it.outlet && it.outlet !== "Google News" ? it.outlet : (outletFromTitle ?? it.feed);
    if (OUTLET_BLOCKLIST.test(outlet) || OUTLET_BLOCKLIST.test(it.link)) continue;
    const indian: 0 | 1 | 2 = NOT_INDIA.test(it.title)
      ? 0
      : STARTUP_OUTLETS.test(outlet) || INDIA_STRONG.test(it.title) || p.currency === "INR"
        ? 2
        : INDIA_WEAK.test(it.title)
          ? 1
          : 0;
    const ev: FundingEvent & { _indian?: 0 | 1 | 2 } = {
      id: "",
      company: p.company,
      key: p.key,
      descriptor: p.descriptor,
      amount: p.amount,
      currency: p.currency,
      usd: p.usd,
      round: p.round,
      investors: p.investors,
      date: it.date.toISOString().slice(0, 10),
      sources: [{ outlet, url: it.link, title }],
      indiaSignal: indian === 2 ? "strong" : "weak",
      _indian: indian,
    };
    const list = byKey.get(p.key) ?? [];
    list.push(ev);
    byKey.set(p.key, list);
  }

  // Merge sightings of the same company within 21 days into one round.
  const out: FundingEvent[] = [];
  for (const [, list] of byKey) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    let group: typeof list = [];
    const flush = () => {
      if (!group.length) return;
      const merged = mergeGroup(group);
      if (merged) out.push(merged);
      group = [];
    };
    for (const ev of list) {
      const first = group[0];
      if (first && Date.parse(ev.date) - Date.parse(first.date) > 21 * DAY) flush();
      group.push(ev);
    }
    flush();
  }
  // "Exponent" and "Exponent Energy", "Wispr" and "Wispr Flow": one key is a
  // prefix of the other, same fortnight, same money → the same round.
  out.sort((a, b) => a.date.localeCompare(b.date));
  const merged: FundingEvent[] = [];
  for (const ev of out) {
    const twin = merged.find(
      (m) =>
        (m.key.startsWith(ev.key) || ev.key.startsWith(m.key)) &&
        Math.min(m.key.length, ev.key.length) >= 4 &&
        Math.abs(Date.parse(m.date) - Date.parse(ev.date)) <= 21 * DAY &&
        (m.usd === null || ev.usd === null || Math.abs(m.usd - ev.usd) / Math.max(m.usd, ev.usd) < 0.05),
    );
    if (!twin) {
      merged.push(ev);
      continue;
    }
    const longer = twin.key.length >= ev.key.length ? twin : ev;
    const shorter = longer === twin ? ev : twin;
    const combined = mergeGroup([{ ...longer, _indian: 2 }, { ...shorter, _indian: 2 }])!;
    merged[merged.indexOf(twin)] = { ...combined, company: longer.company, key: longer.key, id: `${longer.key}-${combined.date}` };
  }
  console.log(`  parsed ${parsed} funding headlines → ${merged.length} distinct rounds`);
  merged.sort((a, b) => b.date.localeCompare(a.date) || (b.usd ?? 0) - (a.usd ?? 0));
  return merged;
}

function mergeGroup(group: Array<FundingEvent & { _indian?: 0 | 1 | 2 }>): FundingEvent | null {
  // Require an India signal from at least one sighting: the Google query has
  // "india" in it but Reuters/TechCrunch items about US startups still leak.
  // Weak-only signals survive here and are settled by the domain step, which
  // looks for India on the company's own site.
  const strength = Math.max(...group.map((g) => g._indian ?? 0));
  if (strength === 0) return null;

  const withAmount = group.filter((g) => g.amount !== null);
  // Most-agreed amount wins; ties go to the earliest sighting.
  const amountVotes = new Map<string, number>();
  for (const g of withAmount) amountVotes.set(`${g.currency}:${g.amount}`, (amountVotes.get(`${g.currency}:${g.amount}`) ?? 0) + 1);
  const bestAmountKey = [...amountVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const best = withAmount.find((g) => `${g.currency}:${g.amount}` === bestAmountKey) ?? group[0]!;

  // The longest well-formed company spelling, preferring one with mixed case.
  const name = [...group].map((g) => g.company).sort((a, b) => score(b) - score(a))[0]!;
  const descriptor = group.map((g) => g.descriptor).filter((d): d is string => !!d).sort((a, b) => b.length - a.length)[0] ?? null;
  const round = group.map((g) => g.round).find((r) => r) ?? null;
  const investors = [...new Set(group.flatMap((g) => g.investors))].slice(0, 6);
  const sources = dedupeSources(group.flatMap((g) => g.sources));
  const date = group[0]!.date;
  return {
    id: `${best.key}-${date}`,
    company: name,
    key: best.key,
    descriptor,
    amount: best.amount,
    currency: best.currency,
    usd: best.usd,
    round,
    investors,
    date,
    sources,
    indiaSignal: strength === 2 ? "strong" : "weak",
  };
}

function score(name: string): number {
  // Prefer names that are not ALL CAPS or all lowercase, then the longer
  // spelling ("QNu Labs" over "QNu", "River Mobility" over "River") — it is
  // what the domain search needs — as long as it is still a name.
  const mixed = /[a-z]/.test(name) && /[A-Z]/.test(name) ? 10 : 0;
  const words = name.split(" ").length;
  return mixed + (words <= 3 ? words : 3 - words);
}

function dedupeSources(sources: FundingEvent["sources"]): FundingEvent["sources"] {
  const seen = new Set<string>();
  const direct = sources.filter((s) => !isGoogleLink(s.url));
  const google = sources.filter((s) => isGoogleLink(s.url));
  const out: FundingEvent["sources"] = [];
  for (const s of [...direct, ...google]) {
    const k = s.outlet.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length === 4) break;
  }
  return out;
}

export async function loadFunding(): Promise<FundingEvent[]> {
  try {
    return JSON.parse(await readFile(OUT, "utf8")) as FundingEvent[];
  } catch {
    return [];
  }
}

export async function runFunding(): Promise<FundingEvent[]> {
  console.log("funding: collecting feeds");
  const items = await collect();
  const fresh = eventsFromItems(items);

  // Keep previously seen rounds that are still inside the window even if the
  // feeds no longer return them — Google's index is not stable week to week.
  const previous = await loadFunding();
  const cutoff = Date.now() - WINDOW_DAYS * DAY;
  const merged = new Map<string, FundingEvent>();
  for (const ev of previous) if (Date.parse(ev.date) >= cutoff) merged.set(ev.id, ev);
  for (const ev of fresh) {
    const old = [...merged.values()].find((o) => o.key === ev.key && Math.abs(Date.parse(o.date) - Date.parse(ev.date)) <= 21 * DAY);
    if (old) merged.delete(old.id);
    merged.set(ev.id, ev);
  }
  const events = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date) || (b.usd ?? 0) - (a.usd ?? 0));
  await mkdir("data", { recursive: true });
  await writeFile(OUT, JSON.stringify(events, null, 1) + "\n");
  console.log(`funding: ${events.length} rounds in the last ${WINDOW_DAYS} days → ${OUT}`);
  return events;
}

if (process.argv[1] && /funding\.ts$/.test(process.argv[1])) {
  await runFunding();
}
