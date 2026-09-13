// Shared between the nightly pipeline (Node) and the page (browser).

export type Currency = "USD" | "INR" | "EUR" | "GBP" | "SGD" | "AED" | "JPY";

/** One funding event, extracted from a headline. */
export interface FundingEvent {
  /** Stable id: normalised company + ISO date of first sighting. */
  id: string;
  company: string;
  /** Normalised key for joins: lowercase, alphanumerics only. */
  key: string;
  /** What the headline called it — "Cardless payments platform". */
  descriptor: string | null;
  amount: number | null;
  currency: Currency | null;
  /** Amount converted to USD for sorting and totals. null when undisclosed. */
  usd: number | null;
  round: string | null;
  investors: string[];
  /** ISO date (UTC) of the earliest headline seen. */
  date: string;
  sources: Array<{ outlet: string; url: string; title: string }>;
  /** "strong" = Indian startup press, INR amount or an Indian city in the
   *  headline. "weak" = only the word India — settled later by the domain. */
  indiaSignal: "strong" | "weak";
}

export type Provider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workable"
  | "darwinbox"
  | "keka"
  | "zoho"
  | "jazzhr"
  | "freshteam"
  | "other";

/** Where a company's jobs live. `url` is the human careers page. */
export interface Board {
  provider: Provider;
  /** Provider-specific handle: board token, tenant subdomain, or full URL. */
  slug: string;
  url: string;
  /** Extra provider state — Keka needs its embed GUID. */
  meta?: Record<string, string>;
}

export interface CompanyRecord {
  key: string;
  company: string;
  domain: string | null;
  board: Board | null;
  /** Careers URL when a board exists but has no readable API. */
  careersUrl: string | null;
  /** India named on the company's own site or board. null = could not check. */
  india: boolean | null;
  /** ISO timestamp of the last resolution attempt. */
  checkedAt: string;
  /** How the board was found: "site" (the company links to it), "probe"
   *  (slug guess validated by an India location), "override" (hand-set). */
  via?: "site" | "probe" | "override";
  /** Why resolution failed, for the next session's benefit. */
  note?: string;
}

export interface Job {
  title: string;
  location: string;
  /** True when the location classifies as India (or remote-eligible). */
  india: boolean;
  url: string;
  /** ISO date when the provider exposes one. */
  posted: string | null;
  department: string | null;
}

export interface BoardSnapshot {
  key: string;
  fetchedAt: string;
  jobs: Job[];
  error?: string;
}

/** What the page loads. */
export interface SiteData {
  generatedAt: string;
  windowDays: number;
  inrPerUsd: number;
  events: FundingEvent[];
  companies: Record<string, CompanyRecord>;
  snapshots: Record<string, BoardSnapshot>;
}
