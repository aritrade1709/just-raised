// Website → the job board the company itself links to. Fetches the homepage
// and its careers pages, then looks for known ATS URL shapes: embeds, iframes,
// links. A slug that a company published is authoritative; a slug that
// happens to exist on Greenhouse is not (see PROJECT.md).

import type { Board, Provider } from "../../src/shared/types.ts";
import { get } from "./http.ts";
import type { Site } from "./domain.ts";

const DAY = 24 * 60 * 60_000;

interface Pattern {
  provider: Provider;
  re: RegExp;
  /** Build a Board from the match. */
  make: (m: RegExpMatchArray) => Board | null;
}

const PATTERNS: Pattern[] = [
  { provider: "greenhouse", re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([A-Za-z0-9_-]+)/g, make: (m) => /^(?:embed|js)$/.test(m[1]!) ? null : board("greenhouse", m[1]!, `https://job-boards.greenhouse.io/${m[1]}`) },
  { provider: "greenhouse", re: /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/g, make: (m) => board("greenhouse", m[1]!, `https://job-boards.greenhouse.io/${m[1]}`) },
  { provider: "lever", re: /jobs(?:\.eu)?\.lever\.co\/([A-Za-z0-9_-]+)/g, make: (m) => board("lever", m[1]!, `https://jobs.lever.co/${m[1]}`) },
  { provider: "lever", re: /api\.lever\.co\/v0\/postings\/([A-Za-z0-9_-]+)/g, make: (m) => board("lever", m[1]!, `https://jobs.lever.co/${m[1]}`) },
  { provider: "ashby", re: /jobs\.ashbyhq\.com\/([A-Za-z0-9_.-]+)/g, make: (m) => board("ashby", m[1]!, `https://jobs.ashbyhq.com/${m[1]}`) },
  { provider: "ashby", re: /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9_.-]+)/g, make: (m) => board("ashby", m[1]!, `https://jobs.ashbyhq.com/${m[1]}`) },
  { provider: "smartrecruiters", re: /(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/g, make: (m) => board("smartrecruiters", m[1]!, `https://careers.smartrecruiters.com/${m[1]}`) },
  { provider: "smartrecruiters", re: /api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9_-]+)/g, make: (m) => board("smartrecruiters", m[1]!, `https://careers.smartrecruiters.com/${m[1]}`) },
  { provider: "workable", re: /apply\.workable\.com\/(?:embed\/)?(?:api\/v\d\/widget\/accounts\/)?([A-Za-z0-9_-]+)/g, make: (m) => /^(?:api|embed|j|jobs)$/.test(m[1]!) ? null : board("workable", m[1]!, `https://apply.workable.com/${m[1]}/`) },
  { provider: "darwinbox", re: /([A-Za-z0-9-]+)\.darwinbox\.in\/ms\/candidate/g, make: (m) => board("darwinbox", m[1]!, `https://${m[1]}.darwinbox.in/ms/candidate/careers`) },
  { provider: "keka", re: /([A-Za-z0-9-]+)\.keka\.com\/careers/g, make: (m) => /^(?:www|app|hr|cdn)$/.test(m[1]!) && m[1] !== "hr" ? null : board("keka", m[1]!, `https://${m[1]}.keka.com/careers/`) },
  { provider: "zoho", re: /([A-Za-z0-9-]+)\.zohorecruit\.(com|in|eu)\b/g, make: (m) => /^(?:www|static|recruit|help|accounts)$/.test(m[1]!) ? null : board("zoho", `${m[1]}.zohorecruit.${m[2]}`, `https://${m[1]}.zohorecruit.${m[2]}/jobs/Careers`) },
  { provider: "freshteam", re: /([A-Za-z0-9-]+)\.freshteam\.com\/jobs/g, make: (m) => board("freshteam", m[1]!, `https://${m[1]}.freshteam.com/jobs`) },
  { provider: "other", re: /([A-Za-z0-9-]+)\.recruitee\.com/g, make: (m) => board("other", `recruitee:${m[1]}`, `https://${m[1]}.recruitee.com/`) },
  { provider: "other", re: /([A-Za-z0-9-]+)\.bamboohr\.com\/(?:careers|jobs)/g, make: (m) => board("other", `bamboohr:${m[1]}`, `https://${m[1]}.bamboohr.com/careers`) },
  { provider: "other", re: /([A-Za-z0-9-]+)\.breezy\.hr/g, make: (m) => board("other", `breezy:${m[1]}`, `https://${m[1]}.breezy.hr/`) },
  { provider: "other", re: /ats\.rippling\.com\/([A-Za-z0-9_-]+)/g, make: (m) => board("other", `rippling:${m[1]}`, `https://ats.rippling.com/${m[1]}/jobs`) },
  { provider: "other", re: /([A-Za-z0-9-]+)\.(?:wd\d+\.)?myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g, make: (m) => board("other", `workday:${m[1]}/${m[2]}`, `https://${m[1]}.myworkdayjobs.com/${m[2]}`) },
  { provider: "other", re: /([A-Za-z0-9-]+)(?:\.[a-z]{2})?\.teamtailor\.com/g, make: (m) => /^(?:www|cdn|app|api|na|eu)$/.test(m[1]!) ? null : board("other", `teamtailor:${m[1]}`, `https://${m[1]}.teamtailor.com/jobs`) },
  { provider: "jazzhr", re: /([A-Za-z0-9-]+)\.applytojob\.com/g, make: (m) => board("jazzhr", m[1]!, `https://${m[1]}.applytojob.com/apply/`) },
  { provider: "other", re: /jobs\.jobvite\.com\/([A-Za-z0-9_-]+)/g, make: (m) => board("other", `jobvite:${m[1]}`, `https://jobs.jobvite.com/${m[1]}/`) },
  { provider: "other", re: /([A-Za-z0-9-]+)\.pinpointhq\.com/g, make: (m) => board("other", `pinpoint:${m[1]}`, `https://${m[1]}.pinpointhq.com/`) },
  { provider: "other", re: /wellfound\.com\/company\/([A-Za-z0-9_-]+)/g, make: (m) => board("other", `wellfound:${m[1]}`, `https://wellfound.com/company/${m[1]}/jobs`) },
  { provider: "other", re: /www\.instahyre\.com\/(?:jobs-at|company)\/([A-Za-z0-9_-]+)/g, make: (m) => board("other", `instahyre:${m[1]}`, `https://www.instahyre.com/jobs-at/${m[1]}/`) },
  { provider: "other", re: /cutshort\.io\/company\/([A-Za-z0-9_-]+)/g, make: (m) => board("other", `cutshort:${m[1]}`, `https://cutshort.io/company/${m[1]}`) },
  { provider: "other", re: /linkedin\.com\/company\/([A-Za-z0-9_%.-]+)\/jobs/g, make: (m) => board("other", `linkedin:${m[1]}`, `https://www.linkedin.com/company/${m[1]}/jobs/`) },
];

