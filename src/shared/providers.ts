// One fetcher per ATS. Runs in Node (nightly snapshot) and in the browser
// (live refresh) — plain fetch(), no Node imports. Every fetcher returns the
// same Job shape so the page does not care where a board lives.

import type { Board, Job, Provider } from "./types.ts";
import { isIndia } from "./india.ts";

const TIMEOUT = 15_000;

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (text.trimStart().startsWith("<")) throw new Error("HTML, not JSON");
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(t);
  }
}

async function getText(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const job = (title: string, location: string, url: string, posted: string | null, department: string | null): Job => ({
  title: title.replace(/\s+/g, " ").trim(),
  location: location.replace(/\r/g, "").replace(/\s+/g, " ").trim(),
  india: isIndia(location),
  url,
  posted,
  department: department?.trim() || null,
});

interface GreenhouseJob { title: string; absolute_url: string; location?: { name?: string }; updated_at?: string; first_published?: string }
async function greenhouse(slug: string): Promise<Job[]> {
  let j: { jobs: GreenhouseJob[] };
  try {
    j = await getJson<{ jobs: GreenhouseJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
  } catch {
    // Boards hosted in Greenhouse's EU region answer on the EU API host.
    j = await getJson<{ jobs: GreenhouseJob[] }>(`https://boards-api.eu.greenhouse.io/v1/boards/${slug}/jobs`);
  }
  return j.jobs.map((x) => job(x.title, x.location?.name ?? "", x.absolute_url, iso(x.first_published ?? x.updated_at), null));
}

interface LeverJob { text: string; hostedUrl: string; categories?: { location?: string; allLocations?: string[]; team?: string; department?: string }; createdAt?: number; workplaceType?: string }
async function lever(slug: string): Promise<Job[]> {
  const j = await getJson<LeverJob[]>(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  return j.map((x) => {
    const locs = x.categories?.allLocations?.length ? x.categories.allLocations.join(" / ") : (x.categories?.location ?? "");
    const loc = x.workplaceType === "remote" && !/remote/i.test(locs) ? `Remote · ${locs}` : locs;
    return job(x.text, loc, x.hostedUrl, iso(x.createdAt), x.categories?.team ?? x.categories?.department ?? null);
  });
}

interface AshbyJob { title: string; location?: string; secondaryLocations?: Array<{ location?: string }>; department?: string; team?: string; isRemote?: boolean; jobUrl: string; publishedAt?: string }
async function ashby(slug: string): Promise<Job[]> {
  const j = await getJson<{ jobs: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  return j.jobs.map((x) => {
    const locs = [x.location, ...(x.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join(" / ");
    return job(x.title, x.isRemote && !/remote/i.test(locs) ? `Remote · ${locs}` : locs, x.jobUrl, iso(x.publishedAt), x.department ?? x.team ?? null);
  });
}

interface SRJob { id: string; name: string; releasedDate?: string; location?: { city?: string; region?: string; country?: string; remote?: boolean }; department?: { label?: string } }
async function smartrecruiters(slug: string): Promise<Job[]> {
  const out: Job[] = [];
  for (let offset = 0; offset < 400; offset += 100) {
    const j = await getJson<{ totalFound: number; content: SRJob[] }>(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=${offset}`);
    for (const x of j.content) {
      const loc = [x.location?.city, x.location?.region, x.location?.country?.toUpperCase()].filter(Boolean).join(", ");
      out.push(job(x.name, x.location?.remote ? `Remote · ${loc}` : loc, `https://jobs.smartrecruiters.com/${slug}/${x.id}`, iso(x.releasedDate), x.department?.label ?? null));
    }
    if (offset + 100 >= j.totalFound) break;
  }
  return out;
}

interface WorkableJob { title: string; url: string; location?: { city?: string; region?: string; country?: string; workplaceType?: string }; department?: string; published_on?: string; created_at?: string }
async function workable(slug: string): Promise<Job[]> {
  const j = await getJson<{ jobs: WorkableJob[] }>(`https://apply.workable.com/api/v1/widget/accounts/${slug}`);
  return j.jobs.map((x) => {
    const loc = [x.location?.city, x.location?.region, x.location?.country].filter(Boolean).join(", ");
    return job(x.title, x.location?.workplaceType === "remote" ? `Remote · ${loc}` : loc, x.url, iso(x.published_on ?? x.created_at), x.department ?? null);
  });
}

interface DarwinboxJob { id: string; title?: string; designation_name?: string; locations?: string; officelocations_area?: string[]; country?: string; department_name?: string; created_on?: string; posted_on?: number; is_remote?: number }
async function darwinbox(tenant: string): Promise<Job[]> {
  const j = await getJson<{ status: string; data: DarwinboxJob[] }>(`https://${tenant}.darwinbox.in/ms/candidateapi/job/alljobs?companyId=main`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return (j.data ?? []).map((x) => {
    const loc = (x.officelocations_area?.join(" / ") || x.locations || x.country || "").replace(/\r/g, "");
    return job(x.title ?? x.designation_name ?? "", x.is_remote ? `Remote · ${loc}` : loc, `https://${tenant}.darwinbox.in/ms/candidate/careers/${x.id}`, iso(x.posted_on ?? x.created_on), x.department_name ?? null);
  });
}

interface KekaJob { id: number; title: string; jobLocations?: Array<{ city?: string; state?: string; countryName?: string; countryCode?: string }>; departmentName?: string; publishedOn?: string }
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
async function keka(tenant: string, guid?: string): Promise<Job[]> {
  // Newer portals answer without an embed id; older ones need the GUID that
  // sits in the careers HTML.
  let j: KekaJob[];
  try {
    j = await getJson<KekaJob[]>(`https://${tenant}.keka.com/careers/api/jobs/default/active`);
  } catch {
    let g = guid;
    if (!g) {
      const html = await getText(`https://${tenant}.keka.com/careers/`);
      g = html.match(GUID)?.[0];
      if (!g) throw new Error("no Keka embed id in careers page");
    }
    j = await getJson<KekaJob[]>(`https://${tenant}.keka.com/careers/api/embedjobs/default/active/${g}`);
  }
  return j.map((x) => {
    const loc = (x.jobLocations ?? []).map((l) => [l.city, l.countryName].filter(Boolean).join(", ")).join(" / ");
    return job(x.title, loc, `https://${tenant}.keka.com/careers/jobdetails/${x.id}`, iso(x.publishedOn), x.departmentName ?? null);
  });
}

interface ZohoJob { id: string; Posting_Title?: string; Job_Opening_Name?: string; City?: string; State?: string; Country?: string; Remote_Job?: boolean; Date_Opened?: string; Department_Name?: string; Industry?: string }
/** Zoho Recruit career sites are server-rendered with the openings as an
 *  HTML-encoded JSON array in a hidden input. Not CORS-open: Node only. */
async function zoho(host: string): Promise<Job[]> {
  const html = await getText(`https://${host}/jobs/Careers`);
  // Several hidden inputs carry JSON; the openings are the array whose
  // objects have Job_Opening_Name as a top-level key (the field-metadata
  // input merely mentions it).
  let list: ZohoJob[] | null = null;
  for (const m of html.matchAll(/<input[^>]+value="(\[\{[^"]*)"/g)) {
    const decoded = m[1]!.replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    try {
      const parsed = JSON.parse(decoded) as unknown;
      if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === "object" && parsed[0] !== null && ("Job_Opening_Name" in parsed[0] || "Posting_Title" in parsed[0])) {
        list = parsed as ZohoJob[];
        break;
      }
    } catch {
      /* not this one */
    }
  }
  if (!list) {
    if (/<input[^>]+id="moduleMeta"/.test(html)) return []; // a real Zoho site with nothing open
    throw new Error("no openings JSON on Zoho careers page");
  }
  return list.map((x) => {
    const title = x.Posting_Title ?? x.Job_Opening_Name ?? "";
    const loc = [x.City, x.State, x.Country].filter(Boolean).join(", ");
    const slug = title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return job(title, x.Remote_Job ? `Remote · ${loc}` : loc, `https://${host}/jobs/Careers/${x.id}/${slug}?source=CareerSite`, iso(x.Date_Opened), x.Department_Name ?? null);
  });
}

/** JazzHR list pages are server-rendered Bootstrap; not CORS-open, Node only. */
async function jazzhr(tenant: string): Promise<Job[]> {
  const html = await getText(`https://${tenant}.applytojob.com/apply/`);
  const out: Job[] = [];
  for (const m of html.matchAll(/<li class="list-group-item">([\s\S]*?)<\/li>\s*<\/ul>|<li class="list-group-item">([\s\S]*?)<\/li>/g)) {
    const item = (m[1] ?? m[2] ?? "").replace(/\s+/g, " ");
    const a = item.match(/<a href="(https:\/\/[^"]+\/apply\/[A-Za-z0-9]+\/[^"]*)"[^>]*>\s*([^<]+?)\s*<\/a>/);
    if (!a) continue;
    const loc = item.match(/fa-map-marker['"]?><\/i>\s*([^<]+?)\s*<\/li>/)?.[1] ?? "";
    const dept = item.match(/<h3 id="[^"]*">([^<&]+)/)?.[1] ?? null;
    out.push(job(a[2]!.replace(/&amp;/g, "&"), loc, a[1]!, null, dept));
  }
  return out;
}

/** Providers the *browser* can read from any origin. */
export const LIVE_PROVIDERS: ReadonlySet<Provider> = new Set(["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "darwinbox", "keka"]);

/** Providers the *nightly job* can read. Darwinbox's Cloudflare blocks
 *  non-browser clients; Zoho is readable but not CORS-open. */
export const SNAPSHOT_PROVIDERS: ReadonlySet<Provider> = new Set(["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "keka", "zoho", "jazzhr"]);

/** Providers Cloudflare blocks for non-browser clients; the page fetches these itself. */
export const BROWSER_ONLY: ReadonlySet<Provider> = new Set(["darwinbox"]);

export async function fetchJobs(board: Board): Promise<Job[]> {
  switch (board.provider) {
    case "greenhouse": return greenhouse(board.slug);
    case "lever": return lever(board.slug);
    case "ashby": return ashby(board.slug);
    case "smartrecruiters": return smartrecruiters(board.slug);
    case "workable": return workable(board.slug);
    case "darwinbox": return darwinbox(board.slug);
    case "keka": return keka(board.slug, board.meta?.guid);
    case "zoho": return zoho(board.slug);
    case "jazzhr": return jazzhr(board.slug);
    default: throw new Error(`no fetcher for ${board.provider}`);
  }
}

/** Extract the Keka embed id so the browser can skip the HTML round trip. */
export async function kekaGuid(tenant: string): Promise<string | null> {
  try {
    const html = await getText(`https://${tenant}.keka.com/careers/`);
    return html.match(GUID)?.[0] ?? null;
  } catch {
    return null;
  }
}
