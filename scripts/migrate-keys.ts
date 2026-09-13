// One-off: re-key data/boards.json after a change to normaliseKey, so the
// resolver's cache survives instead of re-resolving every company. When two
// old keys collapse into one, the record with a board wins, then the one
// with a domain.
import { readFile, writeFile } from "node:fs/promises";
import type { CompanyRecord } from "../src/shared/types.ts";
import { normaliseKey } from "../src/shared/headline.ts";

const boards = JSON.parse(await readFile("data/boards.json", "utf8")) as Record<string, CompanyRecord>;
const out: Record<string, CompanyRecord> = {};
const rank = (r: CompanyRecord) => (r.board ? 2 : r.domain ? 1 : 0);
let moved = 0;
for (const rec of Object.values(boards)) {
  const k = normaliseKey(rec.company);
  if (k !== rec.key) moved++;
  const prev = out[k];
  if (!prev || rank(rec) > rank(prev)) out[k] = { ...rec, key: k };
}
await writeFile("data/boards.json", JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))), null, 1) + "\n");
console.log(`migrate-keys: ${Object.keys(boards).length} → ${Object.keys(out).length} records, ${moved} re-keyed`);
