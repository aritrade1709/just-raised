import type { Currency } from "./types.ts";
import { toUsd } from "./money.ts";

export interface ParsedHeadline {
  company: string;
  key: string;
  descriptor: string | null;
  amount: number | null;
  currency: Currency | null;
  usd: number | null;
  round: string | null;
  investors: string[];
}

// Verbs that announce a raise. Past and present tense, because outlets differ.
const VERB =
  /\b(raises|raised|secures|secured|bags|bagged|lands|landed|closes|closed|nets|netted|picks up|picked up|mops up|mopped up|scoops up|scooped up|snags|snagged|garners|garnered|rakes in|raked in|pockets|pocketed|attracts|attracted|gets|got|receives|received|clinches|clinched|wins|won)\b/i;

// Headlines that use a raise verb but are not a startup funding round.
const NOT_A_ROUND =
  /\b(ipo|qip|rights issue|ncds?|public issue|anchor (?:book|investors?)|listing|listed|grey market|gmp|stake sale|block deal|buyback|pledges?|prices?|concerns?|alarm|eyebrows|questions|the bar|stakes|red flags?|hopes|doubts|salaries|salary|fees?|tariffs?|rates?|target|guidance|forecast|outlook|awareness|funds?\s*(?:ii|iii|iv|v|2|3)?\b(?!\s*(?:from|led))|fund of funds|aif|maiden fund|debut fund|second fund|third fund|new fund|growth fund|venture fund|seed fund|opportunit(?:y|ies) fund|first close|final close|corpus|lays? off|layoffs?|fires?|shuts?|shutdown|acquires?|acquisition|merger|revenue|profit|loss|losses|valuation cut|down round|writes? down|orders?|contracts?|tender|deal worth|project|grant|prize|award|subsidy|loan from (?:sbi|hdfc|icici|bank)|bank loan|private equity|pe fund|strategy|mandate)\b/i;

// The words that end a descriptor and start the company name. Kept as a
// list, not a smart parser — every entry was seen in a real headline.
const DESCRIPTOR_TAIL =
  /\b(startup|start-up|platform|company|firm|maker|brand|app|player|major|unicorn|operator|provider|marketplace|network|chain|lender|insurer|fintech|edtech|healthtech|agritech|foodtech|proptech|deeptech|spacetech|cleantech|climatetech|biotech|medtech|insurtech|regtech|legaltech|hrtech|adtech|martech|traveltech|saas|d2c|ev maker|automaker|manufacturer|developer|builder|venture|parent|owner|subsidiary|arm|unit|label|studio|retailer|aggregator|exchange|bank|neobank|nbfc|clinic|hospital|school|academy|publisher|agency|consultancy|foundry|fab|oem|drone maker|robotics firm|ai lab|lab|labs|qsr|ott|dao|ngo|nbfc|epc)\b/i;

const AMOUNT_USD = /(?:us\s?)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|bn|b|million|mn|mln|mm|m|thousand|k)?\b/i;
const AMOUNT_INR = /(?:inr|rs\.?|₹)\s?(\d[\d,]*(?:\.\d+)?)\s*(crore|cr|lakhs?|lacs?|l|million|mn|billion|bn)?\b/i;
const AMOUNT_EUR = /€\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|bn|b|million|mn|mln|m|k)?\b/i;
const AMOUNT_GBP = /£\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|bn|b|million|mn|mln|m|k)?\b/i;
const AMOUNT_WORDS = /(\d[\d,]*(?:\.\d+)?)\s*(crore|cr|lakhs?)\b/i; // "raises 40 crore" with no symbol

const ROUND =
  /\b(pre-?\s?seed|seed(?:\s?extension|\s?plus|\+)?|angel|pre-?\s?series\s?[a-h]|series\s?[a-h](?:\d|\s?extension|\s?bridge)?|bridge|extension|growth|venture debt|debt|late[- ]stage|early[- ]stage|follow-on|strategic)\b(?:\s+(?:funding\s+)?round)?/i;

const OUTLET_SUFFIX = / [-–—|] [^-–—|]{2,60}$/;