function rankScript(src: string): number {
  if (/career|job|join|hiring/i.test(src)) return 3;
  if (/\/pages\/|\/app\/|main|index/i.test(src)) return 2;
  if (/framework|polyfill|webpack|vendor|runtime|chunk-/i.test(src)) return 0;
  return 1;
}

function board(provider: Provider, slug: string, url: string): Board {
  return { provider, slug, url };
}

const CAREER_HREF = /href=["']([^"'#]*(?:career|job|join|hiring|work-with-us|workwithus|opening|opportunit|vacanc|we-are-hiring|talent)[^"']*)["']/gi;

/** Every board-shaped URL in an HTML blob, most specific provider first. */
export function boardsInHtml(html: string): Board[] {
  const found: Board[] = [];
  const seen = new Set<string>();
  for (const p of PATTERNS) {
    for (const m of html.matchAll(p.re)) {
      const b = p.make(m);
      if (!b) continue;
      const k = `${b.provider}:${b.slug}`;
      if (seen.has(k)) continue;
      seen.add(k);
      found.push(b);
    }
  }
  return found;
}

function absolute(href: string, base: string, asset = false): string | null {
  try {
    const u = new URL(href.replace(/&amp;/g, "&"), base);
    if (!/^https?:$/.test(u.protocol)) return null;
    // A careers *link* is a page; a stylesheet named careers.css is not.
    if (!asset && /\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|json|xml|pdf|woff2?|ttf|mp4|zip)(?:$|\?)/i.test(u.pathname)) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

export interface Discovery {
  board: Board | null;
  careersUrl: string | null;
  /** Every distinct board-shaped URL seen, for the overrides file. */
  candidates: Board[];
  pagesFetched: number;
}

/** Walk the site: homepage → careers pages → one level of "see openings". */
export async function discoverBoard(site: Site): Promise<Discovery> {
  const base = site.url;
  const host = site.domain;
  const pages = new Map<string, string>(); // url → html
  pages.set(base, site.html);

  const queue: string[] = [];
  const push = (u: string | null) => {
    if (!u || pages.has(u) || queue.includes(u)) return;
    queue.push(u);
  };
  // Links from the homepage that look like careers.
  for (const m of site.html.matchAll(CAREER_HREF)) push(absolute(m[1]!, base));
  // The usual suspects, whether or not they are linked.
  for (const p of ["/careers", "/careers/", "/jobs", "/career", "/join-us", "/join", "/work-with-us", "/hiring"]) push(absolute(p, base));
  push(`https://careers.${host}/`);
  push(`https://jobs.${host}/`);

  let fetched = 0;
  const external: string[] = [];
  while (queue.length && fetched < 8) {
    const u = queue.shift()!;
    let onSite = false;
    try {
      const h = new URL(u).hostname.replace(/^www\./, "");
      onSite = h === host || h.endsWith("." + host);
    } catch {
      continue;
    }
    if (!onSite) {
      external.push(u);
      continue;
    }
    const r = await get(u, { ttlMs: 3 * DAY, timeoutMs: 12_000, retries: 0 });
    fetched++;
    if (r.status !== 200 || !r.text) continue;
    pages.set(u, r.text);
    // One more level: "View open positions" links on a careers page.
    if (/career|job|join|hiring/i.test(u)) {
      for (const m of r.text.matchAll(/href=["']([^"'#]*(?:position|opening|apply|vacanc|role|jobs?)[^"']*)["']/gi)) push(absolute(m[1]!, u));
    }
  }

  // An ATS embed library with no account URL in the HTML: the account is in
  // a script bundle (Next.js sites do this with Zoho's embed_jobs.js).
  const EMBED_LIB = /zohocdn\.com\/recruit|rec_job_listing_div|greenhouse\.io\/embed|lever\.co\/|ashbyhq\.com|workable\.com\/embed|embedjobs|darwinbox|keka\.com/i;
  for (const [u, html] of [...pages]) {
    if (!/career|job|join|hiring/i.test(u) && u !== base) continue;
    if (!EMBED_LIB.test(html) || boardsInHtml(html).length) continue;
    const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
      .map((m) => absolute(m[1]!, u, true))
      .filter((x): x is string => !!x)
      // The page's own chunk first ("pages/careers-…js"), framework chunks last.
      .sort((a, b) => rankScript(b) - rankScript(a));
    let scanned = 0;
    for (const src of scripts) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(src).hostname.replace(/^www\./, "").endsWith(host) || /\/_next\/|\/assets\//.test(src);
      } catch {
        continue;
      }
      if (!sameOrigin || scanned >= 16) continue;
      const r = await get(src, { ttlMs: 3 * DAY, timeoutMs: 12_000, retries: 0 });
      scanned++;
      if (r.status === 200 && r.text.length < 3_000_000 && boardsInHtml(r.text).length) {
        pages.set(src, r.text);
        break;
      }
    }
    break;
  }

  const candidates: Board[] = [];
  const seen = new Set<string>();
  const consider = (html: string) => {
    for (const b of boardsInHtml(html)) {
      const k = `${b.provider}:${b.slug}`;
      if (seen.has(k)) continue;
      seen.add(k);
      candidates.push(b);
    }
  };
  // Careers pages first so their embeds outrank a stray footer link.
  for (const [u, html] of [...pages].sort((a, b) => Number(/career|job|join|hiring/i.test(b[0])) - Number(/career|job|join|hiring/i.test(a[0])))) {
    void u;
    consider(html);
  }
  // External careers links (e.g. the nav "Careers" points straight at Lever).
  for (const u of external) consider(u);

  // Prefer providers with a readable API, then anything with a page.
  const rank = (b: Board) => (b.provider === "other" ? 1 : 2);
  candidates.sort((a, b) => rank(b) - rank(a));
  const best = candidates[0] ?? null;

  // Human careers page: the first on-site careers URL that returned 200, else
  // the first external careers link.
  const careersUrl =
    [...pages.keys()].find((u) => u !== base && /career|job|join|hiring/i.test(u)) ?? external.find((u) => /career|job|join|hiring|lever|greenhouse|ashby|workable|keka|darwinbox|zoho/i.test(u)) ?? null;

  return { board: best, careersUrl, candidates, pagesFetched: fetched };
}
