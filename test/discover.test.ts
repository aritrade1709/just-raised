import { test } from "node:test";
import assert from "node:assert/strict";
import { boardsInHtml } from "../scripts/lib/discover.ts";
import { parseRss, googleNewsUrl } from "../scripts/lib/feeds.ts";

test("finds the ATS a careers page embeds or links to", () => {
  const html = `
    <a href="https://job-boards.greenhouse.io/razorpaysoftwareprivatelimited">Open roles</a>
    <script src="https://boards.greenhouse.io/embed/job_board/js?for=razorpaysoftwareprivatelimited"></script>
    <iframe src="https://jobs.lever.co/meesho?lever-via=abc"></iframe>
    <a href="https://porter.darwinbox.in/ms/candidate/careers">Careers</a>
    <a href="https://hr.keka.com/careers/">Keka</a>
    <a href="https://skyroot.zohorecruit.in/jobs/Careers">Zoho</a>
    <a href="https://careers.smartrecruiters.com/Swiggy">SR</a>
    <a href="https://apply.workable.com/apna/">Workable</a>
    <a href="https://jobs.ashbyhq.com/sarvam">Ashby</a>
    <a href="https://www.linkedin.com/company/porter-india/jobs/">LinkedIn</a>
    <a href="https://changejar.applytojob.com/apply/">JazzHR</a>
    <a href="https://job-boards.eu.greenhouse.io/groww">EU</a>
    <script>site:"https://ultraviolette.zohorecruit.in/recruit/portal.na"</script>
  `;
  const found = boardsInHtml(html).map((b) => `${b.provider}:${b.slug}`);
  assert.deepEqual(found, [
    "greenhouse:razorpaysoftwareprivatelimited",
    "greenhouse:groww",
    "lever:meesho",
    "ashby:sarvam",
    "smartrecruiters:Swiggy",
    "workable:apna",
    "darwinbox:porter",
    "keka:hr",
    "zoho:skyroot.zohorecruit.in",
    "zoho:ultraviolette.zohorecruit.in",
    "jazzhr:changejar",
    "other:linkedin:porter-india",
  ]);
});

test("workable's own api/embed paths are not accounts", () => {
  assert.deepEqual(boardsInHtml(`<script src="https://apply.workable.com/embed/jobs.js"></script>`), []);
});

test("parseRss reads Google News items with a source", () => {
  const xml = `<rss><channel><item><title>Swish raises $24 Mn - Entrackr</title><link>https://news.google.com/rss/articles/x</link><guid>x</guid><pubDate>Mon, 07 Sep 2026 01:33:00 GMT</pubDate><source url="https://entrackr.com">Entrackr</source></item></channel></rss>`;
  const items = parseRss(xml, "Google News");
  assert.equal(items.length, 1);
  assert.equal(items[0]!.outlet, "Entrackr");
  assert.equal(items[0]!.date.toISOString(), "2026-09-07T01:33:00.000Z");
});

test("googleNewsUrl carries the date window", () => {
  const u = googleNewsUrl("startup raises india", new Date("2026-08-01"), new Date("2026-08-08"));
  assert.match(decodeURIComponent(u), /after:2026-08-01 before:2026-08-08/);
  assert.match(u, /gl=IN/);
});
