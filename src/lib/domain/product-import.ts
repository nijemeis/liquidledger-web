import type { ProductCategory } from "@prisma/client";
import { parseMoney } from "@/lib/format";
import { COUNTRY_CODES } from "@/lib/countries";

// Products from a spreadsheet: pasted from Excel/Numbers/Google Sheets (tabs)
// or a CSV file (semicolons or commas). The first row names the columns, in
// English or Dutch; the order doesn't matter. Pure and client-safe, so the
// preview in the browser and the import on the server use the same rules.

export type ProductField =
  | "sku"
  | "name"
  | "category"
  | "volume"
  | "abv"
  | "plato"
  | "sparkling"
  | "unitsPerCase"
  | "casesPerPallet"
  | "cost"
  | "ean"
  | "cnCode"
  | "emcsCode"
  | "producer"
  | "region"
  | "originCountry"
  | "vintage"
  | "deposit"
  | "reorderLevel";

/** Header names per field, compared without case, accents, punctuation or spaces. */
const HEADERS: Record<ProductField, string[]> = {
  sku: ["sku", "artikelcode", "artikelnummer", "artikelnr", "code", "itemcode", "article", "articlenumber", "ref", "reference", "productcode"],
  name: ["name", "naam", "productname", "productnaam", "product", "description", "omschrijving", "artikel"],
  category: ["category", "categorie", "soort", "type", "productgroup", "productgroep", "group", "groep"],
  volume: ["volume", "inhoud", "size", "content", "contents", "liters", "litres", "liter", "litre", "volumel", "volumeml", "ml", "cl", "inhoudl", "inhoudml", "inhoudcl"],
  abv: ["abv", "alcohol", "alc", "alcvol", "alcoholpercentage", "alcohol%", "alcoholvol", "abv%", "alc%", "percentage"],
  plato: ["plato", "p", "degreesplato", "gradenplato", "stamwortgehalte", "originalgravity", "gravity"],
  sparkling: ["sparkling", "mousserend", "bubbles", "schuimwijn", "spumante"],
  unitsPerCase: ["unitspercase", "bottlespercase", "percase", "case", "casesize", "doos", "perdoos", "flessenperdoos", "colli", "verpakking", "pack", "packsize"],
  casesPerPallet: ["casesperpallet", "pallet", "perpallet", "dozenperpallet", "doosperpallet"],
  cost: ["cost", "costprice", "kostprijs", "inkoopprijs", "purchaseprice", "landedcost", "inkoop"],
  ean: ["ean", "barcode", "gtin", "ean13", "eancode"],
  cnCode: ["cn", "cncode", "gncode", "hscode", "hs", "tariffcode", "goederencode", "douanecode", "taric"],
  emcsCode: ["emcs", "emcscode", "excisecode", "accijnscode", "epc", "exciseproductcode"],
  producer: ["producer", "producent", "brand", "merk", "winery", "distillery", "brewery", "brouwerij", "maker", "wijnhuis"],
  region: ["region", "regio", "streek", "appellation", "area"],
  originCountry: ["origin", "country", "land", "herkomst", "landvanherkomst", "countryoforigin", "origincountry"],
  vintage: ["vintage", "oogstjaar", "jaar", "year", "jaargang", "age", "leeftijd"],
  deposit: ["deposit", "statiegeld", "pfand"],
  reorderLevel: ["reorder", "reorderlevel", "minimum", "minstock", "minimumvoorraad", "bestelniveau", "bestelpunt"],
};

/** Price list named by a header ("Price Horeca", "Prijs groothandel", "Export", or just "Price" = Horeca). */
function priceListOf(k: string): string | null {
  if (/horeca|restaurant|hotel/.test(k)) return "Horeca";
  if (/wholesale|groothandel|grossier/.test(k)) return "Wholesale";
  if (/export/.test(k)) return "Export";
  if (/^(price|prijs|verkoopprijs|salesprice|sellingprice|listprice|adviesprijs)$/.test(k)) return "Horeca";
  return null;
}

