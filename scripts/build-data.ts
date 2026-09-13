// Runs the whole pipeline and writes what the page loads: data/site.json.
//
//   funding  → data/funding.json    (headlines → rounds)
//   resolve  → data/boards.json     (company → domain → board)
//   snapshot → data/snapshots.json  (board → jobs, where Node can read them)
//   site     → public/data/site.json (the three joined, trimmed for the page)

import { writeFile, mkdir } from "node:fs/promises";
import type { SiteData } from "../src/shared/types.ts";
import { INR_PER_USD } from "../src/shared/money.ts";
import { runFunding, WINDOW_DAYS } from "./funding.ts";
import { runResolve } from "./resolve.ts";
import { runSnapshot } from "./snapshot.ts";
import { assemble } from "./lib/assemble.ts";

const only = process.argv[2]; // "site" to just re-assemble

const events = only === "site" ? undefined : await runFunding();
const boards = only === "site" ? undefined : await runResolve(events);
const snapshots = only === "site" ? undefined : await runSnapshot(boards);

const site: SiteData = await assemble({ events, boards, snapshots, windowDays: WINDOW_DAYS, inrPerUsd: INR_PER_USD });
// Served as a static asset (public/ is copied into dist/), fetched by the page.
await mkdir("public/data", { recursive: true });
await writeFile("public/data/site.json", JSON.stringify(site) + "\n");
const shown = site.events.length;
const withBoard = site.events.filter((e) => site.companies[e.key]?.board).length;
console.log(`site: ${shown} rounds, ${withBoard} with a job board, ${Object.keys(site.snapshots).length} snapshots → public/data/site.json (${(JSON.stringify(site).length / 1024).toFixed(0)} KB)`);
