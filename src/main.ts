import "./style.css";
import type { Board, CompanyRecord, FundingEvent, Job, SiteData } from "./shared/types.ts";
import { formatAmount, formatUsdTotal } from "./shared/money.ts";
import { roleFamily, FAMILIES, type Family } from "./shared/roles.ts";
import { shortLocation } from "./shared/india.ts";
import { canFetchLive, refreshAll, type LiveResult } from "./live.ts";

const REPO = "https://github.com/aritrade1709/just-raised";
let site: SiteData;

// ---------- state ----------

type Sort = "newest" | "biggest" | "roles";
interface Filters {
  q: string;
  family: Family | "All";
  city: string;
  days: number;
  hiringOnly: boolean;
  sort: Sort;
}

const state = {
  f: readHash(),
  live: new Map<string, LiveResult>(),
  expanded: new Set<string>(),
  refreshed: 0,
  refreshing: 0,
};

function readHash(): Filters {
  const p = new URLSearchParams(location.hash.slice(1));
  const fam = p.get("family");
  return {
    q: p.get("q") ?? "",
    family: fam && (FAMILIES as readonly string[]).includes(fam) ? (fam as Family) : "All",
    city: p.get("city") ?? "All",
    days: Number(p.get("days")) || 90,
    hiringOnly: p.get("all") !== "1",
    sort: (p.get("sort") as Sort) || "newest",
  };
}

function writeHash(): void {
  const f = state.f;
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.family !== "All") p.set("family", f.family);
  if (f.city !== "All") p.set("city", f.city);
  if (f.days !== 90) p.set("days", String(f.days));
  if (!f.hiringOnly) p.set("all", "1");
  if (f.sort !== "newest") p.set("sort", f.sort);
  const h = p.toString();
  history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
}

// ---------- data access ----------

const DAY = 86_400_000;
const now = Date.now();

function company(key: string): CompanyRecord | undefined {
  return site.companies[key];
}

/** Jobs for a company: live if we have them, else the snapshot, else null. */
function jobsFor(key: string): { jobs: Job[] | null; source: "live" | "snapshot" | "none"; error: string | null } {
  const l = state.live.get(key);
  if (l?.jobs) return { jobs: l.jobs, source: "live", error: null };
  const s = site.snapshots[key];
  if (s) return { jobs: s.jobs, source: "snapshot", error: l?.error ?? null };
  return { jobs: null, source: "none", error: l?.error ?? null };
}

interface Row {
  ev: FundingEvent;
  /** Older rounds by the same company inside the window, newest first. */
  earlier: FundingEvent[];
  co: CompanyRecord | undefined;
  jobs: Job[] | null; // all jobs, or null when unknown
  shown: Job[]; // India jobs matching the filters, sorted
  abroad: number;
  pending: boolean; // board exists, nothing loaded yet
  error: string | null;
}

function jobMatches(j: Job, f: Filters): boolean {
  if (f.family !== "All" && roleFamily(j.title) !== f.family) return false;
  if (f.city !== "All" && shortLocation(j.location) !== f.city) return false;
  return true;
}

/** Events in the window, one entry per company: the newest round plus any
 *  earlier ones. site.events is already newest-first. */
function eventsInWindow(days: number): Array<{ ev: FundingEvent; earlier: FundingEvent[] }> {
  const byKey = new Map<string, { ev: FundingEvent; earlier: FundingEvent[] }>();
  for (const ev of site.events) {
    if (now - Date.parse(ev.date) > days * DAY) continue;
    const got = byKey.get(ev.key);
    if (got) got.earlier.push(ev);
    else byKey.set(ev.key, { ev, earlier: [] });
  }
  return [...byKey.values()];
}

