// Is this job in India? Boards write locations a hundred ways: "Bengaluru",
// "Bangalore, KA", "Head Office, Bengaluru, Karnataka, India", "Remote - India",
// "Gurgaon/Remote", "IN". The classifier is a word list, not geocoding, and it
// is deliberately generous about "Remote" for an Indian startup.

const CITY = [
  "india", "bengaluru", "bangalore", "mumbai", "navi mumbai", "thane", "delhi", "new delhi", "delhi ncr", "ncr",
  "gurgaon", "gurugram", "noida", "greater noida", "faridabad", "ghaziabad", "hyderabad", "secunderabad", "pune",
  "chennai", "kolkata", "ahmedabad", "gandhinagar", "jaipur", "chandigarh", "mohali", "kochi", "cochin", "indore",
  "bhopal", "lucknow", "kanpur", "nagpur", "surat", "vadodara", "baroda", "coimbatore", "madurai", "trivandrum",
  "thiruvananthapuram", "bhubaneswar", "visakhapatnam", "vizag", "vijayawada", "mysuru", "mysore", "mangaluru",
  "mangalore", "hubli", "goa", "panaji", "dehradun", "patna", "ranchi", "raipur", "guwahati", "rajkot", "nashik",
  "aurangabad", "ludhiana", "amritsar", "jodhpur", "udaipur", "kota", "agra", "varanasi", "prayagraj", "allahabad",
  "meerut", "kozhikode", "calicut", "thrissur", "salem", "tiruchirappalli", "trichy", "warangal", "hosur",
  "karnataka", "maharashtra", "tamil nadu", "telangana", "andhra pradesh", "kerala", "gujarat", "rajasthan",
  "haryana", "punjab", "uttar pradesh", "madhya pradesh", "west bengal", "odisha", "bihar", "jharkhand",
  "uttarakhand", "himachal", "assam", "chhattisgarh",
];

const NOT_INDIA = [
  "united states", "usa", "us", "u.s.", "san francisco", "new york", "seattle", "austin", "boston", "chicago", "london",
  "united kingdom", "uk", "singapore", "dubai", "abu dhabi", "uae", "germany", "berlin", "amsterdam", "netherlands",
  "paris", "france", "canada", "toronto", "vancouver", "australia", "sydney", "melbourne", "japan", "tokyo",
  "indonesia", "jakarta", "philippines", "manila", "vietnam", "thailand", "bangkok", "malaysia", "kuala lumpur",
  "saudi", "riyadh", "kenya", "nairobi", "nigeria", "lagos", "brazil", "mexico", "ireland", "dublin", "israel",
  "tel aviv", "sweden", "stockholm", "spain", "madrid", "barcelona", "italy", "portugal", "lisbon", "poland",
  "bangladesh", "dhaka", "sri lanka", "colombo", "nepal", "kathmandu", "pakistan", "china", "shanghai", "hong kong",
  "south korea", "seoul", "taiwan", "europe", "emea", "apac", "latam", "north america",
];

const wordRe = (w: string) => new RegExp(`(?:^|[^a-z])${w.replace(/[.]/g, "\\.")}(?![a-z])`);
const CITY_RE = CITY.map(wordRe);
const NOT_RE = NOT_INDIA.map(wordRe);

export type Region = "india" | "remote" | "abroad" | "unknown";

export function classifyLocation(raw: string | null | undefined): Region {
  const s = (raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return "unknown";
  if (/(?:^|[^a-z])(?:in|ind)(?![a-z])/.test(s) && s.length <= 4) return "india"; // bare country code
  if (CITY_RE.some((r) => r.test(s))) return "india";
  if (NOT_RE.some((r) => r.test(s))) return "abroad";
  if (/remote|work from home|wfh|anywhere|distributed/.test(s)) return "remote";
  return "unknown";
}

/** India-eligible: in India, or remote with no other country named. */
export function isIndia(raw: string | null | undefined): boolean {
  const r = classifyLocation(raw);
  return r === "india" || r === "remote";
}

/** "Head Office, Bengaluru, Karnataka, India" → "Bengaluru". */
export function shortLocation(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
  if (!s) return "—";
  const lower = s.toLowerCase();
  const canonical: Array<[RegExp, string]> = [
    [/bengaluru|bangalore/, "Bengaluru"], [/navi mumbai|mumbai|thane/, "Mumbai"], [/gurgaon|gurugram/, "Gurugram"],
    [/noida/, "Noida"], [/new delhi|delhi/, "Delhi"], [/hyderabad|secunderabad/, "Hyderabad"], [/pune/, "Pune"],
    [/chennai/, "Chennai"], [/kolkata/, "Kolkata"], [/ahmedabad/, "Ahmedabad"], [/jaipur/, "Jaipur"],
    [/chandigarh|mohali/, "Chandigarh"], [/kochi|cochin/, "Kochi"], [/indore/, "Indore"], [/coimbatore/, "Coimbatore"],
    [/lucknow/, "Lucknow"], [/bhubaneswar/, "Bhubaneswar"], [/goa|panaji/, "Goa"], [/surat/, "Surat"],
    [/remote|work from home|wfh|anywhere/, "Remote"],
  ];
  for (const [re, name] of canonical) if (re.test(lower)) return name;
  if (classifyLocation(s) === "india") return s.split(",")[0]!.trim();
  return s.length > 28 ? s.slice(0, 26) + "…" : s;
}