const CATEGORY_WORDS: [RegExp, ProductCategory][] = [
  [/^(wine|wijn|vin|wein|vino|wina|wines|wijnen|red|white|rose|rood|wit|rosé|still wine)$/, "WINE"],
  [/sparkling|mousserend|champagne|cava|prosecco|cremant|crémant|schuimwijn/, "WINE"],
  [/fortified|versterkt|port|porto|sherry|madeira|marsala|vermout|vermouth|tussenproduct|intermediate|likeurwijn/, "FORTIFIED"],
  [/beer|bier|biere|bière|ale|lager|ipa|stout|cider/, "BEER"],
  [/spirit|gedistilleerd|sterke drank|liquor|liqueur|likeur|pisco|gin|rum|whisk|vodka|tequila|mezcal|brandy|cognac|armagnac|calvados|grappa|jenever|sake/, "SPIRITS"],
  [/^(water|mineral water|mineraalwater|spa)$|water/, "WATER"],
  [/soft|frisdrank|soda|juice|sap|limonade|lemonade|tonic|non.?alcoholic|alcoholvrij|alcohol.?free/, "SOFT"],
  [/wine|wijn/, "WINE"],
];

export type RowIssue =
  | { code: "missingSku" }
  | { code: "missingName" }
  | { code: "category"; value: string }
  | { code: "volume"; value: string }
  | { code: "number"; field: ProductField; value: string }
  | { code: "price"; list: string; value: string }
  | { code: "country"; value: string }
  | { code: "duplicateSku"; sku: string };

export interface ImportedProduct {
  sku: string;
  name?: string;
  category?: ProductCategory;
  volumeMl?: number;
  abvBp?: number;
  platoTenths?: number | null;
  sparkling?: boolean;
  unitsPerCase?: number;
  casesPerPallet?: number | null;
  costCents?: number;
  ean?: string | null;
  cnCode?: string | null;
  emcsCode?: string | null;
  producer?: string | null;
  region?: string | null;
  originCountry?: string | null;
  vintage?: string | null;
  depositCents?: number;
  reorderLevel?: number | null;
  prices: Record<string, number>;
}

export interface SheetRow {
  line: number; // 1-based line in the sheet (header = 1)
  product: ImportedProduct;
  issues: RowIssue[];
}

export interface ParsedSheet {
  rows: SheetRow[];
  /** Fields found in the header, and the price lists. */
  columns: { fields: ProductField[]; priceLists: string[] };
  /** Header cells that matched nothing (shown so the user can rename them). */
  ignored: string[];
  /** Required columns that are missing (sku and name; category for new products is checked per row). */
  missing: ProductField[];
}

const key = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9%]/g, "");

/** Split a line on the separator, honouring "quoted, cells" with "" escapes. */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === sep && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectSeparator(header: string): string {
  const count = (c: string) => header.split(c).length - 1;
  if (count("\t")) return "\t";
  return count(";") >= count(",") ? ";" : ",";
}

