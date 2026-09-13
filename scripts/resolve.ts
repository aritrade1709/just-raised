// Step 2: company → domain → job board. The join nobody publishes.
//
// Results are cached in data/boards.json and committed, so a nightly run only
// works on companies it has not seen (or failed on more than a week ago).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { Board, CompanyRecord, FundingEvent, Provider } from "../src/shared/types.ts";
import { fetchJobs, kekaGuid, SNAPSHOT_PROVIDERS } from "../src/shared/providers.ts";
import { resolveSite, keyOf } from "./lib/domain.ts";
import { discoverBoard } from "./lib/discover.ts";
import { get, pool } from "./lib/http.ts";
import { loadFunding } from "./funding.ts";

const OUT = "data/boards.json";
const OVERRIDES = "data/overrides.json";
const DAY = 24 * 60 * 60_000;
const RETRY_AFTER = 7 * DAY;

interface Override {
  domain?: string;
  board?: Board;
  careersUrl?: string;
  /** Drop the company from the site entirely (not Indian, not a startup). */
  exclude?: boolean;
  /** The resolver found somebody else's board; show a careers link only. */
  noBoard?: boolean;
  /** The resolver found somebody else's *site*; keep the round, drop the domain. */
  noSite?: boolean;
}

export async function loadBoards(): Promise<Record<string, CompanyRecord>> {
  try {
    const boards = JSON.parse(await readFile(OUT, "utf8")) as Record<string, CompanyRecord>;
    // Zoho slugs are the host only; older records carried the page path.
    for (const r of Object.values(boards)) if (r.board?.provider === "zoho" && r.board.slug.includes("/")) r.board = { ...r.board, slug: r.board.slug.split("/")[0]! };
    return boards;
  } catch {
    return {};
  }
}

