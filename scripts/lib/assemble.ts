import type { BoardSnapshot, CompanyRecord, FundingEvent, SiteData } from "../../src/shared/types.ts";
import { loadFunding } from "../funding.ts";
import { loadBoards } from "../resolve.ts";
import { loadSnapshots } from "../snapshot.ts";

interface Inputs {
  events?: FundingEvent[];
  boards?: Record<string, CompanyRecord>;
  snapshots?: Record<string, BoardSnapshot>;
  windowDays: number;
  inrPerUsd: number;
}

/** Join the three files into one page payload. Drops rounds the domain step
 *  showed are not Indian, and trims job lists to what the page shows. */
export async function assemble(i: Inputs): Promise<SiteData> {
  const events = i.events ?? (await loadFunding());
  const boards = i.boards ?? (await loadBoards());
  const snapshots = i.snapshots ?? (await loadSnapshots());

  const kept = events.filter((e) => {
    const c = boards[e.key];
    if (c?.note === "excluded by override") return false;
    // A weak headline signal needs the company's own site to say India.
    if (e.indiaSignal === "weak") return c?.india === true;
    // A strong signal survives unless the site positively says otherwise AND
    // the board has no India roles.
    if (c?.india === false) {
      const snap = snapshots[e.key];
      if (snap && snap.jobs.length > 0 && !snap.jobs.some((j) => j.india)) return false;
    }
    return true;
  });

  // Two sources per round and no titles: the page shows outlet + link only,
  // and Google News URLs are ~250 bytes each.
  const trimmed = kept.map((e) => ({ ...e, sources: e.sources.slice(0, 2).map((s) => ({ outlet: s.outlet, url: s.url, title: "" })) }));

  const companies: Record<string, CompanyRecord> = {};
  const snaps: Record<string, BoardSnapshot> = {};
  for (const e of kept) {
    const c = boards[e.key];
    if (c) companies[e.key] = { key: c.key, company: c.company, domain: c.domain, board: c.board, careersUrl: c.careersUrl, india: c.india, checkedAt: c.checkedAt, via: c.via };
    const s = snapshots[e.key];
    if (s) snaps[e.key] = { key: s.key, fetchedAt: s.fetchedAt, jobs: s.jobs.slice(0, 400) };
  }
  return { generatedAt: new Date().toISOString(), windowDays: i.windowDays, inrPerUsd: i.inrPerUsd, events: trimmed, companies, snapshots: snaps };
}