// "[Update]", "{Funding Alert}", "Exclusive:", "VC tracker:" — labels outlets
// put in front of the actual headline.
const PREFIX_JUNK = /^(?:\s*[\[{(][^\]})]{1,40}[\]})]\s*[:\-–—]?\s*)+|^(?:[A-Z][\w.'’&\s-]{1,30}):\s+(?=[A-Z0-9])/;

// Subjects that are an investor, a corporate, a government body or a person,
// not a startup that raised.
const NOT_A_STARTUP =
  /\b(ventures|capital|partners|\bvc\b|fund|accel|sequoia|peak xv|lightspeed|nexus|blume|elevation|matrix|kalaari|chiratae|3one4|stellaris|prime venture|z47|bessemer|tiger global|softbank|temasek|corporation|corp\.?|plc|psu|ministry|government|govt|reserve bank|sebi|rbi|nse|bse|infosys|tcs|wipro|hcl|reliance|adani|tata|birla|mahindra|bajaj|jio|airtel|vodafone|hdfc|icici|sbi|kotak|axis|university|college|students?|former|ex-|founder|co-founder|ceo|cto|boss|grad|graduate|techie|banker|engineer|entrepreneur|couple|brothers?|sisters?|duo|trio|group)\b/i;

// A second verb inside the subject means the raise is a sub-clause:
// "Lightstorm Launches AI Superhighway, raises Rs 2,500 Cr".
const SUBJECT_VERB = /\b(launches|launched|unveils|unveiled|plans|planning|eyes|eyeing|expands|expanding|partners|acquires|acquired|appoints|opens|hits|crosses|clocks|posts|reports|turns|enters|targets|aims|sets|bets|doubles|triples|surges|soars|jumps|files|joins|introduces|debuts|rolls out|ties up|teams up|inks|signs|wins|bags|lands)\b/i;

export function stripOutlet(title: string): { title: string; outlet: string | null } {
  let t = title.replace(PREFIX_JUNK, "").trim();
  const m = t.match(OUTLET_SUFFIX);
  if (!m) return { title: t, outlet: null };
  t = t.slice(0, m.index).trim();
  // "Headline - Section - Outlet": one more.
  const m2 = t.match(OUTLET_SUFFIX);
  if (m2 && /\.(?:com|in|co|net|org)$|news|times|express|standard|herald|mint|today|business|tech|story|inc42|entrackr/i.test(m2[0])) t = t.slice(0, m2.index).trim();
  return { title: t, outlet: m[0].slice(3).trim() };
}

export function normaliseKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(?:ai|com|io|in|co|app|xyz|tech|health|space)\b/g, "")
    .replace(/\b(pvt|private|ltd|limited|inc|llp|technologies|technology|tech|labs?|india|solutions|ventures|fundraise|funding|round|series [a-h])\b/g, "")
    .replace(/\s+ai$/, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseNumber(raw: string, unit: string | undefined, currency: Currency): number {
  const n = parseFloat(raw.replace(/,/g, ""));
  const u = (unit ?? "").toLowerCase();
  if (currency === "INR") {
    if (u === "crore" || u === "cr") return n * 1e7;
    if (u.startsWith("lakh") || u.startsWith("lac") || u === "l") return n * 1e5;
    if (u === "million" || u === "mn") return n * 1e6;
    if (u === "billion" || u === "bn") return n * 1e9;
    return n; // bare rupees — rare, almost always a typo in the headline
  }
  if (u === "billion" || u === "bn" || u === "b") return n * 1e9;
  if (u === "million" || u === "mn" || u === "mln" || u === "mm" || u === "m") return n * 1e6;
  if (u === "thousand" || u === "k") return n * 1e3;
  // "$24" with no unit is never a real round size; treat as millions only if
  // the number is small enough to be one. Otherwise take it literally.
  return n < 1000 ? n * 1e6 : n;
}

export function parseAmount(text: string): { amount: number; currency: Currency } | null {
  let m = text.match(AMOUNT_USD);
  if (m && m[1]) return { amount: parseNumber(m[1], m[2], "USD"), currency: "USD" };
  m = text.match(AMOUNT_INR);
  if (m && m[1]) return { amount: parseNumber(m[1], m[2], "INR"), currency: "INR" };
  m = text.match(AMOUNT_EUR);
  if (m && m[1]) return { amount: parseNumber(m[1], m[2], "EUR"), currency: "EUR" };
  m = text.match(AMOUNT_GBP);
  if (m && m[1]) return { amount: parseNumber(m[1], m[2], "GBP"), currency: "GBP" };
  m = text.match(AMOUNT_WORDS);
  if (m && m[1]) return { amount: parseNumber(m[1], m[2], "INR"), currency: "INR" };
  return null;
}

export function parseRound(text: string): string | null {
  const m = text.match(ROUND);
  if (!m) return null;
  let r = m[1]!.toLowerCase().replace(/\s+/g, " ").replace(/pre-?\s?/, "pre-");
  r = r.replace(/^series\s?([a-h])/, "series $1");
  // Title-case for display: "Series A", "Pre-seed", "Venture debt".
  r = r.replace(/series ([a-h])/, (_, l: string) => `series ${l.toUpperCase()}`);
  return r.charAt(0).toUpperCase() + r.slice(1);
}

const INVESTOR_LEAD = /\b(?:led by|co-led by|from|backed by|with participation from|with participation of|joined by|via)\b\s+(.+)$/i;
const INVESTOR_JUNK = /^(?:others?|existing investors?|new investors?|investors?|angels?|angel investors?|family offices?|hnis?|the round|round|participation|a clutch of investors|a group of investors|undisclosed investors?|marquee investors?)$/i;

export function parseInvestors(text: string): string[] {
  const m = text.match(INVESTOR_LEAD);
  if (!m || !m[1]) return [];
  let tail = m[1].replace(/[.;!?]+$/, "").replace(/\s*\|.*$/, "").replace(/\s+[-–—]\s+.*$/, "");
  // Cut at the first clause that is clearly not an investor list.
  tail = tail.replace(/[,;]?\s*\b(?:eyes|plans|aims|targets|looks|sets|will|nearly|doubles|valued|valuation|expands|launches|enters|hits|crosses|posts|clocks|reports|amid|after|ahead of|towards|as part of|at a|at \$|at rs|at inr|at ₹|post|pre|in|to|for|at|as|and others|others|et al)\b.*$/i, "");
  tail = tail.replace(/\b(?:existing|new|returning|lead|marquee|strategic|angel|institutional|prominent|other)\s+investors?\s+(?:like|including|such as)?\s*/gi, "");
  tail = tail.replace(/\b(?:pe|vc|private equity|venture capital|investment|impact)\s+(?:firm|fund|house|major|giant)\s+/gi, "");
  const names = tail
    .split(/,|\band\b|&|;/i)
    // "Singapore's Temasek", "UK-based Seraphim", "the SoftBank": the name only.
    .map((s) => s.trim().replace(/^(?:the|by)\s+/i, "").replace(/^[\w.]+['’]s\s+/, "").replace(/^[\w.-]+-(?:based|backed|led|listed|headquartered)\s+/i, "").replace(/\s+/g, " "))
    .filter((s) => s.length > 1 && s.length < 60 && !INVESTOR_JUNK.test(s));
  // "Peak XV" and "Peak XV Partners" are one investor; keep the longer form.
  const out: string[] = [];
  for (const n of names) {
    const k = n.toLowerCase();
    const idx = out.findIndex((o) => o.toLowerCase().startsWith(k) || k.startsWith(o.toLowerCase()));
    if (idx === -1) out.push(n);
    else if (n.length > out[idx]!.length) out[idx] = n;
  }
  return out.slice(0, 6);
}

// Words that never form a company name on their own. A candidate name made
// entirely of these ("space startup", "quick commerce platform") is unnamed.
const GENERIC = new Set(
  `startup start-up startups platform company firm maker brand app player major unicorn operator provider marketplace network chain lender insurer developer builder venture parent owner subsidiary arm unit label studio retailer aggregator exchange bank neobank nbfc clinic hospital school academy publisher agency consultancy foundry fab oem lab labs
   indian india india's homegrown domestic based backed owned led founded new own
   tech deeptech spacetech cleantech climatetech biotech medtech insurtech regtech legaltech hrtech adtech martech traveltech fintech edtech healthtech agritech foodtech proptech saas d2c b2b b2c ai ml genai llm ev
   tunnel space-tech sector scheme swap american lifestyle techie origin outfit qcomm q-comm quick-commerce industry material building manager investment alternative private students university boss former once again play digest deals startups this week here with behind for and of at on by to launches brother dubai francisco san first ai-powered ai-first ai-native homegrown sneaker construction alco-bev qsr specialty craft whiskey
   space electric vehicle vehicles mobility energy solar battery health healthcare wellness fitness quick commerce food delivery logistics consumer digital online mobile payments payment lending credit insurance wealth agri farm drone drones robotics climate gaming media content creator social dating travel hotel fashion beauty personal care pet home real estate auto automotive car bike two-wheeler three-wheeler ride ride-hailing grocery kirana retail fmcg beverage coffee tea snack nutrition sleep mental legal hr recruitment hiring staffing gig blue-collar skilling upskilling test prep coaching tutoring kids toys parenting women femtech senior elder wedding event events ticketing jewellery jewelry gold crypto web3 blockchain voice video audio semiconductor chip hardware iot cyber cybersecurity security cloud data analytics devtools developer api infra infrastructure enterprise sme msme supply procurement manufacturing industrial defence defense aerospace satellite launch rocket pharma medical device diagnostics telehealth bnpl 10-minute 15-minute minute contact centre center legal-ai ai-powered ai-driven ai-native ai-first`
    .split(/\s+/)
    .filter(Boolean),
);

const CITIES = new Set(
  "delhi mumbai bengaluru bangalore gurugram gurgaon noida hyderabad pune chennai kolkata ahmedabad jaipur kochi indore chandigarh surat lucknow bhubaneswar coimbatore".split(" "),
);

const JOINER = /^(?:and|or|at|in|of|the|with|for|to|by|from|as|on|via|&|n)$/i;
const isGeneric = (t: string) => /^[\d.,%]+$/.test(t) || GENERIC.has(t.toLowerCase().replace(/[^\w'-]/g, ""));
const isDescriptor = (t: string) => DESCRIPTOR_TAIL.test(t) && DESCRIPTOR_TAIL.exec(t)![0].length === t.replace(/[^\w-]/g, "").length;

/** The subject phrase → company name + descriptor. */
export function parseSubject(subject: string, titleCase = false): { company: string; descriptor: string | null } | null {
  let s = subject.trim().replace(/[:,]+$/, "");
  // "Largest funding in India's space sector: Pixxel" — a lede before a colon.
  s = s.replace(/^.*:\s+(?=\S)/, "");
  // A verb inside the subject: keep what comes before it.
  const sv = s.match(SUBJECT_VERB);
  if (sv && sv.index !== undefined && sv.index > 0) s = s.slice(0, sv.index).trim().replace(/[:,]+$/, "");
  // "Comet, the homegrown sneaker brand" → Comet. "AI Infra Play, BUILT" → BUILT.
  if (s.includes(",")) {
    const [before, ...rest] = s.split(",").map((x) => x.trim());
    const after = rest.join(", ");
    const afterTokens = after.split(/\s+/).filter(Boolean);
    const afterGeneric = afterTokens.length > 0 && afterTokens.every(isGeneric);
    if (afterGeneric || !after) s = before!;
    else if (afterTokens.length <= 3) s = after;
    else s = before!;
  }
  s = s.replace(/\b(?:once again|again|too|also|now)$/i, "").trim();
  if (/^(?:in|with|behind|for|at|on|by|to|of|from|after|amid|as|and|or|but|via|between)\b/i.test(s)) return null;
  let tokens = s.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  // "Peak XV-backed", "Bengaluru-based", "Zomato-owned": drop through the marker.
  const marker = tokens.findIndex((t, i) => i < 4 && /-(?:backed|based|led|owned|founded|incubated)$/i.test(t));
  if (marker >= 0) tokens = tokens.slice(marker + 1);

  // Leading articles, nationality, bare city names before a generic word.
  while (tokens.length > 1) {
    const t = tokens[0]!.toLowerCase().replace(/[^\w'’-]/g, "");
    if (/^(?:the|an?|indian|india's|india’s|homegrown|domestic)$/.test(t)) { tokens.shift(); continue; }
    if (CITIES.has(t) && (isGeneric(tokens[1]!) || isDescriptor(tokens[1]!))) { tokens.shift(); continue; }
    break;
  }

  // "Ola's Krutrim", "Zomato's quick commerce arm Blinkit": everything after
  // the possessive is the subject we care about.
  const poss = tokens.findIndex((t, i) => i < 3 && /(?:['’]s|s['’])$/i.test(t));
  if (poss >= 0 && tokens.length > poss + 1) tokens = tokens.slice(poss + 1);

  // Last descriptor word that still leaves a real name after it.
  for (let i = tokens.length - 2; i >= 0; i--) {
    if (!isDescriptor(tokens[i]!)) continue;
    const rest = tokens.slice(i + 1);
    if (rest.every(isGeneric)) continue;
    // "Clinic and Salon": the descriptor word was part of the name.
    if (JOINER.test(rest[0]!)) continue;
    return finish(rest.join(" "), tokens.slice(0, i + 1).join(" "));
  }
  if (tokens.every(isGeneric)) return null;

  // In a sentence-case headline the company is the run of capitalised tokens
  // at the end of the subject: "specialty coffee chain Third Wave Coffee".
  // If the subject ends in lowercase words, nothing was named.
  if (!titleCase && tokens.length > 1) {
    const cap = (t: string) => /^[A-Z0-9]|^[a-z]+[A-Z]|\.[a-z]{2,4}$/.test(t) || /^(?:of|&|and|the|for|de|by|n)$/i.test(t);
    if (!cap(tokens[tokens.length - 1]!)) return null;
    let i = tokens.length - 1;
    while (i > 0 && cap(tokens[i - 1]!)) i--;
    // A lone joiner at the start of the run belongs to the descriptor.
    while (i < tokens.length - 1 && /^(?:of|&|and|the|for|de|by|n)$/i.test(tokens[i]!)) i++;
    // "a 20-year-old from Jammu": a capitalised word after a preposition is a
    // place or a person, not the company.
    if (i > 0 && /^(?:from|in|at|of|to|by|with|for|on|near|across)$/i.test(tokens[i - 1]!)) return null;
    if (i > 0) return finish(tokens.slice(i).join(" "), tokens.slice(0, i).join(" "));
  }
  return finish(tokens.join(" "), null);
}

/** True when most longer words are capitalised — Inc42 house style. */
export function isTitleCase(title: string): boolean {
  const words = title.split(/\s+/).filter((w) => /^[a-z]{4,}$/i.test(w));
  if (words.length < 4) return false;
  const caps = words.filter((w) => /^[A-Z]/.test(w)).length;
  return caps / words.length >= 0.8;
}

function finish(name: string, descriptor: string | null): { company: string; descriptor: string | null } | null {
  let n = name.replace(/\s+/g, " ").replace(/^["'“‘]+|["'”’]+$/g, "").replace(/^[,:-]\s*/, "").trim();
  n = n.replace(/\s*\((?:formerly|earlier|now)[^)]*\)\s*$/i, "");
  n = n.replace(/['’]s$/, "").trim();
  if (!n || n.split(" ").length > 6 || /^\d+$/.test(n)) return null;
  if (JOINER.test(n.split(" ")[0]!)) return null;
  if (/^(?:it|its|this|that|company|startup|firm|the company|the startup)$/i.test(n)) return null;
  let d = descriptor ? descriptor.replace(/\s+/g, " ").replace(/^(?:the|an?)\s+/i, "").trim() : null;
  // "Startup" on its own says nothing; "Fintech" does.
  if (d && /^(?:startup|start-up|company|firm|platform|brand|app|unicorn|major|player|venture|indian startup|india-based startup)$/i.test(d)) d = null;
  return { company: n, descriptor: d && d.length > 2 ? capitalise(d) : null };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Turn one headline into a funding event, or null when it is not one.
 * Deliberately conservative: a false negative costs one listing; a false
 * positive puts a company on the wall that never raised.
 */
export function parseHeadline(rawTitle: string): ParsedHeadline | null {
  const { title } = stripOutlet(rawTitle);
  const v = title.match(VERB);
  if (!v || v.index === undefined) return null;
  const subject = title.slice(0, v.index);
  const rest = title.slice(v.index + v[0].length);
  if (NOT_A_ROUND.test(rest) || NOT_A_ROUND.test(subject)) return null;
  if (NOT_A_STARTUP.test(subject)) return null;
  // Weekly roundups, lists, opinion.
  if (/^\s*(?:funding|weekly|top \d+|\d+ startups|here'?s|why|how|what|who|when|opinion|explained)/i.test(title)) return null;
  if (/\bfunding (?:and|&) acquisitions\b|\bweek(?:ly)?\b.*\[/i.test(title)) return null;

  const money = parseAmount(rest);
  // "Rs 79/hour" is not a round.
  if (money && toUsd(money.amount, money.currency) < 50_000) return null;
  const round = parseRound(rest);
  const investors = parseInvestors(rest);
  const fundingWord = /\b(?:fund(?:ing|raise)|round|capital|investment|financing|cheque|check|backing|money|seed|series)\b/i.test(rest);
  // "X raises $5M" is enough. "X raises funding from Y" is enough. "X raises
  // eyebrows" is not — no money, no round, no funding word.
  if (!money && !round && !fundingWord) return null;

  const subj = parseSubject(subject, isTitleCase(title));
  if (!subj) return null;
  return {
    company: subj.company,
    key: normaliseKey(subj.company),
    descriptor: subj.descriptor,
    amount: money?.amount ?? null,
    currency: money?.currency ?? null,
    usd: money ? toUsd(money.amount, money.currency) : null,
    round,
    investors,
  };
}
