// Day-to-day cost categories mapped to ledger accounts (DOMAIN_AND_DATA.md §7).
// Users pick the plain-language label; the ledger account is chosen for them.

export type CategoryGroup = "office" | "people" | "travel" | "sales" | "premises";

export interface CostCategory {
  key: string;
  account: string;
  icon: string; // Phosphor icon name
  group: CategoryGroup;
  vatRateBp: number; // VAT included in the gross amount
  reclaim: boolean; // input VAT reclaimable
  label: { en: string; nl: string };
  vatNote?: { en: string; nl: string };
  note?: { en: string; nl: string };
  keywords: string;
  importOnly?: boolean;
}

export const CATEGORY_GROUPS: { key: CategoryGroup; en: string; nl: string }[] = [
  { key: "office", en: "Office & IT", nl: "Kantoor & IT" },
  { key: "people", en: "People", nl: "Personeel" },
  { key: "travel", en: "Travel & car", nl: "Reizen & auto" },
  { key: "sales", en: "Sales & hospitality", nl: "Verkoop & relaties" },
  { key: "premises", en: "Premises & finance", nl: "Pand & financiën" },
];

export const CATEGORIES: CostCategory[] = [
  { key: "office", account: "4500", icon: "Paperclip", group: "office", vatRateBp: 2100, reclaim: true, label: { en: "Office supplies", nl: "Kantoorartikelen" }, keywords: "paper toner ink pens printer stationery staples papier" },
  { key: "software", account: "4520", icon: "Laptop", group: "office", vatRateBp: 2100, reclaim: true, label: { en: "Software & subscriptions", nl: "Software & abonnementen" }, keywords: "saas licence adobe microsoft google computer" },
  { key: "postage", account: "4540", icon: "EnvelopeSimple", group: "office", vatRateBp: 2100, reclaim: true, label: { en: "Postage & couriers", nl: "Porto & koeriers" }, keywords: "postnl dhl ups stamps parcel pakket" },
  { key: "phone", account: "4610", icon: "Phone", group: "office", vatRateBp: 2100, reclaim: true, label: { en: "Phone & internet", nl: "Telefoon & internet" }, keywords: "kpn vodafone odido mobile" },
  { key: "wages", account: "4000", icon: "UsersThree", group: "people", vatRateBp: 0, reclaim: false, importOnly: true, label: { en: "Wages & payroll", nl: "Lonen & salarissen" }, vatNote: { en: "No VAT", nl: "Geen btw" }, keywords: "salary payroll loon" },
  { key: "staff", account: "4100", icon: "HandHeart", group: "people", vatRateBp: 900, reclaim: false, label: { en: "Staff lunch, gifts & training", nl: "Lunch, cadeaus & opleiding" }, vatNote: { en: "VAT not reclaimable (staff benefit)", nl: "Btw niet aftrekbaar (personeelsvoorziening)" }, note: { en: "Counts toward the work-related costs scheme (WKR).", nl: "Telt mee voor de werkkostenregeling (WKR)." }, keywords: "lunch groceries supermarket cake coffee gift course training team boodschappen" },
  { key: "mileage", account: "4110", icon: "CarSimple", group: "people", vatRateBp: 0, reclaim: false, label: { en: "Mileage allowance", nl: "Kilometervergoeding" }, vatNote: { en: "No VAT", nl: "Geen btw" }, note: { en: "Paid out tax-free up to the per-kilometre limit.", nl: "Onbelast uit te keren tot het maximum per kilometer." }, keywords: "km kilometres own car kilometer" },
  { key: "travel", account: "4750", icon: "Train", group: "travel", vatRateBp: 900, reclaim: true, label: { en: "Train, taxi & flights", nl: "Trein, taxi & vluchten" }, keywords: "ns train taxi uber flight klm transavia bus trein" },
  { key: "hotel", account: "4760", icon: "Bed", group: "travel", vatRateBp: 900, reclaim: true, label: { en: "Hotels & stays", nl: "Hotels & overnachtingen" }, keywords: "hotel booking stay" },
  { key: "fuel", account: "4710", icon: "GasPump", group: "travel", vatRateBp: 2100, reclaim: true, label: { en: "Fuel & charging", nl: "Brandstof & laden" }, keywords: "shell bp esso tango diesel petrol charging benzine" },
  { key: "parking", account: "4720", icon: "TrafficSign", group: "travel", vatRateBp: 2100, reclaim: true, label: { en: "Parking & tolls", nl: "Parkeren & tol" }, keywords: "q-park parking toll parkeren" },
  { key: "meals", account: "4560", icon: "ForkKnife", group: "sales", vatRateBp: 900, reclaim: false, label: { en: "Business meals & drinks", nl: "Zakelijke etentjes & borrels" }, vatNote: { en: "VAT not reclaimable on business meals", nl: "Btw niet aftrekbaar op zakelijke maaltijden" }, note: { en: "Only partly deductible for corporate tax — settled at year end.", nl: "Slechts deels aftrekbaar voor de vennootschapsbelasting — wordt bij de jaarafsluiting verwerkt." }, keywords: "lunch dinner restaurant client customer drinks diner" },
  { key: "samples", account: "4570", icon: "Wine", group: "sales", vatRateBp: 2100, reclaim: true, label: { en: "Samples & tastings", nl: "Proefmonsters & proeverijen" }, note: { en: "Bottles taken from bonded stock as samples still owe excise — book them as a stock sample so they're added to the excise return.", nl: "Flessen uit de accijnsgoederenplaats als monster zijn accijnsplichtig — boek ze als voorraadmonster zodat ze op de aangifte komen." }, keywords: "tasting sample bottles glasses proeverij" },
  { key: "fairs", account: "4600", icon: "Megaphone", group: "sales", vatRateBp: 2100, reclaim: true, label: { en: "Marketing & trade fairs", nl: "Marketing & beurzen" }, keywords: "prowein fair stand ads print flyers website beurs" },
  { key: "rent", account: "4200", icon: "Buildings", group: "premises", vatRateBp: 2100, reclaim: true, label: { en: "Rent & premises", nl: "Huur & pand" }, keywords: "office rent cleaning huur schoonmaak" },
  { key: "energy", account: "4210", icon: "Lightning", group: "premises", vatRateBp: 2100, reclaim: true, label: { en: "Energy & water", nl: "Energie & water" }, keywords: "eneco vattenfall essent electricity gas stroom" },
  { key: "insurance", account: "4800", icon: "ShieldCheck", group: "premises", vatRateBp: 0, reclaim: false, label: { en: "Insurance", nl: "Verzekeringen" }, vatNote: { en: "No VAT (insurance tax included)", nl: "Geen btw (assurantiebelasting inbegrepen)" }, keywords: "policy cargo verzekering" },
  { key: "advice", account: "4810", icon: "Briefcase", group: "premises", vatRateBp: 2100, reclaim: true, label: { en: "Accountant & legal", nl: "Accountant & juridisch" }, keywords: "lawyer notary accountant consultant advocaat notaris" },
  { key: "bankfee", account: "4820", icon: "Bank", group: "premises", vatRateBp: 0, reclaim: false, label: { en: "Bank charges", nl: "Bankkosten" }, vatNote: { en: "No VAT", nl: "Geen btw" }, keywords: "ing rabo abn fee charges kosten" },
  { key: "other", account: "4900", icon: "DotsThreeCircle", group: "premises", vatRateBp: 2100, reclaim: true, label: { en: "Something else", nl: "Iets anders" }, keywords: "" },
];

export const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c])) as Record<string, CostCategory>;

export function categoryLabel(c: CostCategory, locale: string) {
  return locale === "nl" ? c.label.nl : c.label.en;
}

/** Search on label, ledger account number/name and keywords ("lunch", "taxi", "4560"). */
export function matchesCategory(c: CostCategory, q: string, accountNames: Record<string, string>) {
  const hay = `${c.label.en} ${c.label.nl} ${c.account} ${accountNames[c.account] ?? ""} ${c.keywords}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Split a gross amount into net + VAT for a category. */
export function splitGross(grossCents: number, c: CostCategory, vatOverride?: string | null) {
  if (!c.reclaim || vatOverride || c.vatRateBp === 0) return { net: grossCents, vat: 0 };
  const net = Math.round((grossCents * 10000) / (10000 + c.vatRateBp));
  return { net, vat: grossCents - net };
}
