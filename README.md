# Just Raised

**Indian startups that just raised money, and every role they're hiring for.**

A single page: every Indian startup that announced a funding round in the last
120 days, with the amount, the round, the investors, a link to the source, and
the open roles on the company's own job board — fetched live, from your
browser, when you open the page.

No login, no signup, nothing to install. Filter by role family (Engineering,
Data & AI, Product, Design, Sales…), by city, by how recent the round is; sort
by newest, biggest, or most roles.

## How it works

The site is static. A nightly job builds one JSON file; the page renders it,
then refreshes each job board live.

**1. Funding rounds come from headlines.** There is no free, keyless source of
Indian funding events, but funding headlines are formulaic — *"Cardless payments
platform Piston raises $15 Mn in Series A led by FPV Ventures"* — and Google
News RSS accepts `after:`/`before:` operators, so the last four months are ~180
requests. Entrackr, Inc42 and YourStory feeds add the freshest items with real
article URLs. A parser (`src/shared/headline.ts`, ~60 test cases) turns each
headline into company, descriptor, amount, currency, round, investors; sightings
of the same company within three weeks merge into one round. Rounds that only
mention "India" in passing must also show India on the company's own site to be
kept.

**2. Companies are joined to job boards with no shared key.** Nothing in a
headline says where a company's jobs live. The resolver finds the company's
website (Clearbit autocomplete plus plain domain guessing, every candidate
validated against the homepage title), walks its careers pages, and looks for
the applicant-tracking system the company itself links to: Greenhouse, Lever,
Ashby, SmartRecruiters, Workable, Darwinbox, Keka, Zoho Recruit, and a dozen
others. A board the company publishes is trusted; a slug that merely happens to
exist on Greenhouse is not — slug guessing is only a last resort, and only with
an India location on the board. Hand fixes go in `data/overrides.json`.

**3. Jobs are fetched by your browser.** Every supported board has a public,
CORS-open JSON endpoint. Darwinbox — used by a large share of Indian
startups — is CORS-open but blocks non-browser clients, so the nightly job
cannot read it and the page does. That is why every count on the page is live.
A nightly snapshot of the other boards is what you see before the live
refresh lands.

Locations are classified with a word list (`src/shared/india.ts`): a role
counts as India if it names an Indian city or state, or is remote with no
other country named. Role families are keyword rules over the title
(`src/shared/roles.ts`).

## Run it locally

```bash
pnpm i && pnpm dev
```

No environment variables, no keys. `pnpm data` rebuilds `data/site.json` from
the public feeds — about 30 minutes on a cold cache, a few minutes nightly.
`pnpm test` runs the parser and classifier tests; `pnpm check` adds the
typecheck.

## Built with

TypeScript, Vite, and nothing else at runtime. The pipeline is TypeScript run
directly by Node 24. Hosted on GitHub Pages; refreshed by a scheduled GitHub
Action that commits the data.

## Data sources

| What | Source | Notes |
|---|---|---|
| Funding rounds | [Google News RSS](https://news.google.com/rss), [Entrackr](https://entrackr.com/rss), [Inc42](https://inc42.com/feed/), [YourStory](https://yourstory.com/feed) | Headlines only; every card links to its source article |
| Company websites | [Clearbit autocomplete](https://clearbit.com/docs#autocomplete-api), domain guessing | Validated against the homepage |
| Jobs | Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Darwinbox, Keka public job-board APIs | Read from the browser |
| Logos | Google favicon service, DuckDuckGo icons | Initials fallback |

Amounts are shown in the currency the headline reported. USD totals convert
INR at a fixed approximate rate (`src/shared/money.ts`) and are for sorting
and the headline number only.

## Limits

- A round is only as right as its headline. Merged sightings can disagree on
  the amount; the most-reported figure wins and the sources are all linked.
- Startups without a public job board show a careers link instead of roles.
- Name-only lookup cannot always tell two companies apart. Wrong sites or
  boards can be corrected in `data/overrides.json`.

## Licence

MIT.