function rows(): Row[] {
  const f = state.f;
  const q = f.q.trim().toLowerCase();
  const out: Row[] = [];
  for (const { ev, earlier } of eventsInWindow(f.days)) {
    const co = company(ev.key);
    const { jobs, source, error } = jobsFor(ev.key);
    const pending = !jobs && canFetchLive(co?.board ?? null) && !error;
    const india = (jobs ?? []).filter((j) => j.india);
    const shown = india.filter((j) => jobMatches(j, f)).sort((a, b) => (b.posted ?? "").localeCompare(a.posted ?? ""));
    const abroad = (jobs ?? []).length - india.length;
    if (q) {
      const hay = [ev.company, ev.descriptor ?? "", ev.round ?? "", ...ev.investors, ...earlier.flatMap((e) => [e.round ?? "", ...e.investors]), ...(jobs ?? []).map((j) => j.title)].join(" ").toLowerCase();
      if (!hay.includes(q)) continue;
    }
    if (f.hiringOnly && !pending && shown.length === 0) continue;
    if (!f.hiringOnly && (f.family !== "All" || f.city !== "All") && jobs && shown.length === 0) continue;
    void source;
    out.push({ ev, earlier, co, jobs, shown, abroad, pending, error });
  }
  const total = (r: Row) => (r.ev.usd ?? 0) + r.earlier.reduce((n, e) => n + (e.usd ?? 0), 0);
  const bySort: Record<Sort, (a: Row, b: Row) => number> = {
    newest: (a, b) => b.ev.date.localeCompare(a.ev.date) || total(b) - total(a),
    biggest: (a, b) => total(b) - total(a) || b.ev.date.localeCompare(a.ev.date),
    roles: (a, b) => b.shown.length - a.shown.length || b.ev.date.localeCompare(a.ev.date),
  };
  return out.sort(bySort[f.sort]);
}

// ---------- rendering ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function ago(date: string): string {
  const d = Math.floor((now - Date.parse(date)) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : name.slice(0, 2)).toUpperCase();
}

function logoHtml(ev: FundingEvent, co: CompanyRecord | undefined): string {
  if (co?.domain) {
    return `<img class="logo" alt="" loading="lazy" data-domain="${esc(co.domain)}" data-initials="${esc(initials(ev.company))}" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(co.domain)}&sz=128" />`;
  }
  return `<div class="logo initials">${esc(initials(ev.company))}</div>`;
}

