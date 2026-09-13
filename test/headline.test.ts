import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHeadline, stripOutlet, parseInvestors } from "../src/shared/headline.ts";

// Every case is a real headline seen in the feeds during the build.
const cases: Array<[string, Partial<ReturnType<typeof parseHeadline>> | null]> = [
  ["10-minute food delivery startup Swish raises $24 Mn led by Bertelsmann India Investments - Entrackr",
    { company: "Swish", descriptor: "10-minute food delivery startup", amount: 24e6, currency: "USD", investors: ["Bertelsmann India Investments"] }],
  ["Google-backed Indian space startup raises $100 million in latest funding round - Reuters", null],
  ["Swish raises $24 million in funding led by Bertelsmann India Investments - Moneycontrol.com",
    { company: "Swish", descriptor: null, amount: 24e6 }],
  ["Deeptech Startup Jaipur Robotics Raises €4.3 Mn, Eyes India Expansion - Inc42",
    { company: "Jaipur Robotics", descriptor: "Deeptech Startup", amount: 4.3e6, currency: "EUR" }],
  ["Indian EV startup River raises $120M Series C to scale production, launch more models - TechCrunch",
    { company: "River", descriptor: "EV startup", amount: 120e6, round: "Series C" }],
  ["Funding and acquisitions in Indian startups this week [July 27 - Aug 01] - Entrackr", null],
  ["Legal AI startup NYAI raises $1.5mn seed round from family offices - ET Entrepreneur",
    { company: "NYAI", amount: 1.5e6, round: "Seed", investors: [] }],
  ["Yamaha-backed Indian EV startup River Mobility raises $120 mln - Reuters",
    { company: "River Mobility", amount: 120e6 }],
  ["The Pizza Bakery operator Popo Global raises Rs 532 Cr from Artal Asia",
    { company: "Popo Global", descriptor: "Pizza Bakery operator", amount: 532e7, currency: "INR", investors: ["Artal Asia"] }],
  ["Graph AI raises $13.3 Mn in Series A round led by Insight Partners",
    { company: "Graph AI", amount: 13.3e6, round: "Series A", investors: ["Insight Partners"] }],
  ["AI contact centre startup Dialflo raises Rs 1.7 Cr led by AJVC",
    { company: "Dialflo", amount: 1.7e7, currency: "INR", investors: ["AJVC"] }],
  ["Cardless payments platform Piston raises $15 Mn in Series A led by FPV Ventures",
    { company: "Piston", descriptor: "Cardless payments platform", round: "Series A" }],
  ["Nishant Pitti pledges Rs 212 Cr EaseMyTrip shares with Motilal Oswal for personal use", null],
  ["ESDS Soars 92% To Lead New-Age Tech Stocks This Week", null],
  ["Peak XV raises $1.2 Bn for new fund", null],
  ["Zepto raises prices on late-night orders", null],
  ["RentoMojo raises Rs 400 Cr via IPO anchor book", null],
  ["Ola's Krutrim raises $50 Mn in debt from Matrix Partners",
    { company: "Krutrim", round: "Debt", investors: ["Matrix Partners"] }],
  ["Bengaluru-based fintech Jar secures $20 million from Tiger Global, Arkam Ventures and others",
    { company: "Jar", descriptor: "Fintech", amount: 20e6, investors: ["Tiger Global", "Arkam Ventures"] }],
  ["Ather Energy raises INR 400 Cr", { company: "Ather Energy", amount: 400e7, currency: "INR" }],
  ["Edtech unicorn upGrad bags Rs 1,000 crore from Temasek", { company: "upGrad", amount: 1000e7, currency: "INR", investors: ["Temasek"] }],
  ["Spacetech startup Pixxel closes $24 Mn Series B extension", { company: "Pixxel", round: "Series B extension" }],
  ["Quick commerce startup raises concerns over dark stores", null],
  ["Skyroot raises undisclosed amount from Temasek in pre-Series C", { company: "Skyroot", amount: null, round: "Pre-series C", investors: ["Temasek"] }],
  // Second pass: shapes seen in the first real run.
  ["[Update] Graph AI raises $13.3 Mn in Series A round led by Insight Partners", { company: "Graph AI" }],
  ["{Funding Alert} Circolife raises $4.5 Mn in pre-Series A led by Bharat Jaisinghani", { company: "Circolife", round: "Pre-series A" }],
  ["Exclusive: DaMENSCH raises Rs 60 Cr", { company: "DaMENSCH", amount: 60e7 }],
  ["Databricks raises $1 billion at $100 billion valuation", { company: "Databricks" }],
  ["Accel raises $3.5 billion for early-stage fund", null],
  ["VC tracker: Accel raises $3.5 Bn", null],
  ["Construction qcomm outfit HomeRun raises $12 Mn from Nexus Venture Partners", { company: "HomeRun", investors: ["Nexus Venture Partners"] }],
  ["Q-comm for building material industry Fixxly raises $5.5M seed", { company: "Fixxly", round: "Seed" }],
  ["specialty coffee QSR Third Wave Coffee raises Rs 408 Cr", { company: "Third Wave Coffee" }],
  ["Uber Black fleet partner raises Rs 96 Cr", null],
  ["Comet, the homegrown sneaker brand, raises Rs 100 Cr in Series B from Verlinvest", { company: "Comet", round: "Series B", investors: ["Verlinvest"] }],
  ["AI Infra Play, BUILT Raises $2 Mn", { company: "BUILT", amount: 2e6 }],
  ["Lightstorm Launches AI Superhighway, raises Rs 2,500 Cr", { company: "Lightstorm" }],
  ["Former Dyson India boss Ankit Jain raises pre-seed from BEENEXT", null],
  ["IIT Kharagpur grad gave up PhD dream to build AI startup in San Francisco, raises Rs 580 Cr", null],
  ["RailTel Corporation of India raises Rs 167 Cr from EPFO", null],
  ["Aditya Birla Group raises Rs 24,000 Cr", null],
  ["Omega Seiki Mobility once again raises Rs 50 Cr from Abhishek Misra, Unistone", { company: "Omega Seiki Mobility", investors: ["Abhishek Misra", "Unistone"] }],
  ["Carrum Mobility raises $10 Mn Series B from Uber, Nearly Doubles Business Since January", { company: "Carrum Mobility", investors: ["Uber"] }],
  ["Nua raises $50 Mn in Series C led by Peak XV Partners, Filter Capital and Peak XV", { investors: ["Peak XV Partners", "Filter Capital"] }],
  ["HerSpace raises $40 Mn from existing investor Gray Matters Capital", { company: "HerSpace", investors: ["Gray Matters Capital"] }],
  ["Pixxel raises $100M from Temasek, Seraphim, Google | Inshorts", { company: "Pixxel", investors: ["Temasek", "Seraphim", "Google"] }],
  ["Sugar Cosmetics raises Rs 145 Cr from A91 Partners Amid Valuation Reset", { company: "Sugar Cosmetics", investors: ["A91 Partners"] }],
  ["Navana.ai raises Rs 40 Cr in Series A led by Ronnie Screwvala", { company: "Navana.ai", key: "navana" }],
  ["tunnel startup raises $3 billion", null],
  ["B'luru startup raises Rs 24 Cr", null],
  ["ETtech Deals Digest: Startups raise $1.11 billion this week", null],
  ["GE Power India bags Rs 550 Cr order from Saudi Arabia", null],
  ["24 Indian startups raise Rs 2,090 Cr this week", null],
  ["Between August 31 and September 05, startups raised $291 Mn", null],
  ["Bodycraft Clinic and Salon raises Rs 120 Cr from PE firm Singularity AMC", { company: "Bodycraft Clinic and Salon", investors: ["Singularity AMC"] }],
  ["PharmEasy Founders' AllHome raises Rs 200 Cr", { company: "AllHome" }],
  ["Comet raises Rs 100 Cr in Series B from Verlinvest - business-standard.com - Business Standard", { company: "Comet", investors: ["Verlinvest"] }],
  ["'Innovation or modern slavery?' Startup offers 'CarryMen' to haul Delhi shoppers, gets Rs 79/hour", null],
  ["Largest funding in India's space sector: Pixxel raises $100M Series C from Temasek, Seraphim, Google", { company: "Pixxel", descriptor: null, investors: ["Temasek", "Seraphim", "Google"] }],
  ["Pixxel raises $100 Mn from Singapore's Temasek, UK-based Seraphim and Google", { investors: ["Temasek", "Seraphim", "Google"] }],
  ["At 7, he entered Guinness records; at 16, built a satellite: How a 20-year-old from Jammu raised $4.3 million", null],
];

for (const [title, expect] of cases) {
  test(title, () => {
    const got = parseHeadline(title);
    if (expect === null) {
      assert.equal(got, null, `expected no event, got ${JSON.stringify(got)}`);
      return;
    }
    assert.ok(got, "expected an event");
    for (const [k, v] of Object.entries(expect)) {
      assert.deepEqual((got as unknown as Record<string, unknown>)[k], v, `field ${k}`);
    }
  });
}

test("stripOutlet handles Google News suffixes", () => {
  assert.deepEqual(stripOutlet("X raises $1M - Entrackr"), { title: "X raises $1M", outlet: "Entrackr" });
  assert.deepEqual(stripOutlet("X raises $1M"), { title: "X raises $1M", outlet: null });
  assert.equal(stripOutlet("Delhi-based X raises $1M in pre-Series A - Inc42").title, "Delhi-based X raises $1M in pre-Series A");
});

test("parseInvestors stops at clause boundaries", () => {
  assert.deepEqual(parseInvestors("$5 Mn led by Accel, Blume Ventures and others to expand in Tier 2"), ["Accel", "Blume Ventures"]);
  assert.deepEqual(parseInvestors("$5 Mn from existing investors"), []);
});
