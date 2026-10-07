import type { AccountType, ProductCategory, WarehouseKind } from "@prisma/client";

// NL chart-of-accounts template (DOMAIN_AND_DATA.md §7). Other countries get
// their own template; until then they start from this one in English.
// TODO(tax pack): map each account to its official RGS reference code.

export interface AccountDef {
  code: string;
  nl: string;
  en: string;
  type: AccountType;
}

export const NL_CHART: AccountDef[] = [
  // Balance sheet — assets
  { code: "1000", nl: "Bank", en: "Bank current account", type: "ASSET" },
  { code: "1010", nl: "Spaarrekening", en: "Savings account", type: "ASSET" },
  { code: "1020", nl: "Bank vreemde valuta", en: "Bank foreign currency", type: "ASSET" },
  { code: "1300", nl: "Debiteuren", en: "Accounts receivable", type: "ASSET" },
  { code: "1730", nl: "Vooruitbetaalde accijns", en: "Excise paid on duty-paid stock", type: "ASSET" },
  { code: "1810", nl: "Te vorderen btw", en: "VAT to reclaim", type: "ASSET" },
  { code: "1900", nl: "Vooruitbetaald en overige vorderingen", en: "Prepaid & other receivables", type: "ASSET" },
  { code: "3000", nl: "Voorraad onder douaneverband", en: "Stock — bonded", type: "ASSET" },
  { code: "3010", nl: "Voorraad vrij verkeer", en: "Stock — duty paid", type: "ASSET" },
  { code: "3020", nl: "Goederen onderweg", en: "Goods in transit", type: "ASSET" },
  // Balance sheet — liabilities & equity
  { code: "0800", nl: "Eigen vermogen", en: "Equity", type: "EQUITY" },
  { code: "0850", nl: "Onverdeelde winst", en: "Retained earnings", type: "EQUITY" },
  { code: "1110", nl: "Creditcard zakelijk", en: "Company card", type: "LIABILITY" },
  { code: "1500", nl: "Af te dragen loonheffing", en: "Wage tax payable", type: "LIABILITY" },
  { code: "1600", nl: "Crediteuren", en: "Accounts payable", type: "LIABILITY" },
  { code: "1650", nl: "Te betalen declaraties", en: "Expense claims payable", type: "LIABILITY" },
  { code: "1700", nl: "Af te dragen btw", en: "VAT payable", type: "LIABILITY" },
  { code: "1710", nl: "Af te dragen accijns", en: "Excise payable", type: "LIABILITY" },
  { code: "1720", nl: "Ontvangen statiegeld", en: "Deposits received", type: "LIABILITY" },
  { code: "1750", nl: "Af te dragen invoerrechten", en: "Import duty payable", type: "LIABILITY" },
  // Results — costs
  { code: "4000", nl: "Lonen en salarissen", en: "Wages & salaries", type: "COST" },
  { code: "4010", nl: "Sociale lasten", en: "Employer social charges", type: "COST" },
  { code: "4020", nl: "Pensioenlasten", en: "Pension contributions", type: "COST" },
  { code: "4100", nl: "Overige personeelskosten", en: "Other staff costs", type: "COST" },
  { code: "4110", nl: "Reiskostenvergoeding", en: "Travel allowance", type: "COST" },
  { code: "4200", nl: "Huur bedrijfsruimte", en: "Rent", type: "COST" },
  { code: "4210", nl: "Gas, water en licht", en: "Energy", type: "COST" },
  { code: "4300", nl: "Vracht- en inklaringskosten", en: "Freight & customs", type: "COST" },
  { code: "4310", nl: "Invoerrechten", en: "Import duties", type: "COST" },
  { code: "4400", nl: "Opslagkosten", en: "Warehousing", type: "COST" },
  { code: "4500", nl: "Kantoorbenodigdheden", en: "Office supplies", type: "COST" },
  { code: "4520", nl: "Automatiseringskosten", en: "Software & IT", type: "COST" },
  { code: "4540", nl: "Porti- en koerierskosten", en: "Postage & couriers", type: "COST" },
  { code: "4560", nl: "Representatiekosten", en: "Entertainment", type: "COST" },
  { code: "4570", nl: "Proefmonsters en proeverijen", en: "Samples & tastings", type: "COST" },
  { code: "4600", nl: "Reclame- en beurskosten", en: "Advertising & fairs", type: "COST" },
  { code: "4610", nl: "Telefoon- en internetkosten", en: "Phone & internet", type: "COST" },
  { code: "4710", nl: "Brandstofkosten", en: "Fuel", type: "COST" },
  { code: "4720", nl: "Parkeer- en tolkosten", en: "Parking & tolls", type: "COST" },
  { code: "4750", nl: "Reiskosten", en: "Travel costs", type: "COST" },
  { code: "4760", nl: "Verblijfkosten", en: "Accommodation", type: "COST" },
  { code: "4800", nl: "Verzekeringen", en: "Insurance", type: "COST" },
  { code: "4810", nl: "Advies- en accountantskosten", en: "Professional fees", type: "COST" },
  { code: "4820", nl: "Bankkosten", en: "Bank charges", type: "COST" },
  { code: "4900", nl: "Overige algemene kosten", en: "Other costs", type: "COST" },
  { code: "4950", nl: "Koersverschillen", en: "Exchange differences", type: "COST" },
  { code: "7000", nl: "Kostprijs omzet", en: "Cost of goods sold", type: "COST" },
  { code: "7010", nl: "Voorraadverschillen", en: "Stock differences", type: "COST" },
  // Results — revenue
  { code: "8000", nl: "Omzet wijn", en: "Sales — wine", type: "REVENUE" },
  { code: "8010", nl: "Omzet bier", en: "Sales — beer", type: "REVENUE" },
  { code: "8020", nl: "Omzet gedistilleerd", en: "Sales — spirits", type: "REVENUE" },
  { code: "8030", nl: "Omzet versterkte wijn", en: "Sales — fortified", type: "REVENUE" },
  { code: "8040", nl: "Omzet water en frisdrank", en: "Sales — water & soft drinks", type: "REVENUE" },
  { code: "8090", nl: "Overige omzet", en: "Other revenue", type: "REVENUE" },
];

/** Accounts the posting engine relies on. */
export const ACC = {
  bank: "1000",
  receivables: "1300",
  card: "1110",
  wageTax: "1500",
  payables: "1600",
  claims: "1650",
  vatPayable: "1700",
  excisePayable: "1710",
  deposits: "1720",
  prepaidExcise: "1730",
  importDuty: "1750",
  vatReclaim: "1810",
  equity: "0800",
  retained: "0850",
  cogs: "7000",
  stockDiff: "7010",
  fx: "4950",
  freight: "4300",
} as const;

export const REVENUE_ACCOUNT: Record<ProductCategory, string> = {
  WINE: "8000",
  BEER: "8010",
  SPIRITS: "8020",
  FORTIFIED: "8030",
  WATER: "8040",
  SOFT: "8040",
};

export const STOCK_ACCOUNT: Record<WarehouseKind, string> = {
  BONDED: "3000",
  DUTY_PAID: "3010",
  IN_TRANSIT: "3020",
};

export function accountName(def: { nameNl: string; nameEn: string }, lang: string) {
  return lang === "nl" ? def.nameNl : def.nameEn;
}