function searchUrl(name: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`"${name}" careers`)}`;
}

function boardLabel(b: Board): string {
  const names: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", smartrecruiters: "SmartRecruiters", workable: "Workable", darwinbox: "Darwinbox", keka: "Keka", zoho: "Zoho Recruit", jazzhr: "JazzHR", freshteam: "Freshteam", other: "careers page" };
  return names[b.provider] ?? b.provider;
}

function jobHtml(j: Job): string {
  return `<li class="job${j.india ? "" : " abroad"}"><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a><span class="fam">${esc(roleFamily(j.title))}</span><span class="loc">${esc(shortLocation(j.location))}</span></li>`;
}

function cardHtml(r: Row): string {
  const { ev, co } = r;
  const key = ev.key;
  const open = state.expanded.has(key);
  const amt = formatAmount(ev.amount, ev.currency);
  const site = co?.domain ? `https://${co.domain}/` : null;
  const src = ev.sources[0];
  const investors = ev.investors.length ? `<div class="investors">${ev.investors.map(esc).join(", ")}</div>` : "";
  const earlier = r.earlier.length
    ? `<div class="earlier">${r.earlier.map((e) => `Earlier: <b>${esc(formatAmount(e.amount, e.currency))}</b>${e.round ? ` ${esc(e.round)}` : ""} · ${ago(e.date)}${e.sources[0] ? ` · <a href="${esc(e.sources[0].url)}" target="_blank" rel="noopener">${esc(e.sources[0].outlet)} ↗</a>` : ""}`).join("<br>")}</div>`
    : "";

  let jobsBlock: string;
  if (r.jobs) {
    const cities = [...new Set(r.shown.map((j) => shortLocation(j.location)))].slice(0, 3).join(" · ");
    const n = r.shown.length;
    const limit = open ? r.shown.length : 3;
    const list = r.shown.slice(0, limit).map(jobHtml).join("");
    const abroadList = open && r.abroad > 0 ? (r.jobs.filter((j) => !j.india).slice(0, 40).map(jobHtml).join("")) : "";
    const state_ = jobsFor(key).source === "live" ? `<span class="state"><span class="live-dot"></span>live</span>` : r.error ? `<span class="state err" title="${esc(r.error)}">snapshot</span>` : `<span class="state">snapshot</span>`;
    const more = n > 3 || r.abroad > 0
      ? `<button class="more" data-key="${esc(key)}">${open ? "Show less" : `Show all ${n}${r.abroad ? ` · ${r.abroad} abroad` : ""}`}</button>`
      : "";
    jobsBlock = `<div class="jobs">
      <div class="jobs-head"><span class="n ${n ? "some" : "none"}">${n ? `${n} open role${n === 1 ? "" : "s"} in India` : r.abroad ? `No India roles · ${r.abroad} abroad` : "No open roles right now"}</span><span class="cities">${esc(cities)}</span>${state_}</div>
      ${n || abroadList ? `<ul class="joblist">${list}${abroadList}</ul>` : ""}
      ${more}
      ${co?.board ? `<div class="src" style="margin-top:8px">via ${boardLabel(co.board)} · <a href="${esc(co.board.url)}" target="_blank" rel="noopener">board ↗</a></div>` : ""}
    </div>`;
  } else if (r.pending) {
    jobsBlock = `<div class="jobs"><div class="jobs-head"><span class="n none">Loading roles…</span><span class="state">${co?.board ? esc(boardLabel(co.board)) : ""}</span></div></div>`;
  } else if (co?.board || co?.careersUrl) {
    const url = co.careersUrl ?? co.board!.url;
    jobsBlock = `<div class="jobs"><div class="jobs-head"><span class="n none">${co.board ? `Roles on ${esc(boardLabel(co.board))}` : "Careers page"}</span>${r.error ? `<span class="state err" title="${esc(r.error)}">couldn't load</span>` : ""}</div><a class="careers-link" href="${esc(url)}" target="_blank" rel="noopener">Open careers page ↗</a></div>`;
  } else {
    jobsBlock = `<div class="jobs"><div class="jobs-head"><span class="n none">No public job board found</span></div><a class="careers-link" href="${searchUrl(ev.company)}" target="_blank" rel="noopener">Search for openings ↗</a></div>`;
  }

  return `<article class="card${open ? " open" : ""}" data-key="${esc(key)}">
    <div class="card-head">
      ${logoHtml(ev, co)}
      <div class="who">
        <div class="name">${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">${esc(ev.company)}</a>` : esc(ev.company)}</div>
        <div class="desc" title="${esc(ev.descriptor ?? "")}">${esc(ev.descriptor ?? (co?.domain ?? ""))}</div>
      </div>
    </div>
    <div class="round">
      <span class="amt${ev.amount === null ? " undisclosed" : ""}">${esc(amt)}</span>
      <span class="meta">${ev.round ? `<b>${esc(ev.round)}</b> · ` : ""}${ago(ev.date)}</span>
    </div>
    ${investors}
    <div class="src">${src ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.outlet)} ↗</a>` : ""}${ev.sources.length > 1 ? ` · +${ev.sources.length - 1} more` : ""}</div>
    ${earlier}
    ${jobsBlock}
  </article>`;
}

