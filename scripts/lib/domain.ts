// Company name → its website. Two sources, both keyless: Clearbit's
// autocomplete (name-ambiguous — "Jar" returns Jared Jewelers) and plain
// domain guessing. Every candidate is validated by fetching the homepage and
// finding the company's name in it, and the homepage is also where the
// India check happens.

import { get, decodeEntities } from "./http.ts";

const DAY = 24 * 60 * 60_000;

export interface Site {
  domain: string;
  /** Final URL after redirects. */
  url: string;
  html: string;
  title: string;
  /** India named on the homepage: city, ₹, +91, "Pvt. Ltd". null when the
   *  homepage could not be read (bot-blocked) but the domain is known. */
  india: boolean | null;
  /** The homepage refused non-browser clients; discovery cannot run. */
  blocked?: boolean;
}

const INDIA_ON_PAGE =
  /\b(india|bengaluru|bangalore|mumbai|gurugram|gurgaon|noida|hyderabad|pune|chennai|kolkata|ahmedabad|jaipur|kochi|indore|new delhi)\b|₹|\+91[\s-]?\d|pvt\.?\s?ltd|private limited|\.in\b/i;

/** Alphanumeric key used everywhere for joins. */
export const keyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Regex for the company name as whole words, tolerant of punctuation:
 *  "Navana.ai" matches "Navana AI", "Third Wave Coffee" matches
 *  "third-wave-coffee". */
function nameRegex(company: string): RegExp | null {
  const tokens = company.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length || tokens.join("").length < 3) return null;
  return new RegExp(`(?:^|[^a-z0-9])${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^a-z0-9]{0,3}")}(?![a-z0-9])`, "i");
}

/** The name must be *whose site this is*: in the title, an og: tag, or the
 *  domain. A page that merely mentions the company does not count. */
function nameOwnsSite(company: string, domain: string, html: string): boolean {
  const re = nameRegex(company);
  if (!re) return false;
  const head = html.slice(0, 60_000);
  const fields = [
    head.match(/<title[^>]*>([^<]*)/i)?.[1],
    ...[...head.matchAll(/(?:property|name)="(?:og:site_name|og:title|twitter:title|application-name|apple-mobile-web-app-title)"[^>]*content="([^"]*)"/gi)].map((m) => m[1]),
    ...[...head.matchAll(/content="([^"]*)"[^>]*(?:property|name)="(?:og:site_name|og:title|twitter:title)"/gi)].map((m) => m[1]),
    head.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " "),
    head.match(/<img[^>]+alt="([^"]{0,80})"[^>]*logo|logo[^>]*alt="([^"]{0,80})"/i)?.[1],
  ]
    .filter((x): x is string => !!x)
    .map(decodeEntities);
  // The title's first segment only: "Meesho, Nykaa, Amazon | Digibells" is a
  // listicle, not Meesho.
  const sld = domain.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
  const k = keyOf(company);
  const sldRelated = k.length >= 4 && (sld === k || sld.startsWith(k) || (k.length >= 6 && k.startsWith(sld) && sld.length >= 5) || sld.includes(k) && k.length >= 5);
  if (sldRelated) return true;
  const [title, ...rest] = fields;
  const segments = (title ?? "").split(/[|\-–—:·,•]/);
  // "Meesho, Nykaa, Amazon, Flipkart | Digibells" is a listicle on someone
  // else's site: many segments and an unrelated domain.
  if (segments.length >= 4) return false;
  if (re.test(segments[0] ?? "")) return true;
  return rest.some((f) => re.test(f.split(/[|\-–—:·,•]/)[0] ?? ""));
}

