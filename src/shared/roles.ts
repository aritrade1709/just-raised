// Job title → one of a few families a job seeker filters by. Order matters:
// "Product Designer" is Design, "Product Manager, On-Device AI" is Product,
// "Sales Engineer" is Sales, "Data Engineer" is Data — the family named by
// the *role* wins over the one named by the *domain*, so Design, Product,
// Sales and Marketing are checked before Data & AI and Engineering.

export const FAMILIES = [
  "Engineering", "Data & AI", "Product", "Design", "Sales", "Marketing", "Operations", "Finance & Legal", "People", "Customer", "Other",
] as const;
export type Family = (typeof FAMILIES)[number];

const rules: Array<[Family, RegExp]> = [
  ["Design", /\b(designer|design lead|head of design|\bux\b|\bui\b|ui\/ux|user experience|visual|motion|graphic|illustrat|creative director|art director|brand design)/i],
  ["Product", /\b(product manager|product owner|product lead|head of product|\bapm\b|\bpm\b|program manager|technical program|tpm|product analyst|product ops|product marketing)/i],
  ["Sales", /\b(sales|\bgtm\b|go-to-market|business development|\bbd\b|\bbdm\b|\bbde\b|account executive|account manager|key account|partnerships?|alliances|revenue|pre-?sales|solutions? consultant|solutions? engineer|inside sales|field sales|enterprise|channel|dealer|franchise|territory|relationship manager|wealth manager|telecall|tele-?sales)/i],
  ["Marketing", /\b(marketing|growth|brand|content|seo|sem|performance|social media|community|\bpr\b|public relations|communications?|copywriter|copy|influencer|campaign|crm|lifecycle|creator|editorial|video editor|writer)/i],
  ["Data & AI", /\b(data (?:scientist|analyst|engineer|science|analytics|platform)|analytics|machine learning|\bml\b|\bai\b|artificial intelligence|deep learning|nlp|computer vision|llm|research scientist|applied scientist|business intelligence|\bbi\b|quant|decision scien|statistic)/i],
  ["Engineering", /\b(engineer|engineering|developer|\bsde\b|software|backend|back-end|frontend|front-end|full[- ]?stack|devops|\bsre\b|site reliability|architect|\bqa\b|quality|test|tester|automation|android|ios|mobile|flutter|react|node|java|python|golang|\bgo\b|rust|kotlin|swift|platform|infrastructure|infra|embedded|firmware|hardware|electrical|electronics|mechanical|\bcad\b|robotics|\bplc\b|security|cloud|database|dba|blockchain|solidity|tech lead|cto|vp engineering|r&d|scientist|technician|maintenance)/i],
  ["Finance & Legal", /\b(finance|financial|accounts?|accountant|accounting|\bca\b|chartered|audit|tax|treasury|fp&a|financial controller|legal|counsel|compliance|company secretary|\bcs\b|secretarial|investor relations|billing|collections?|credit|risk|underwrit|actuar|fraud)/i],
  ["People", /\b(\bhr\b|human resources|talent|recruit|people|l&d|learning and development|payroll|hrbp|admin|office manager|workplace|culture)/i],
  ["Customer", /\b(customer|support|success|service|care|helpdesk|help desk|onboarding|implementation|client servicing|escalation|chat|voice process|bpo|kyc|verification)/i],
  ["Operations", /\b(operations?|\bops\b|supply chain|logistics|fulfil+ment|warehouse|hub|fleet|delivery|rider|driver|city|cluster|zonal|regional|area manager|store|procurement|sourcing|category|merchandis|vendor|inventory|planning|project manager|program|strategy|chief of staff|founder'?s office|business analyst|associate|executive assistant|manager|lead|head|director|intern|trainee|general manager)/i],
];

export function roleFamily(title: string): Family {
  const t = title.replace(/[\s_/-]+/g, " ");
  for (const [family, re] of rules) if (re.test(t)) return family;
  return "Other";
}