function cityOptions(): string[] {
  const counts = new Map<string, number>();
  for (const { ev } of eventsInWindow(state.f.days)) {
    const { jobs } = jobsFor(ev.key);
    for (const j of jobs ?? []) if (j.india) counts.set(shortLocation(j.location), (counts.get(shortLocation(j.location)) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).filter((c) => c !== "—").slice(0, 14);
}

function familyCounts(list: Row[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of list) for (const j of (r.jobs ?? []).filter((j) => j.india)) m.set(roleFamily(j.title), (m.get(roleFamily(j.title)) ?? 0) + 1);
  return m;
}

let app: HTMLElement;

function render(): void {
  const f = state.f;
  const list = rows();
  const allInWindow = eventsInWindow(f.days);
  const raised = allInWindow.reduce((n, { ev, earlier }) => n + (ev.usd ?? 0) + earlier.reduce((m, e) => m + (e.usd ?? 0), 0), 0);
  const roles = list.reduce((n, r) => n + r.shown.length, 0);
  const fams = familyCounts(list);
  const cities = cityOptions();

  app.innerHTML = `
  <div class="wrap">
    <header class="hero">
      <h1>Just <span>raised</span>. Now hiring.</h1>
      <p>Indian startups that announced funding in the last ${f.days} days, and every role on their own job boards — fetched live, from your browser.</p>
      <div class="stats">
        <div class="stat"><b>${allInWindow.length}</b><span>startups raised</span></div>
        <div class="stat money"><b>${formatUsdTotal(raised)}</b><span>disclosed, in ${f.days} days</span></div>
        <div class="stat live"><b>${roles.toLocaleString("en-IN")}</b><span>open roles in India${f.family !== "All" || f.city !== "All" ? " (filtered)" : ""}</span></div>
        <div class="stat"><b>${state.refreshed}<span style="font-size:14px;color:var(--muted)">/${liveBoards().length}</span></b><span>${state.refreshing ? "boards refreshing…" : "boards live"}</span></div>
      </div>
    </header>

    <div class="filters">
      <div class="row">
        <input class="search" type="search" placeholder="Search companies, investors, job titles" value="${esc(f.q)}" />
        <select class="sel" data-f="days">
          ${[30, 60, 90, 120].map((d) => `<option value="${d}"${f.days === d ? " selected" : ""}>Last ${d} days</option>`).join("")}
        </select>
        <select class="sel" data-f="city">
          <option value="All">All cities</option>
          ${cities.map((c) => `<option value="${esc(c)}"${f.city === c ? " selected" : ""}>${esc(c)}</option>`).join("")}
        </select>
        <select class="sel" data-f="sort">
          <option value="newest"${f.sort === "newest" ? " selected" : ""}>Newest funding</option>
          <option value="biggest"${f.sort === "biggest" ? " selected" : ""}>Biggest round</option>
          <option value="roles"${f.sort === "roles" ? " selected" : ""}>Most roles</option>
        </select>
        <label class="toggle"><input type="checkbox" data-f="hiringOnly"${f.hiringOnly ? " checked" : ""}/> hiring only</label>
      </div>
      <div class="row">
        <div class="chips">
          <button class="chip${f.family === "All" ? " on" : ""}" data-family="All">All roles</button>
          ${FAMILIES.filter((x) => x !== "Other").map((x) => `<button class="chip${f.family === x ? " on" : ""}" data-family="${x}">${x}<small>${fams.get(x) ?? 0}</small></button>`).join("")}
        </div>
      </div>
    </div>

    <div class="count">${list.length} ${f.hiringOnly ? "hiring" : "startups"}${f.q ? ` matching “${esc(f.q)}”` : ""}${f.family !== "All" ? ` · ${esc(f.family)}` : ""}${f.city !== "All" ? ` · ${esc(f.city)}` : ""}</div>

    ${list.length ? `<div class="grid">${list.map(cardHtml).join("")}</div>` : `<div class="empty">Nothing matches. Try a wider window or turn off “hiring only”.</div>`}

    <footer>
      <p>Funding events are extracted from public news headlines and linked on every card; the amount shown is what the headline said. Jobs come from each company's own job board (Greenhouse, Lever, Ashby, Darwinbox, Keka, SmartRecruiters, Workable), fetched live by your browser when you open this page.</p>
      <p>Not every startup has a public board — those show a careers link instead. Rounds may be missing or mis-attributed; the source link is the truth. Data refreshed nightly. <a href="${REPO}" target="_blank" rel="noopener">Source on GitHub</a>.</p>
    </footer>
  </div>`;

  wireLogos();
}

function wireLogos(): void {
  for (const img of app.querySelectorAll<HTMLImageElement>("img.logo")) {
    img.addEventListener("error", () => {
      const d = img.dataset.domain!;
      if (!img.dataset.fallback) {
        img.dataset.fallback = "1";
        img.src = `https://icons.duckduckgo.com/ip3/${d}.ico`;
      } else {
        const div = document.createElement("div");
        div.className = "logo initials";
        div.textContent = img.dataset.initials ?? "";
        img.replaceWith(div);
      }
    });
  }
}

// ---------- events ----------

function wire(): void {
  app.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.classList.contains("search")) {
      state.f.q = t.value;
      writeHash();
      // Re-render the list only, keep the input focused.
      const sel = t.selectionStart;
      render();
      const again = app.querySelector<HTMLInputElement>(".search");
      again?.focus();
      if (again && sel !== null) again.setSelectionRange(sel, sel);
    }
  });
  app.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const f = t.dataset.f;
    if (!f) return;
    if (f === "days") state.f.days = Number(t.value);
    else if (f === "city") state.f.city = t.value;
    else if (f === "sort") state.f.sort = t.value as Sort;
    else if (f === "hiringOnly") state.f.hiringOnly = (t as HTMLInputElement).checked;
    writeHash();
    render();
  });
  app.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-family], .more");
    if (!t) return;
    if (t.dataset.family) {
      state.f.family = t.dataset.family as Family | "All";
      writeHash();
      render();
    } else if (t.classList.contains("more")) {
      const k = t.dataset.key!;
      if (state.expanded.has(k)) state.expanded.delete(k);
      else state.expanded.add(k);
      render();
      app.querySelector(`.card[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ block: "nearest" });
    }
  });
  window.addEventListener("hashchange", () => {
    state.f = readHash();
    render();
  });
}

// ---------- live refresh ----------

function liveBoards(): Array<{ key: string; board: Board }> {
  const out: Array<{ key: string; board: Board }> = [];
  const seen = new Set<string>();
  for (const ev of site.events) {
    const co = company(ev.key);
    if (!co?.board || !canFetchLive(co.board) || seen.has(ev.key)) continue;
    seen.add(ev.key);
    out.push({ key: ev.key, board: co.board });
  }
  return out;
}

let renderTimer: number | undefined;
function scheduleRender(): void {
  if (renderTimer) return;
  renderTimer = window.setTimeout(() => {
    renderTimer = undefined;
    render();
  }, 250);
}

async function goLive(): Promise<void> {
  const boards = liveBoards();
  state.refreshing = boards.length;
  await refreshAll(boards, (key, r) => {
    state.live.set(key, r);
    state.refreshing--;
    if (r.jobs) state.refreshed++;
    scheduleRender();
  });
  scheduleRender();
}

// ---------- boot ----------

async function boot(): Promise<void> {
  app = document.getElementById("app")!;
  app.innerHTML = `<div class="wrap"><header class="hero"><h1>Just <span>raised</span>. Now hiring.</h1><p>Loading…</p></header></div>`;
  try {
    const r = await fetch("./data/site.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    site = (await r.json()) as SiteData;
  } catch (e) {
    app.innerHTML = `<div class="wrap"><header class="hero"><h1>Just <span>raised</span>. Now hiring.</h1><p>Could not load the data file (${esc((e as Error).message)}). Run <code>pnpm data</code> if this is a fresh checkout.</p></header></div>`;
    return;
  }
  wire();
  render();
  goLive();
}

boot();