async function validate(domain: string, company: string, trusted = false): Promise<Site | null> {
  const r = await get(`https://${domain}/`, { ttlMs: 7 * DAY, timeoutMs: trusted ? 12_000 : 8_000, retries: 0 });
  // Akamai/Cloudflare bot walls on big consumer sites. A Clearbit exact match
  // is still the right domain; we just cannot read it.
  const walled = r.status === 403 || r.status === 429 || r.status === 503 || r.status === 401 || r.status === 202 || (r.status === 200 && (r.text.length < 600 || /access denied|just a moment|attention required|enable javascript and cookies/i.test(r.text.slice(0, 5000))));
  if (trusted && walled) {
    return { domain, url: `https://${domain}/`, html: "", title: "", india: null, blocked: true };
  }
  if (r.status !== 200 || !r.text) return null;
  // Parked / for-sale pages, registrar placeholders, empty shells.
  const head = r.text.slice(0, 20_000);
  if (/domain (?:is |name )?(?:for sale|is available)|the domain name|buy this domain|parked|godaddy|hugedomains|sedo\.com|afternic|dan\.com|<title[^>]*>\s*coming soon|under construction/i.test(head)) return null;
  let finalDomain = domain;
  try {
    finalDomain = new URL(r.url).hostname.replace(/^www\./, "");
  } catch {
    /* keep */
  }
  if (!nameOwnsSite(company, finalDomain, r.text)) return null;
  const title = decodeEntities(r.text.match(/<title[^>]*>([^<]*)/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  return { domain: finalDomain, url: r.url, html: r.text, title, india: INDIA_ON_PAGE.test(r.text) };
}

interface ClearbitHit { name: string; domain: string }

/** Clearbit candidates, exact name matches first, then close ones. */
async function clearbit(company: string): Promise<{ exact: string[]; fuzzy: string[] }> {
  const r = await get(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(company)}`, { ttlMs: 7 * DAY, retries: 2, timeoutMs: 20_000 });
  const none = { exact: [], fuzzy: [] };
  if (r.status !== 200) return none;
  let hits: ClearbitHit[] = [];
  try {
    hits = JSON.parse(r.text) as ClearbitHit[];
  } catch {
    return none;
  }
  const k = keyOf(company);
  const exact: ClearbitHit[] = [];
  const fuzzy: ClearbitHit[] = [];
  for (const h of hits) {
    const hk = keyOf(h.name);
    const dk = h.domain.split(".")[0]!.replace(/[^a-z0-9]/g, "");
    if (hk === k || dk === k) exact.push(h);
    else if (hk.startsWith(k) || k.startsWith(hk) || dk.startsWith(k)) fuzzy.push(h);
  }
  const byTld = (a: ClearbitHit, b: ClearbitHit) => tldScore(b.domain) - tldScore(a.domain);
  return {
    exact: exact.sort(byTld).map((h) => h.domain.replace(/^www\./, "")),
    fuzzy: fuzzy.sort(byTld).map((h) => h.domain.replace(/^www\./, "")),
  };
}

function tldScore(domain: string): number {
  if (domain.endsWith(".in") || domain.endsWith(".co.in")) return 5;
  if (domain.endsWith(".com")) return 4;
  if (domain.endsWith(".ai")) return 3;
  if (domain.endsWith(".co") || domain.endsWith(".io")) return 2;
  return 1;
}

function guesses(company: string): string[] {
  const words = company.toLowerCase().replace(/[^a-z0-9\s.-]/g, "").trim().split(/\s+/);
  const joined = words.join("").replace(/[.-]/g, "");
  const hyphen = words.join("-").replace(/\./g, "");
  const out: string[] = [];
  // "Navana.ai", "Fundly.ai" — the name is the domain.
  const dotted = company.toLowerCase().match(/^([a-z0-9-]+\.(?:ai|com|io|in|co|app|xyz|tech|health|space))$/);
  if (dotted) out.push(dotted[1]!);
  const bases = [...new Set([joined, hyphen])].filter((b) => b.length >= 3);
  // Most likely shapes for an Indian startup first; the long tail after.
  for (const b of bases) out.push(`${b}.com`, `${b}.in`, `${b}.ai`, `${b}.co`, `${b}.io`, `${b}.app`, `my${b}.app`, `my${b}.com`, `my${b}.in`, `get${b}.com`, `${b}now.com`, `${b}hq.com`, `${b}.co.in`, `${b}.tech`, `${b}.health`, `${b}.money`, `${b}.club`, `${b}.delivery`, `${b}.life`, `${b}.store`);
  for (const b of bases) {
    for (const tld of ["space", "org", "net", "xyz", "dev", "energy", "bio", "care", "fit", "one", "finance", "shop", "studio", "world", "fund", "cash", "live"]) out.push(`${b}.${tld}`);
    for (const pre of ["the", "try", "join", "hello", "go"]) out.push(`${pre}${b}.com`, `${pre}${b}.in`, `${pre}${b}.app`);
    for (const suf of ["app", "india", "labs", "tech", "ai", "health", "money"]) out.push(`${b}${suf}.com`, `${b}${suf}.in`);
  }
  return [...new Set(out)];
}

const GENERIC_DESCRIPTOR = new Set("startup start-up platform company firm maker brand app player major unicorn operator provider marketplace network based backed indian india tech deeptech saas d2c b2b ai new the a an and of for".split(" "));

/** Words from the headline's descriptor that could identify the right site:
 *  "Cardless payments platform" → ["cardless", "payments"]. */
function descriptorTokens(descriptor: string | null | undefined): string[] {
  return (descriptor ?? "")
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length >= 4 && !GENERIC_DESCRIPTOR.has(t));
}

/** Resolve a company to a validated site, or null. `hint` is a known domain
 *  from an override or an earlier run. Among validated candidates, one that
 *  names India wins, then one that mentions what the headline said the
 *  company does, then the first one found. */
export async function resolveSite(company: string, hint?: string | null, descriptor?: string | null): Promise<{ site: Site | null; tried: number }> {
  const cb = await clearbit(company);
  const trusted = new Set(cb.exact);
  const candidates: string[] = [];
  if (hint) candidates.push(hint);
  candidates.push(...cb.exact, ...guesses(company), ...cb.fuzzy);
  const tokens = descriptorTokens(descriptor);
  const seen = new Set<string>();
  let tried = 0;
  let best: { site: Site; score: number } | null = null;
  for (const d of candidates) {
    if (seen.has(d)) continue;
    seen.add(d);
    tried++;
    const isTrusted = trusted.has(d) || d === hint;
    const site = await validate(d, company, isTrusted);
    if (site) {
      const lower = site.html.toLowerCase();
      const mentions = tokens.length ? tokens.filter((t) => lower.includes(t)).length : 0;
      // Trust (Clearbit says this *is* the company) outranks an India mention
      // on some other validated page; India outranks the descriptor.
      const score = (isTrusted ? 3 : 0) + (site.india ? 4 : 0) + (mentions ? 1 + Math.min(mentions, 2) : 0) + (d.endsWith(".in") ? 1 : 0);
      if (!best || score > best.score) best = { site, score };
      if (score >= 7) break;
      // Keep looking a little for a better one, not forever.
      if (tried >= 20) break;
    }
    if (tried >= 36) break;
  }
  return { site: best?.site ?? null, tried };
}