async function loadOverrides(): Promise<Record<string, Override>> {
  try {
    const raw = JSON.parse(await readFile(OVERRIDES, "utf8")) as Record<string, Override | string>;
    const out: Record<string, Override> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === "object") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** Fetch a board's jobs and report whether it has India roles. */
async function probeBoard(board: Board): Promise<{ ok: boolean; total: number; india: number; error?: string }> {
  if (!SNAPSHOT_PROVIDERS.has(board.provider)) return { ok: true, total: -1, india: -1 };
  try {
    const jobs = await fetchJobs(board);
    return { ok: true, total: jobs.length, india: jobs.filter((j) => j.india).length };
  } catch (e) {
    return { ok: false, total: 0, india: 0, error: (e as Error).message };
  }
}

/** Last resort: guess slugs. Accepted only with an India location on the
 *  board, and for providers that expose a company name, a name match. */
async function probeSlugs(company: string, key: string): Promise<Board | null> {
  const words = company.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().split(/\s+/);
  const variants = [...new Set([key, words.join("-"), words.join("_"), words[0]!.length >= 5 ? words[0]! : ""].filter(Boolean))];
  const providers: Provider[] = ["greenhouse", "lever", "ashby", "keka", "smartrecruiters", "workable"];
  for (const slug of variants) {
    for (const provider of providers) {
      const board: Board = { provider, slug, url: boardUrl(provider, slug) };
      const p = await probeBoard(board);
      if (!p.ok || p.total <= 0 || p.india <= 0) continue;
      // Name check where the provider tells us whose board it is.
      if (provider === "smartrecruiters" || provider === "workable" || provider === "greenhouse") {
        const name = await boardName(provider, slug);
        if (name && !sameCompany(name, company)) continue;
      }
      return board;
    }
  }
  // Darwinbox tenants: the careers page is reachable from Node even though the
  // API is not. Only the full name is trusted as a tenant slug.
  const r = await get(`https://${key}.darwinbox.in/ms/candidate/careers`, { ttlMs: 3 * DAY, retries: 0, timeoutMs: 10_000 });
  if (r.status === 200 && /darwinbox/i.test(r.text) && !/Invalid|not found/i.test(r.text.slice(0, 2000))) {
    return { provider: "darwinbox", slug: key, url: `https://${key}.darwinbox.in/ms/candidate/careers` };
  }
  return null;
}

function boardUrl(provider: Provider, slug: string): string {
  switch (provider) {
    case "greenhouse": return `https://job-boards.greenhouse.io/${slug}`;
    case "lever": return `https://jobs.lever.co/${slug}`;
    case "ashby": return `https://jobs.ashbyhq.com/${slug}`;
    case "keka": return `https://${slug}.keka.com/careers/`;
    case "smartrecruiters": return `https://careers.smartrecruiters.com/${slug}`;
    case "workable": return `https://apply.workable.com/${slug}/`;
    case "darwinbox": return `https://${slug}.darwinbox.in/ms/candidate/careers`;
    default: return "";
  }
}

async function boardName(provider: Provider, slug: string): Promise<string | null> {
  try {
    if (provider === "greenhouse") {
      const r = await get(`https://boards-api.greenhouse.io/v1/boards/${slug}`, { ttlMs: 3 * DAY, retries: 0 });
      return r.status === 200 ? ((JSON.parse(r.text) as { name?: string }).name ?? null) : null;
    }
    if (provider === "workable") {
      const r = await get(`https://apply.workable.com/api/v1/widget/accounts/${slug}`, { ttlMs: 3 * DAY, retries: 0 });
      return r.status === 200 ? ((JSON.parse(r.text) as { name?: string }).name ?? null) : null;
    }
    if (provider === "smartrecruiters") {
      const r = await get(`https://api.smartrecruiters.com/v1/companies/${slug}`, { ttlMs: 3 * DAY, retries: 0 });
      return r.status === 200 ? ((JSON.parse(r.text) as { name?: string }).name ?? null) : null;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function sameCompany(a: string, b: string): boolean {
  const ka = keyOf(a).replace(/(pvt|private|ltd|limited|inc|technologies|technology|tech|labs|india|solutions)/g, "");
  const kb = keyOf(b).replace(/(pvt|private|ltd|limited|inc|technologies|technology|tech|labs|india|solutions)/g, "");
  return ka === kb || ka.startsWith(kb) || kb.startsWith(ka);
}

async function resolveOne(ev: FundingEvent, prev: CompanyRecord | undefined, override: Override | undefined): Promise<CompanyRecord> {
  const now = new Date().toISOString();
  const base: CompanyRecord = { key: ev.key, company: ev.company, domain: prev?.domain ?? null, board: null, careersUrl: null, india: prev?.india ?? null, checkedAt: now };

  if (override?.exclude) return { ...base, note: "excluded by override" };
  if (override?.noSite) return { ...base, domain: null, india: null, careersUrl: override.careersUrl ?? null, via: "override", note: "site withheld by override" };
  if (override?.noBoard) {
    const { site } = await resolveSite(ev.company, override.domain ?? prev?.domain, ev.descriptor);
    return { ...base, domain: override.domain ?? site?.domain ?? base.domain, india: site?.india ?? base.india, careersUrl: override.careersUrl ?? null, via: "override", note: "board withheld by override" };
  }
  if (override?.board) {
    const p = await probeBoard(override.board);
    let board = override.board;
    if (board.provider === "keka" && !board.meta?.guid) {
      const guid = await kekaGuid(board.slug);
      if (guid) board = { ...board, meta: { guid } };
    }
    return { ...base, domain: override.domain ?? base.domain, board, careersUrl: override.careersUrl ?? board.url, india: p.india > 0 ? true : base.india, via: "override" };
  }

  const { site, tried } = await resolveSite(ev.company, override?.domain ?? prev?.domain, ev.descriptor);
  if (!site) return { ...base, note: `no site found (${tried} candidates)` };
  base.domain = site.domain;
  base.india = site.india;

  const d = await discoverBoard(site);
  let board = d.board;
  let via: CompanyRecord["via"] = "site";
  if (board) {
    if (board.provider === "keka") {
      const guid = await kekaGuid(board.slug);
      if (guid) board = { ...board, meta: { guid } };
    }
    const p = await probeBoard(board);
    if (!p.ok) base.note = `board found on site but unreadable: ${p.error}`;
    if (p.india > 0) base.india = true;
    if (p.ok && p.total === 0 && d.candidates.length > 1) {
      // An empty embed next to a live one: try the next candidate.
      for (const alt of d.candidates.slice(1)) {
        const q = await probeBoard(alt);
        if (q.ok && q.total > 0) {
          board = alt;
          if (q.india > 0) base.india = true;
          break;
        }
      }
    }
  } else {
    board = await probeSlugs(ev.company, ev.key);
    if (board) {
      via = "probe";
      base.india = true;
    }
  }
  return { ...base, board, careersUrl: override?.careersUrl ?? d.careersUrl ?? board?.url ?? null, via: board ? via : undefined };
}

export async function runResolve(events?: FundingEvent[]): Promise<Record<string, CompanyRecord>> {
  const evs = events ?? (await loadFunding());
  const boards = await loadBoards();
  const overrides = await loadOverrides();

  // One record per company, newest event's spelling.
  const byKey = new Map<string, FundingEvent>();
  for (const ev of evs) if (!byKey.has(ev.key)) byKey.set(ev.key, ev);

  // `--retry` re-runs discovery for companies with a site but no board
  // (used after the discovery code improves); the domain is reused.
  const retry = process.argv.includes("--retry");
  const todo = [...byKey.values()].filter((ev) => {
    const prev = boards[ev.key];
    if (!prev) return true;
    if (overrides[ev.key]) return prev.via !== "override";
    if (prev.board) return false;
    if (retry && prev.domain) return true;
    if (process.argv.includes("--retry-nosite") && !prev.domain) return true;
    return Date.now() - Date.parse(prev.checkedAt) > RETRY_AFTER;
  });
  console.log(`resolve: ${byKey.size} companies, ${todo.length} to (re)check`);

  let done = 0;
  await pool(todo, Number(process.env.CONCURRENCY ?? 5), async (ev) => {
    const rec = await resolveOne(ev, boards[ev.key], overrides[ev.key]);
    boards[ev.key] = rec;
    done++;
    const tag = rec.board ? `${rec.board.provider}:${rec.board.slug}${rec.via === "probe" ? " (probe)" : ""}` : rec.careersUrl ? "careers page only" : rec.note ?? "nothing";
    console.log(`  [${done}/${todo.length}] ${ev.company.padEnd(28)} ${(rec.domain ?? "-").padEnd(26)} ${rec.india === true ? "IN" : rec.india === false ? "--" : "??"}  ${tag}`);
  });

  // Drop companies no longer in the window so the file does not grow forever.
  for (const k of Object.keys(boards)) if (!byKey.has(k)) delete boards[k];

  await mkdir("data", { recursive: true });
  const sorted = Object.fromEntries(Object.entries(boards).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(OUT, JSON.stringify(sorted, null, 1) + "\n");
  const withBoard = Object.values(boards).filter((b) => b.board).length;
  const withSite = Object.values(boards).filter((b) => b.domain).length;
  console.log(`resolve: ${withSite}/${byKey.size} sites found, ${withBoard} boards → ${OUT}`);
  return boards;
}

if (process.argv[1] && /resolve\.ts$/.test(process.argv[1])) {
  await runResolve();
}
