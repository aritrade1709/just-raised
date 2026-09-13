// Live refresh of every readable board from the viewer's browser. Runs after
// the first paint so the snapshot is on screen before any request leaves.

import type { Board, Job } from "./shared/types.ts";
import { fetchJobs, LIVE_PROVIDERS } from "./shared/providers.ts";

export interface LiveResult {
  jobs: Job[] | null;
  error: string | null;
  at: number;
}

export function canFetchLive(board: Board | null): boolean {
  return !!board && LIVE_PROVIDERS.has(board.provider);
}

/** Fetch all boards with bounded concurrency; `onResult` fires per board. */
export async function refreshAll(
  boards: Array<{ key: string; board: Board }>,
  onResult: (key: string, r: LiveResult) => void,
  concurrency = 6,
): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < boards.length) {
      const { key, board } = boards[next++]!;
      try {
        const jobs = await fetchJobs(board);
        onResult(key, { jobs, error: null, at: Date.now() });
      } catch (e) {
        onResult(key, { jobs: null, error: (e as Error).message, at: Date.now() });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
}