/** "13,5%", "13.5", "0,75" → number; "" → null; NaN when unreadable. */
function decimal(raw: string): number | null {
  let s = raw.replace(/[%°\s€]|vol\.?|abv|alc\.?|plato|°p/gi, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else s = s.replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

const yes = (raw: string) => /^(y|yes|ja|j|true|1|x|✓|sparkling|mousserend)$/i.test(raw.trim());

/** Category from free text; null when nothing fits. */
export function categoryOf(raw: string): ProductCategory | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const direct = ["WINE", "BEER", "SPIRITS", "FORTIFIED", "WATER", "SOFT"].find((c) => c.toLowerCase() === s);
  if (direct) return direct as ProductCategory;
  return CATEGORY_WORDS.find(([re]) => re.test(s))?.[1] ?? null;
}

let countryNames: Map<string, string> | null = null;
/** "PE", "Peru", "Perú" → "PE"; null when unknown. */
export function countryOf(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  if (!countryNames) {
    countryNames = new Map();
    for (const loc of ["en", "nl", "fr", "de", "es", "it"]) {
      try {
        const dn = new Intl.DisplayNames([loc], { type: "region" });
        for (const c of COUNTRY_CODES) {
          const n = dn.of(c);
          if (n) countryNames.set(key(n), c);
        }
      } catch {
        // Intl without region names: only codes work.
      }
    }
  }
  return countryNames.get(key(s)) ?? null;
}

/** Volume to ml: "0,75" and "0.75 L" are litres, "750" and "750 ml" are ml, "75 cl" centilitres. */
function volumeMl(raw: string, header: string): number | null {
  const unit = /ml\b|ml$/i.test(raw) || /ml$/.test(header) ? "ml" : /cl\b|cl$/i.test(raw) || /cl$/.test(header) ? "cl" : null;
  const n = decimal(raw.replace(/(ml|cl|ltr|lt|l)\.?$/i, ""));
  if (n === null || Number.isNaN(n) || n <= 0) return n === null ? null : NaN;
  if (unit === "ml") return Math.round(n);
  if (unit === "cl") return Math.round(n * 10);
  return n > 20 ? Math.round(n) : Math.round(n * 1000); // 0.75 → litres, 750 → ml
}

export function parseProductSheet(text: string): ParsedSheet {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const firstIdx = lines.findIndex((l) => l.trim());
  if (firstIdx < 0) return { rows: [], columns: { fields: [], priceLists: [] }, ignored: [], missing: ["sku", "name"] };
  const sep = detectSeparator(lines[firstIdx]!);
  const header = splitLine(lines[firstIdx]!, sep);

  const fieldAt = new Map<number, ProductField>();
  const listAt = new Map<number, string>();
  const ignored: string[] = [];
  header.forEach((h, i) => {
    const k = key(h);
    if (!k) return;
    const field = (Object.keys(HEADERS) as ProductField[]).find((f) => HEADERS[f].includes(k) && ![...fieldAt.values()].includes(f));
    if (field) return void fieldAt.set(i, field);
    const list = priceListOf(k);
    if (list && ![...listAt.values()].includes(list)) return void listAt.set(i, list);
    ignored.push(h);
  });
  const fields = [...fieldAt.values()];
  const missing = (["sku", "name"] as ProductField[]).filter((f) => !fields.includes(f));

  const rows: SheetRow[] = [];
  const seen = new Set<string>();
  for (let li = firstIdx + 1; li < lines.length; li++) {
    const line = lines[li]!;
    if (!line.trim()) continue;
    const cells = splitLine(line, sep);
    if (cells.every((c) => !c)) continue;
    const issues: RowIssue[] = [];
    const product: ImportedProduct = { sku: "", prices: {} };
    for (const [i, field] of fieldAt) {
      const raw = (cells[i] ?? "").trim();
      if (!raw) continue;
      const head = key(header[i] ?? "");
      const int = (min: number, max: number) => {
        const n = decimal(raw);
        if (n === null) return null;
        if (Number.isNaN(n) || n < min || n > max) {
          issues.push({ code: "number", field, value: raw });
          return undefined;
        }
        return Math.round(n);
      };
      switch (field) {
        case "sku":
          product.sku = raw.toUpperCase().slice(0, 40);
          break;
        case "name":
          product.name = raw.slice(0, 200);
          break;
        case "category": {
          const c = categoryOf(raw);
          if (c) product.category = c;
          else issues.push({ code: "category", value: raw });
          if (/sparkling|mousserend|champagne|cava|prosecco|cremant|crémant/i.test(raw)) product.sparkling = true;
          break;
        }
        case "volume": {
          const ml = volumeMl(raw, head);
          if (ml === null) break;
          if (Number.isNaN(ml) || ml <= 0 || ml > 1_000_000) issues.push({ code: "volume", value: raw });
          else product.volumeMl = ml;
          break;
        }
        case "abv": {
          const n = decimal(raw);
          if (n === null) break;
          if (Number.isNaN(n) || n < 0 || n > 100) issues.push({ code: "number", field, value: raw });
          else product.abvBp = Math.round(n * 100);
          break;
        }
        case "plato": {
          const n = decimal(raw);
          if (n === null) break;
          if (Number.isNaN(n) || n < 0 || n > 100) issues.push({ code: "number", field, value: raw });
          else product.platoTenths = Math.round(n * 10);
          break;
        }
        case "sparkling":
          product.sparkling = yes(raw);
          break;
        case "unitsPerCase": {
          const n = int(1, 10_000);
          if (n !== undefined && n !== null) product.unitsPerCase = n;
          break;
        }
        case "casesPerPallet": {
          const n = int(1, 100_000);
          if (n !== undefined) product.casesPerPallet = n;
          break;
        }
        case "reorderLevel": {
          const n = int(0, 10_000_000);
          if (n !== undefined) product.reorderLevel = n;
          break;
        }
        case "cost":
        case "deposit": {
          const c = parseMoney(raw);
          if (c === null || c < 0) issues.push({ code: "number", field, value: raw });
          else if (field === "cost") product.costCents = c;
          else product.depositCents = c;
          break;
        }
        case "originCountry": {
          const c = countryOf(raw);
          if (c) product.originCountry = c;
          else issues.push({ code: "country", value: raw });
          break;
        }
        case "ean":
          product.ean = raw.replace(/\s/g, "").slice(0, 20);
          break;
        case "cnCode":
          product.cnCode = raw.slice(0, 20);
          break;
        case "emcsCode":
          product.emcsCode = raw.slice(0, 40);
          break;
        case "producer":
          product.producer = raw.slice(0, 120);
          break;
        case "region":
          product.region = raw.slice(0, 120);
          break;
        case "vintage":
          product.vintage = raw.slice(0, 40);
          break;
      }
    }
    for (const [i, list] of listAt) {
      const raw = (cells[i] ?? "").trim();
      if (!raw) continue;
      const c = parseMoney(raw);
      if (c === null || c < 0) issues.push({ code: "price", list, value: raw });
      else product.prices[list] = c;
    }
    if (!product.sku) issues.push({ code: "missingSku" });
    else if (seen.has(product.sku)) issues.push({ code: "duplicateSku", sku: product.sku });
    else seen.add(product.sku);
    if (product.category !== "BEER") delete product.platoTenths;
    if (product.category && product.category !== "WINE" && product.category !== "FORTIFIED") delete product.sparkling;
    rows.push({ line: li + 1, product, issues });
  }
  return { rows, columns: { fields, priceLists: [...listAt.values()] }, ignored, missing };
}

/** What a new product needs beyond what an update needs. */
export function newProductIssues(p: ImportedProduct): RowIssue[] {
  const out: RowIssue[] = [];
  if (!p.name) out.push({ code: "missingName" });
  if (!p.category) out.push({ code: "category", value: "" });
  if (!p.volumeMl) out.push({ code: "volume", value: "" });
  return out;
}

/** A template to fill in (semicolon-separated, opens in Excel with Dutch settings). */
export const TEMPLATE_CSV =
  "SKU;Name;Category;Volume (L);ABV %;Plato;Sparkling;Units per case;Cost price;Price Horeca;Price Wholesale;Price Export;EAN;CN code;EMCS code;Producer;Region;Origin;Vintage;Deposit\n" +
  "WN-1021;Altamira Rioja Crianza 2021;Wine;0,75;13,5;;;6;6,35;9,80;8,40;7,90;8412345678905;2204 21;W200;Bodegas Altamira;Rioja;ES;2021;\n" +
  "SP-3012;Pisco Quebranta;Spirits;0,7;40;;;6;14,20;24,50;21,00;19,50;;2208 90;S200;Destilería Ica;Ica;PE;;\n" +
  "BR-2003;De Kroon Tripel;Beer;0,33;8,5;18,5;;24;0,95;1,85;1,55;1,40;5411081200039;2203 00;B000;Brouwerij De Kroon;Flanders;BE;;0,10\n";
