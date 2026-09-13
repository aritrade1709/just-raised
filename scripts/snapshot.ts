// Step 3: a jobs snapshot for every readable board. The page renders from
// this first, then refreshes each board live; it is also the only view of
// boards the browser cannot read (none today — Darwinbox is the reverse case:
// browser yes, Node no, so it is absent here and filled in live).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { BoardSnapshot, CompanyRecord } from "../src/shared/types.ts";
import { fetchJobs, SNAPSHOT_PROVIDERS } from "../src/shared/providers.ts";
import { pool } from "./lib/http.ts";
import { loadBoards } from "./resolve.ts";

const OUT = "data/snapshots.json";

export async function loadSnapshots(): Promise<Record<string, BoardSnapshot>> {
  try {
    return JSON.parse(await readFile(OUT, "utf8")) as Record<string, BoardSnapshot>;
  } catch {
    return {};
  }
}

export async function runSnapshot(boards?: Record<string, CompanyRecord>): Promise<Record<string, BoardSnapshot>> {
  const companies = boards ?? (await loadBoards());
  const previous = await loadSnapshots();
  const readable = Object.values(companies).filter((c) => c.board && SNAPSHOT_PROVIDERS.has(c.board.provider));
  console.log(`snapshot: ${readable.length} readable boards`);
  const out: Record<string, BoardSnapshot> = {};
  const now = new Date().toISOString();
  let ok = 0;
  await pool(readable, 8, async (c) => {
    try {
      const jobs = await fetchJobs(c.board!);
      out[c.key] = { key: c.key, fetchedAt: now, jobs };
      ok++;
    } catch (e) {
      // Keep yesterday's jobs rather than showing zero because a provider blinked.
      const prev = previous[c.key];
      out[c.key] = prev ? { ...prev, error: (e as Error).message } : { key: c.key, fetchedAt: now, jobs: [], error: (e as Error).message };
    }
  });
  await mkdir("data", { recursive: true });
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(OUT, JSON.stringify(sorted) + "\n");
  const total = Object.values(out).reduce((n, s) => n + s.jobs.length, 0);
  const india = Object.values(out).reduce((n, s) => n + s.jobs.filter((j) => j.india).length, 0);
  console.log(`snapshot: ${ok}/${readable.length} fetched, ${total} jobs, ${india} in India → ${OUT}`);
  return out;
}

if (process.argv[1] && /snapshot\.ts$/.test(process.argv[1])) {
  await runSnapshot();
}
