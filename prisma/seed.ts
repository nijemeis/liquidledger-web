/* eslint-disable no-console */
// Demo data: the "Vale & Hart Drinks B.V." administration from the design,
// with nine months of history booked through the real posting engine, plus
// the platform-admin clients, users and staff.
//
//   npm run db:seed            (refuses to run in production unless SEED_DEMO=1)
//
// Prints demo credentials at the end. Everything is relative to today, so the
// dashboard always looks current.

import { PrismaClient, type ProductCategory, type Role, type TaxRegime } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { hash as argonHash } from "@node-rs/argon2";
import { authenticator } from "otplib";
import { createCipheriv } from "node:crypto";
import { createClientWithAdministration, addMembership } from "../src/lib/domain/setup";
import { post } from "../src/lib/domain/ledger";
import { saveDraft, sendInvoice, registerSalesPayment } from "../src/lib/domain/sales";
import { bookPurchase, calcPurchase } from "../src/lib/domain/purchases";
import { transferStock } from "../src/lib/domain/stock";
import { bookReceipt, receiptLines } from "../src/lib/domain/receipts";
import { reconcile, importHash } from "../src/lib/domain/bank";
import { ACC } from "../src/lib/domain/chart";

if (process.env.NODE_ENV === "production" && process.env.SEED_DEMO !== "1") {
  console.error("Refusing to seed demo data in production. Set SEED_DEMO=1 to override.");
  process.exit(1);
}

const prisma = new PrismaClient();
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const now = new Date();
const TODAY = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const day = (offset: number) => new Date(TODAY.getTime() + offset * 86400_000);
const monthStart = (back: number, dayOfMonth = 1) => new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() - back, dayOfMonth));
const eur = (v: number) => Math.round(v * 100);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const DEMO_PASSWORD = "wijnkelder-2026";
const DEMO_TOTP = authenticator.generateSecret(20);

function seal(secret: string) {
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be set (32 bytes base64) before seeding");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

async function tenant<T>(adminId: string, fn: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.administration_id', ${adminId}, true)`;
    return fn(tx);
  }, { timeout: 600_000, maxWait: 20_000 });
}

async function system<T>(fn: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    return fn(tx);
  }, { timeout: 600_000, maxWait: 20_000 });
}

// ── Catalogue (from the prototype) ──────────────────────────────────────────

const PRODUCTS = {
  rioja: { sku: "WN-1021", name: "Altamira Rioja Crianza 2021", cat: "WINE", ml: 750, abv: 13.5, caseOf: 6, cost: 5.7, price: 9.8, reorder: 1000, producer: "Bodegas Altamira", region: "Rioja", origin: "ES", vintage: "2021", ean: "8410023100217", cn: "2204 21", emcs: "W200", pallet: 100, lists: [9.8, 8.4, 7.6], deposit: 0 },
  rhone: { sku: "WN-1044", name: "Domaine Sauvage Côtes du Rhône 2022", cat: "WINE", ml: 750, abv: 14, caseOf: 6, cost: 6.2, price: 10.5, producer: "Domaine Sauvage", region: "Rhône", origin: "FR", vintage: "2022", ean: "3760154220446", cn: "2204 21", emcs: "W200", pallet: 100, lists: [10.5, 9.1, 8.3], deposit: 0 },
  tripel: { sku: "BR-2003", name: "De Kroon Tripel", cat: "BEER", ml: 330, abv: 8.5, caseOf: 24, cost: 0.95, price: 1.85, producer: "Brouwerij De Kroon", region: "Flanders", origin: "BE", plato: 185, ean: "5411081200039", cn: "2203 00", emcs: "B000", pallet: 70, lists: [1.85, 1.55, 1.4], deposit: 0.1 },
  helles: { sku: "BR-2011", name: "Hopfenhaus Helles", cat: "BEER", ml: 500, abv: 4.9, caseOf: 20, cost: 0.78, price: 1.45, producer: "Hopfenhaus", region: "Bavaria", origin: "DE", plato: 118, ean: "4006781201100", cn: "2203 00", emcs: "B000", pallet: 60, lists: [1.45, 1.2, 1.1], deposit: 0.1 },
  glen: { sku: "SP-3012", name: "Glen Arrow 12 Single Malt", cat: "SPIRITS", ml: 700, abv: 40, caseOf: 6, cost: 19.4, price: 34, producer: "Glen Arrow Distillers", region: "Speyside", origin: "GB", vintage: "12 years", ean: "5010327301207", cn: "2208 30", emcs: "S200", pallet: 80, lists: [34, 29.5, 26], deposit: 0 },
  mezcal: { sku: "SP-3030", name: "Casa Lume Mezcal Espadín", cat: "SPIRITS", ml: 700, abv: 42, caseOf: 6, cost: 15.8, price: 29.5, reorder: 600, producer: "Distilería Casa Lume", region: "Oaxaca", origin: "MX", ean: "7503027310306", cn: "2208 90", emcs: "S200", pallet: 80, lists: [29.5, 25, 22.5], deposit: 0 },
  port: { sku: "FW-4002", name: "Vinha Velha Tawny 10 Years", cat: "FORTIFIED", ml: 750, abv: 20, caseOf: 6, cost: 8.9, price: 16, producer: "Vinha Velha", region: "Douro", origin: "PT", vintage: "10 years", ean: "5601012400023", cn: "2204 21", emcs: "I000", pallet: 100, lists: [16, 13.8, 12.5], deposit: 0 },
  water: { sku: "NA-5001", name: "Fonte Chiara Sparkling Water", cat: "WATER", ml: 500, abv: 0, caseOf: 24, cost: 0.38, price: 0.95, producer: "Fonte Chiara", region: "Piemonte", origin: "IT", ean: "8002270500011", cn: "2201 10", emcs: null, pallet: 84, lists: [0.95, 0.72, 0.65], deposit: 0.15 },
  soda: { sku: "NA-5010", name: "Lumo Ginger Soda (can)", cat: "SOFT", ml: 330, abv: 0, caseOf: 24, cost: 0.41, price: 1.1, reorder: 3000, producer: "Lumo Drinks", region: "Utrecht", origin: "NL", ean: "8719325400330", cn: "2202 10", emcs: null, pallet: 120, lists: [1.1, 0.85, 0.78], deposit: 0.15 },
} as const;
type PKey = keyof typeof PRODUCTS;

// Target stock today (prototype "Stock & warehouses").
const TARGET: Record<"rtm" | "ams", Partial<Record<PKey, number>>> = {
  rtm: { rioja: 840, rhone: 2400, tripel: 6000, helles: 9600, glen: 1440, mezcal: 360, port: 1200 },
  ams: { rioja: 420, rhone: 300, tripel: 1440, helles: 2000, glen: 180, mezcal: 96, port: 240, water: 4800, soda: 2160 },
};

// Monthly releases for consumption (bonded → duty paid); last month = prototype's September return.
const RELEASES: Partial<Record<PKey, number>> = { helles: 4800, tripel: 2400, rioja: 3600, rhone: 1800, port: 600, glen: 960, mezcal: 720 };
// Monthly duty-suspended sales straight from bond (EU B2B / export).
const SUSPENDED: { cust: string; lines: Partial<Record<PKey, number>> }[] = [
  { cust: "Nordvin AB", lines: { rhone: 600, tripel: 1200, rioja: 600 } },
  { cust: "Wijnkoperij Dumont", lines: { port: 120, rioja: 300 } },
  { cust: "Lagos Fine Spirits", lines: { glen: 300, mezcal: 240 } },
];
const NA_MONTHLY: Partial<Record<PKey, number>> = { water: 1200, soda: 1440 };

const SUPPLIER_FOR: Record<PKey, string> = {
  rioja: "Bodegas Altamira",
  rhone: "Domaine Sauvage SARL",
  tripel: "Brouwerij De Kroon",
  helles: "Hopfenhaus GmbH",
  glen: "Glen Arrow Distillers",
  mezcal: "Distilería Casa Lume",
  port: "Vinha Velha Lda",
  water: "Fonte Chiara S.p.A.",
  soda: "Lumo Drinks B.V.",
};

const RELATIONS = {
  customers: [
    ["Café Rosa", "Bar & restaurant", "NL", "Amsterdam", "NL001234567B01", "Duty-paid deliveries", 14],
    ["Hotel Meridiaan", "Hotel", "NL", "Utrecht", "NL815522903B01", "Duty-paid deliveries", 14],
    ["Bar Kade 12", "Bar", "NL", "Rotterdam", "NL003349812B01", "Duty-paid deliveries", 14],
    ["Nordvin AB", "Wholesaler", "SE", "Stockholm", "SE556677889901", "Authorised consignee · SE0000ZK3341", 30],
    ["Wijnkoperij Dumont", "Wine shop", "BE", "Antwerp", "BE0478221093", "Registered consignee · BE0E00093120", 14],
    ["Lagos Fine Spirits", "Importer", "NG", "Lagos", null, "Export · outside EU", 30],
  ],
  suppliers: [
    ["Bodegas Altamira", "Winery", "ES", "Logroño", "ESB26043318", "Consignor · ES00026W00117", 30],
    ["Domaine Sauvage SARL", "Winery", "FR", "Orange", "FR40841220077", "Consignor · FR0A2201E0004", 30],
    ["Distilería Casa Lume", "Distillery", "MX", "Oaxaca", null, "Import · outside EU", 30],
    ["Glen Arrow Distillers", "Distillery", "GB", "Glasgow", "GB284112093", "Import · outside EU", 30],
    ["Brouwerij De Kroon", "Brewery", "BE", "Mechelen", "BE0412339081", "Consignor · BE0E00021884", 30],
    ["Hopfenhaus GmbH", "Brewery", "DE", "Munich", "DE811907788", "Consignor · DE00749300011", 30],
    ["Vinha Velha Lda", "Winery", "PT", "Porto", "PT506712334", "Consignor · PT00011A2201", 30],
    ["Fonte Chiara S.p.A.", "Mineral water", "IT", "Turin", "IT03918250046", "—", 30],
    ["Lumo Drinks B.V.", "Soft drinks", "NL", "Utrecht", "NL004412871B01", "—", 14],
    ["Rhenus Warehousing B.V.", "Bonded warehouse", "NL", "Rotterdam", "NL009812233B01", "—", 14],
    ["Maersk Line", "Shipping line", "DK", "Copenhagen", "DK53139655", "—", 30],
  ],
} as const;

// ── Platform: clients, users, staff ─────────────────────────────────────────

const OTHER_CLIENTS = [
  { name: "Weinhandel Krüger GmbH", cc: "DE", vat: "DE298441207", plan: "PRO", status: "ACTIVE", mods: ["excise", "customs", "fx"], last: 0 },
  { name: "Maison Duret SAS", cc: "FR", vat: "FR40841220077", plan: "PRO", status: "ACTIVE", mods: ["excise", "customs", "emcs"], last: 1 },
  { name: "Brouwerij De Kroon NV", cc: "BE", vat: "BE0412339081", plan: "BUSINESS", status: "ACTIVE", mods: ["excise"], last: 0 },
  { name: "Bodegas Altamira S.L.", cc: "ES", vat: "ESB26043318", plan: "BUSINESS", status: "ACTIVE", mods: ["excise", "fx"], last: 3 },
  { name: "Hurtownia Napojów Wisła Sp. z o.o.", cc: "PL", vat: "PL5272849103", plan: "BUSINESS", status: "PAST_DUE", mods: ["excise"], last: 6 },
  { name: "Fonte Chiara S.p.A.", cc: "IT", vat: "IT03918250046", plan: "BUSINESS", status: "SUSPENDED", mods: [], last: 21 },
  { name: "Cantina Rossi S.r.l.", cc: "IT", vat: "IT02184410219", plan: "STARTER", status: "TRIAL", mods: [], last: 0, trialLeft: 12 },
  { name: "Lumo Drinks B.V.", cc: "NL", vat: "NL004412871B01", plan: "BUSINESS", status: "TRIAL", mods: ["fx"], last: 1, trialLeft: 4 },
] as const;

const OTHER_USERS: { name: string; email: string; client: string; role: Role; mfa: "app" | "sms" | "none"; status: "ACTIVE" | "INVITED" | "LOCKED"; locale: string }[] = [
  { name: "Thomas Krüger", email: "t.krueger@weinhandel-krueger.de", client: "Weinhandel Krüger GmbH", role: "OWNER", mfa: "app", status: "ACTIVE", locale: "de" },
  { name: "Sabine Hoff", email: "s.hoff@weinhandel-krueger.de", client: "Weinhandel Krüger GmbH", role: "BOOKKEEPER", mfa: "sms", status: "LOCKED", locale: "de" },
  { name: "Camille Duret", email: "camille@maisonduret.fr", client: "Maison Duret SAS", role: "OWNER", mfa: "app", status: "ACTIVE", locale: "fr" },
  { name: "Pieter Claes", email: "pieter@dekroon.be", client: "Brouwerij De Kroon NV", role: "ADMIN", mfa: "app", status: "ACTIVE", locale: "nl" },
  { name: "Lucía Ortega", email: "lucia@bodegasaltamira.es", client: "Bodegas Altamira S.L.", role: "OWNER", mfa: "app", status: "ACTIVE", locale: "es" },
  { name: "Marek Nowak", email: "marek@hurtowniawisla.pl", client: "Hurtownia Napojów Wisła Sp. z o.o.", role: "OWNER", mfa: "sms", status: "ACTIVE", locale: "pl" },
  { name: "Giulia Rossi", email: "giulia@cantinarossi.it", client: "Cantina Rossi S.r.l.", role: "OWNER", mfa: "app", status: "ACTIVE", locale: "it" },
  { name: "Daan Vos", email: "daan@lumodrinks.nl", client: "Lumo Drinks B.V.", role: "OWNER", mfa: "app", status: "ACTIVE", locale: "nl" },
];

async function reset() {
  await system(async (tx) => {
    const tables = await tx.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  });
}

async function main() {
  console.log("Resetting database…");
  await reset();
  const pw = await argonHash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 });
  const sealedTotp = seal(DEMO_TOTP);

  // Platform settings & excise rates (illustrative NL rates — maintain via the admin console).
  await prisma.platformSetting.create({ data: { key: "security", value: { trust30: true, newDevice: true, ipAllow: false, ipAllowList: [], sso: true } } });
  const rateFrom = new Date(Date.UTC(TODAY.getUTCFullYear(), 0, 1));
  const rates: [ProductCategory, "HL_PER_ABV" | "HL_PRODUCT" | "HL_PURE_ALCOHOL" | "NONE", number][] = [
    ["BEER", "HL_PER_ABV", 910],
    ["WINE", "HL_PRODUCT", 9800],
    ["FORTIFIED", "HL_PRODUCT", 18200],
    ["SPIRITS", "HL_PURE_ALCOHOL", 199100],
    ["WATER", "NONE", 0],
    ["SOFT", "NONE", 0],
  ];
  await prisma.exciseRate.createMany({
    data: rates.map(([category, basis, rateCents]) => ({ country: "NL", category, basis, rateCents, validFrom: rateFrom, note: "Illustrative sample rate — verify against the official Douane table", createdBy: "seed" })),
  });

  // Staff (passkey set-up links printed below).
  const staff = await Promise.all(
    [
      ["Ruben Janssen", "ruben@liquidledger.net", "SUPER_ADMIN"],
      ["Noor El Amrani", "noor@liquidledger.net", "SUPPORT"],
      ["Sem de Groot", "sem@liquidledger.net", "FINANCE"],
    ].map(([name, email, role]) => prisma.staffUser.create({ data: { name: name!, email: email!, role: role as "SUPER_ADMIN", passwordHash: pw, status: "ACTIVE" } })),
  );
  const staffLinks: string[] = [];
  for (const s of staff) {
    const token = randomBytes(32).toString("base64url");
    await prisma.emailToken.create({ data: { staffId: s.id, purpose: "STAFF_SETUP", tokenHash: sha(token), expiresAt: day(7) } });
    staffLinks.push(`${s.email}: ${(process.env.ADMIN_URL ?? "http://localhost:3000/admin").replace(/\/$/, "")}/setup?token=${token}`);
  }

  // ── Vale & Hart ────────────────────────────────────────────────────────────
  console.log("Creating Vale & Hart Drinks B.V.…");
  const { client: vh, administration: adm } = await system((tx) =>
    createClientWithAdministration(tx, { name: "Vale & Hart Drinks B.V.", country: "NL", vatNumber: "NL862204117B01", plan: "PRO", trial: false, modules: ["excise", "customs", "fx", "emcs"] }),
  );
  await prisma.client.update({ where: { id: vh.id }, data: { createdAt: new Date(Date.UTC(TODAY.getUTCFullYear() - 1, 2, 4)), lastActiveAt: new Date() } });
  await prisma.administration.update({
    where: { id: adm.id },
    data: {
      exciseLicenceNo: "NL00000123AGP",
      exciseAuthority: "Douane (NL)",
      cocNumber: "81234567",
      addressLine: "Waalhaven O.z. 81",
      postcode: "3087 BM",
      city: "Rotterdam",
      email: "finance@valehart.nl",
      iban: "NL91 INGB 0006 6544 71",
      vatPeriod: "QUARTERLY",
    },
  });
  const A = adm.id;

  const users = await Promise.all(
    [
      ["Marta Visser", "marta@valehart.nl", "OWNER", "en"],
      ["Joost de Wit", "joost@valehart.nl", "WAREHOUSE", "nl"],
      ["Eva Bakker", "eva@bakker-accountants.nl", "ACCOUNTANT", "nl"],
    ].map(([name, email, , locale]) =>
      prisma.user.create({
        data: { name: name!, email: email!, locale: locale!, passwordHash: pw, status: "ACTIVE", totpSecretEnc: sealedTotp, totpEnabledAt: new Date(), lastAdministrationId: A, lastSignInAt: day(-1) },
      }),
    ),
  );
  const lars = await prisma.user.create({ data: { name: "Lars Kim", email: "lars@valehart.nl", status: "INVITED", locale: "nl" } });
  const marta = users[0]!;
  await system(async (tx) => {
    await addMembership(tx, users[0]!.id, A, "OWNER");
    await addMembership(tx, users[1]!.id, A, "WAREHOUSE");
    await addMembership(tx, users[2]!.id, A, "ACCOUNTANT");
    await addMembership(tx, lars.id, A, "BOOKKEEPER");
  });
  const inviteToken = randomBytes(32).toString("base64url");
  await prisma.emailToken.create({ data: { userId: lars.id, purpose: "INVITE", tokenHash: sha(inviteToken), expiresAt: day(7), data: { inviter: "Marta Visser" } } });

  // Master data.
  const ids = await tenant(A, async (tx) => {
    const wh = {
      rtm: await tx.warehouse.create({ data: { administrationId: A, name: "Rotterdam", kind: "BONDED", city: "Rotterdam", exciseWarehouseNo: "NL00000123BGP" } }),
      ams: await tx.warehouse.findFirstOrThrow({ where: { administrationId: A } }),
      transit: await tx.warehouse.create({ data: { administrationId: A, name: "In transit", kind: "IN_TRANSIT" } }),
    };
    await tx.warehouse.update({ where: { id: wh.ams.id }, data: { name: "Amsterdam", city: "Amsterdam" } });
    const bank = {
      ing: await tx.bankAccount.findFirstOrThrow({ where: { administrationId: A } }),
      sav: await tx.bankAccount.create({ data: { administrationId: A, name: "ING Savings", iban: "NL20 INGB 0001 2399 02", accountCode: "1010", openingBalanceCents: eur(40000), provider: "camt" } }),
      wise: await tx.bankAccount.create({ data: { administrationId: A, name: "Wise USD", iban: "BE71 9670 2551 0318", currency: "USD", accountCode: "1020", openingBalanceCents: eur(12480.2), provider: "manual" } }),
    };
    await tx.bankAccount.update({ where: { id: bank.ing.id }, data: { name: "ING Current", iban: "NL91 INGB 0006 6544 71", openingBalanceCents: eur(60000), provider: "camt", lastSyncedAt: new Date(TODAY.getTime() + 7 * 3600_000 + 12 * 60_000) } });

    const products = {} as Record<PKey, string>;
    for (const [k, p] of Object.entries(PRODUCTS) as [PKey, (typeof PRODUCTS)[PKey]][]) {
      const prod = await tx.product.create({
        data: {
          administrationId: A,
          sku: p.sku,
          name: p.name,
          producer: p.producer,
          region: p.region,
          originCountry: p.origin,
          category: p.cat,
          volumeMl: p.ml,
          abvBp: Math.round(p.abv * 100),
          platoTenths: "plato" in p ? p.plato : null,
          vintage: "vintage" in p ? p.vintage : null,
          unitsPerCase: p.caseOf,
          casesPerPallet: p.pallet,
          ean: p.ean,
          cnCode: p.cn,
          emcsCode: p.emcs,
          depositCents: eur(p.deposit),
          reorderLevel: "reorder" in p ? p.reorder : null,
          costCents: eur(p.cost),
          prices: {
            create: (["Horeca", "Wholesale", "Export"] as const).map((list, i) => ({ administrationId: A, list, unitPriceCents: eur(p.lists[i]!) })),
          },
        },
      });
      products[k] = prod.id;
    }
    const rel = {} as Record<string, string>;
    for (const [kind, rows] of [["CUSTOMER", RELATIONS.customers], ["SUPPLIER", RELATIONS.suppliers]] as const) {
      for (const [name, type, country, city, vat, excise, terms] of rows) {
        const r = await tx.relation.create({
          data: {
            administrationId: A,
            kind,
            name,
            typeLabel: type,
            country,
            city,
            vatNumber: vat,
            viesValid: vat && country !== "GB" ? true : null,
            viesCheckedAt: vat && country !== "GB" ? day(-20) : null,
            exciseStatus: excise === "—" ? null : excise,
            paymentTermsDays: terms,
            defaultPriceList: kind === "CUSTOMER" ? (country === "NL" ? "Horeca" : country === "NG" ? "Export" : "Wholesale") : null,
          },
        });
        rel[name] = r.id;
      }
    }
    await tx.bookingRule.createMany({
      data: [
        { administrationId: A, matchType: "supplier", pattern: "Shell", accountCode: "4710", vatRateBp: 2100, timesUsed: 4, createdById: marta.id },
        { administrationId: A, matchType: "supplier", pattern: "KPN", accountCode: "4610", vatRateBp: 2100, timesUsed: 9, createdById: marta.id },
        { administrationId: A, matchType: "supplier", pattern: "Staples", categoryKey: "office", accountCode: "4500", timesUsed: 6, createdById: marta.id },
      ],
    });
    return { wh, bank, products, rel };
  });
  const { wh, bank, products: P, rel: R } = ids;

  // Opening balances on 1 January.
  console.log("Opening balances…");
  const jan1 = new Date(Date.UTC(TODAY.getUTCFullYear(), 0, 1));
  await tenant(A, async (tx) => {
    const lines: { account: string; debit?: number; credit?: number }[] = [
      { account: "1000", debit: eur(60000) },
      { account: "1010", debit: eur(40000) },
      { account: "1020", debit: eur(11402.18) },
    ];
    let stockRtm = 0;
    let stockAms = 0;
    let prepaid = 0;
    for (const [whKey, targets] of Object.entries(TARGET) as ["rtm" | "ams", Partial<Record<PKey, number>>][]) {
      for (const [k, qty] of Object.entries(targets) as [PKey, number][]) {
        const p = PRODUCTS[k];
        await tx.stockMovement.create({
          data: { administrationId: A, productId: P[k], toWarehouseId: wh[whKey].id, qty, reason: "OPENING", unitCostCents: eur(p.cost), at: jan1, note: "Opening stock" },
        });
        if (whKey === "rtm") stockRtm += qty * eur(p.cost);
        else {
          stockAms += qty * eur(p.cost);
          // Excise already paid on duty-paid opening stock.
          const rate = rates.find((r) => r[0] === p.cat)!;
          const hl = p.ml / 100_000;
          const per = rate[1] === "HL_PER_ABV" ? hl * p.abv * rate[2] : rate[1] === "HL_PURE_ALCOHOL" ? hl * (p.abv / 100) * rate[2] : rate[1] === "HL_PRODUCT" ? hl * rate[2] : 0;
          prepaid += Math.round(per * qty);
        }
      }
    }
    lines.push({ account: "3000", debit: stockRtm }, { account: "3010", debit: stockAms }, { account: ACC.prepaidExcise, debit: prepaid });
    const total = lines.reduce((a, l) => a + (l.debit ?? 0), 0);
    lines.push({ account: "0800", credit: total });
    await post(tx, { administrationId: A, date: jan1, title: "Opening balance", source: "OPENING", lines });
  });

  // Bank statement helper: create a line and reconcile it.
  let txSeq = 0;
  const bankLine = async (tx: Tx, date: Date, counterparty: string, description: string, amountCents: number, iban?: string) => {
    txSeq++;
    return tx.bankTransaction.create({
      data: {
        administrationId: A,
        bankAccountId: bank.ing.id,
        date,
        counterparty,
        counterpartyIban: iban ?? null,
        description,
        amountCents,
        importHash: importHash({ date, amountCents, counterparty, description, ref: String(txSeq) }),
      },
    });
  };

  // ── History: one transaction per month ────────────────────────────────────
  const monthsBack = TODAY.getUTCMonth(); // January … last month
  for (let back = monthsBack; back >= 1; back--) {
    const mStart = monthStart(back);
    const label = mStart.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
    console.log(`  ${label}…`);
    const factor = back === 1 ? 1 : 0.82 + ((back * 37) % 30) / 100; // last month = exact prototype releases
    await tenant(A, async (tx) => {
      const at = (d: number) => monthStart(back, d);
      const qty = (n: number, caseOf: number) => Math.max(caseOf, Math.round((n * factor) / caseOf) * caseOf);

      // 1. Purchases into bond (cover releases + suspended sales), water & soda straight to Amsterdam.
      const need: Partial<Record<PKey, number>> = {};
      const releases: Partial<Record<PKey, number>> = {};
      for (const [k, n] of Object.entries(RELEASES) as [PKey, number][]) {
        releases[k] = back === 1 ? n : qty(n, PRODUCTS[k].caseOf);
        need[k] = (need[k] ?? 0) + releases[k]!;
      }
      const suspendedSales = SUSPENDED.map((s) => ({
        cust: s.cust,
        lines: Object.fromEntries(Object.entries(s.lines).map(([k, n]) => [k, qty(n!, PRODUCTS[k as PKey].caseOf)])) as Partial<Record<PKey, number>>,
      }));
      for (const s of suspendedSales) for (const [k, n] of Object.entries(s.lines) as [PKey, number][]) need[k] = (need[k] ?? 0) + n;
      const naSales: Partial<Record<PKey, number>> = Object.fromEntries(Object.entries(NA_MONTHLY).map(([k, n]) => [k, qty(n!, PRODUCTS[k as PKey].caseOf)]));

      const bySupplier = new Map<string, { k: PKey; n: number }[]>();
      for (const [k, n] of [...(Object.entries(need) as [PKey, number][]), ...(Object.entries(naSales) as [PKey, number][])]) {
        const s = SUPPLIER_FOR[k];
        bySupplier.set(s, [...(bySupplier.get(s) ?? []), { k, n }]);
      }
      let pNo = 0;
      for (const [supplier, items] of bySupplier) {
        const sup = RELATIONS.suppliers.find((s) => s[0] === supplier)!;
        const country = sup[2];
        const treatment = country === "NL" ? "DOMESTIC" : ["GB", "MX"].includes(country) ? "IMPORT" : "EU_ACQUISITION";
        const toAms = items.every((i) => PRODUCTS[i.k].cat === "WATER" || PRODUCTS[i.k].cat === "SOFT");
        const calc = calcPurchase({
          fxRate: 1,
          treatment,
          lines: items.map((i) => ({ description: `${PRODUCTS[i.k].name}`, productId: P[i.k], accountCode: toAms ? "3010" : "3000", qty: i.n, unitPriceSrcCents: eur(PRODUCTS[i.k].cost), vatRateBp: treatment === "DOMESTIC" ? 900 : 0 })),
        });
        const date = at(2 + pNo++);
        const inv = await tx.purchaseInvoice.create({
          data: {
            administrationId: A,
            supplierId: R[supplier],
            supplierName: supplier,
            supplierCountry: country,
            number: `${supplier.slice(0, 2).toUpperCase()}-${mStart.getUTCFullYear()}${String(mStart.getUTCMonth() + 1).padStart(2, "0")}${pNo}`,
            issueDate: date,
            dueDate: new Date(date.getTime() + 30 * 86400_000),
            vatTreatment: treatment,
            warehouseId: toAms ? wh.ams.id : wh.rtm.id,
            status: "TO_APPROVE",
            netCents: calc.netCents,
            vatCents: calc.vatCents,
            totalCents: calc.totalCents,
            totalSourceCents: calc.totalSourceCents,
            ocrConfidence: 97,
            lines: { create: calc.lines.map((l) => ({ ...l, administrationId: A })) },
          },
        });
        await bookPurchase(tx, { administrationId: A, invoiceId: inv.id, userId: marta.id });
        const payDate = new Date(date.getTime() + 28 * 86400_000);
        if (payDate < TODAY) {
          const line = await bankLine(tx, payDate, supplier, `Invoice ${inv.number}`, -calc.totalCents);
          await reconcile(tx, { administrationId: A, txId: line.id, choice: { kind: "purchase", invoiceId: inv.id }, userId: marta.id });
        }
      }

      // 2. Releases for consumption: Rotterdam (bonded) → Amsterdam (duty paid).
      for (const [k, n] of Object.entries(releases) as [PKey, number][]) {
        await transferStock(tx, { administrationId: A, productId: P[k], qty: n, fromWarehouseId: wh.rtm.id, toWarehouseId: wh.ams.id, country: "NL", at: at(9), createdById: marta.id });
      }

      // 3. Domestic sales from Amsterdam (what was released), split over customers.
      const domestic = ["Café Rosa", "Hotel Meridiaan", "Bar Kade 12"];
      const shares = [0.3, 0.45, 0.25];
      const sell = async (cust: string, regime: TaxRegime, lines: Partial<Record<PKey, number>>, dateDay: number, whId: string, list: 0 | 1 | 2) => {
        const l = (Object.entries(lines) as [PKey, number][]).filter(([, n]) => n > 0).map(([k, n]) => ({ productId: P[k], qtyUnits: n, unitPriceCents: eur(PRODUCTS[k].lists[list]) }));
        if (!l.length) return null;
        const draft = await saveDraft(tx, { administrationId: A, customerId: R[cust]!, issueDate: at(dateDay), regime, warehouseId: whId, lines: l, createdById: marta.id });
        const { invoice } = await sendInvoice(tx, { administrationId: A, invoiceId: draft.id, userId: marta.id });
        const terms = regime === "DOMESTIC" ? 14 : 30;
        const paidOn = new Date(invoice.issueDate.getTime() + (terms + ((dateDay * 7) % 9) - 3) * 86400_000);
        if (paidOn < day(-3)) {
          const line = await bankLine(tx, paidOn, cust, `Payment ${invoice.number}`, invoice.totalCents);
          await reconcile(tx, { administrationId: A, txId: line.id, choice: { kind: "sales", invoiceId: invoice.id }, userId: marta.id });
        }
        return invoice;
      };
      for (let ci = 0; ci < domestic.length; ci++) {
        const lines: Partial<Record<PKey, number>> = {};
        for (const [k, n] of Object.entries(releases) as [PKey, number][]) {
          const caseOf = PRODUCTS[k].caseOf;
          lines[k] = Math.floor((n * shares[ci]!) / caseOf) * caseOf;
        }
        if (ci === domestic.length - 1) {
          for (const [k, n] of Object.entries(releases) as [PKey, number][]) {
            const caseOf = PRODUCTS[k].caseOf;
            const sold = domestic.slice(0, ci).reduce((a, _, j) => a + Math.floor((n * shares[j]!) / caseOf) * caseOf, 0);
            lines[k] = n - sold;
          }
        }
        if (ci === 0) Object.assign(lines, naSales);
        // Split each customer's month into two invoices.
        const half = Object.fromEntries(Object.entries(lines).map(([k, n]) => [k, Math.floor(n! / 2 / PRODUCTS[k as PKey].caseOf) * PRODUCTS[k as PKey].caseOf]));
        const rest = Object.fromEntries(Object.entries(lines).map(([k, n]) => [k, n! - (half[k] ?? 0)]));
        await sell(domestic[ci]!, "DOMESTIC", half, 12 + ci, wh.ams.id, 0);
        await sell(domestic[ci]!, "DOMESTIC", rest, 22 + ci, wh.ams.id, 0);
      }
      // 4. Duty-suspended EU and export sales straight from bond.
      for (const s of suspendedSales) {
        const regime: TaxRegime = s.cust === "Lagos Fine Spirits" ? "EXPORT" : "EU_B2B";
        await sell(s.cust, regime, s.lines, 18, wh.rtm.id, regime === "EXPORT" ? 2 : 1);
      }

      // 5. Payroll (imported), wage tax, rent, warehousing, freight, utilities.
      const payroll = await tx.receipt.create({
        data: {
          administrationId: A,
          date: at(25),
          supplier: `Payroll ${label}`,
          description: "Imported from Nmbrs · 6 employees",
          amountCents: eur(26780),
          paidBy: "BANK",
          status: "SUGGESTED",
          payroll: [
            { account: "4000", debit: eur(21400), credit: 0 },
            { account: "4010", debit: eur(3180), credit: 0 },
            { account: "4020", debit: eur(2200), credit: 0 },
            { account: "1500", debit: 0, credit: eur(6940) },
            { account: "1000", debit: 0, credit: eur(19840) },
          ],
        },
      });
      await bookReceipt(tx, { administrationId: A, receiptId: payroll.id, userId: marta.id });
      const sal = await bankLine(tx, at(25), `Salaries ${label}`, "Net wages via Nmbrs", -eur(19840));
      await reconcile(tx, { administrationId: A, txId: sal.id, choice: { kind: "receipt", receiptId: payroll.id }, userId: marta.id });

      const ledgerLine = async (d: number, who: string, desc: string, cents: number, account: string, vat: number) => {
        const l = await bankLine(tx, at(d), who, desc, cents);
        await reconcile(tx, { administrationId: A, txId: l.id, choice: { kind: "ledger", account, vatRateBp: vat }, userId: marta.id });
      };
      if (back < monthsBack) await ledgerLine(14, "Belastingdienst", "Loonheffing", -eur(6940), "1500", 0);
      await ledgerLine(1, "Havenbedrijf Vastgoed B.V.", "Huur kantoor & magazijn", -eur(2904), "4200", 2100);
      await ledgerLine(3, "KPN B.V.", `Direct debit ${String(mStart.getUTCMonth() + 1).padStart(2, "0")}/${mStart.getUTCFullYear()}`, -eur(64.95), "4610", 2100);
      await ledgerLine(8, "Shell Waalhaven", "Card payment · fuel", -eur(86.4), "4710", 2100);
      await ledgerLine(20, "Shell Waalhaven", "Card payment · fuel", -eur(79.1), "4710", 2100);
      await ledgerLine(5, "Eneco", "Energie kantoor & magazijn", -eur(412.18), "4210", 2100);
      await ledgerLine(10, "Achmea Schadeverzekeringen", "Cargo & opstal", -eur(466.67), "4800", 0);
      await ledgerLine(28, "ING Bank", "Kosten zakelijk betalen", -eur(95.4), "4820", 0);
      await ledgerLine(15, "Belastingdienst / Douane", `MRN 26NL000${4100000 + back * 1373}A${back}`, -eur(380 + back * 7), "4310", 0);

      // Warehousing (Rhenus, domestic 21%) and freight (Maersk, EU services).
      for (const [supplier, desc, account, net, treatment] of [
        ["Rhenus Warehousing B.V.", `Bonded storage ${label}`, "4400", 1528.93, "DOMESTIC"],
        ["Maersk Line", `Ocean freight ${label}`, "4300", 2140, "EU_SERVICES"],
      ] as const) {
        const calc = calcPurchase({ fxRate: 1, treatment, lines: [{ description: desc, accountCode: account, qty: 1, unitPriceSrcCents: eur(net), vatRateBp: treatment === "DOMESTIC" ? 2100 : 0 }] });
        const date = at(27);
        const inv = await tx.purchaseInvoice.create({
          data: {
            administrationId: A,
            supplierId: R[supplier],
            supplierName: supplier,
            supplierCountry: supplier.startsWith("Rhenus") ? "NL" : "DK",
            number: `${supplier.startsWith("Rhenus") ? "RH" : "MAEU"}-${88000 + back * 31}`,
            issueDate: date,
            dueDate: new Date(date.getTime() + 14 * 86400_000),
            vatTreatment: treatment,
            status: "TO_APPROVE",
            netCents: calc.netCents,
            vatCents: calc.vatCents,
            totalCents: calc.totalCents,
            totalSourceCents: calc.totalSourceCents,
            lines: { create: calc.lines.map((l) => ({ ...l, administrationId: A })) },
          },
        });
        await bookPurchase(tx, { administrationId: A, invoiceId: inv.id, userId: marta.id });
        const payDate = new Date(date.getTime() + 13 * 86400_000);
        if (payDate < TODAY) {
          const l = await bankLine(tx, payDate, supplier, `${inv.number}`, -calc.totalCents);
          await reconcile(tx, { administrationId: A, txId: l.id, choice: { kind: "purchase", invoiceId: inv.id }, userId: marta.id });
        }
      }
    });
  }

  // Monthly excise payments (previous month's releases) and quarterly VAT settlements.
  console.log("Tax payments…");
  await tenant(A, async (tx) => {
    for (let back = monthsBack - 1; back >= 1; back--) {
      const prev = monthStart(back + 1);
      const prevEnd = monthStart(back, 0);
      const moves = await tx.stockMovement.aggregate({ where: { administrationId: A, exciseReleased: true, at: { gte: prev, lte: new Date(prevEnd.getTime() + 86399_000) } }, _sum: { exciseCents: true } });
      const cents = moves._sum.exciseCents ?? 0;
      if (!cents) continue;
      const date = monthStart(back, 26);
      const l = await bankLine(tx, date, "Belastingdienst / Douane", `Accijns ${prev.toLocaleString("nl-NL", { month: "long", timeZone: "UTC" })}`, -cents);
      await reconcile(tx, { administrationId: A, txId: l.id, choice: { kind: "ledger", account: ACC.excisePayable, vatRateBp: 0 }, userId: marta.id });
    }
    // VAT: settle each completed quarter before the last one at the end of the following month.
    const q = Math.floor(TODAY.getUTCMonth() / 3);
    for (let qi = 0; qi < q - 1; qi++) {
      const qEnd = new Date(Date.UTC(TODAY.getUTCFullYear(), qi * 3 + 3, 0));
      const pay = new Date(Date.UTC(TODAY.getUTCFullYear(), qi * 3 + 4, 28));
      const rows = await tx.journalLine.groupBy({ by: ["accountCode"], where: { administrationId: A, accountCode: { in: ["1700", "1810"] }, entry: { date: { lte: qEnd } } }, _sum: { debitCents: true, creditCents: true } });
      const v1700 = rows.find((r) => r.accountCode === "1700");
      const v1810 = rows.find((r) => r.accountCode === "1810");
      const payable = (v1700?._sum.creditCents ?? 0) - (v1700?._sum.debitCents ?? 0);
      const reclaim = (v1810?._sum.debitCents ?? 0) - (v1810?._sum.creditCents ?? 0);
      const entry = await post(tx, {
        administrationId: A,
        date: pay,
        title: `VAT return Q${qi + 1} paid`,
        source: "BANK",
        lines: [
          { account: "1700", debit: payable },
          { account: "1810", credit: reclaim },
          ...(payable - reclaim >= 0 ? [{ account: "1000", credit: payable - reclaim }] : [{ account: "1000", debit: reclaim - payable }]),
        ],
      });
      await tx.bankTransaction.create({
        data: {
          administrationId: A,
          bankAccountId: bank.ing.id,
          date: pay,
          counterparty: "Belastingdienst",
          description: `Omzetbelasting ${qi + 1}e kwartaal`,
          amountCents: reclaim - payable,
          status: "RECONCILED",
          matchType: "ledger",
          matchId: "1700",
          matchLabel: "1700 VAT payable · return settled",
          journalEntryId: entry.id,
          reconciledAt: pay,
          importHash: `vat-q${qi + 1}`,
        },
      });
      await tx.taxReturn.create({
        data: {
          administrationId: A,
          type: "VAT",
          periodStart: new Date(Date.UTC(TODAY.getUTCFullYear(), qi * 3, 1)),
          periodEnd: qEnd,
          boxes: {},
          totalCents: payable - reclaim,
          status: "FILED",
          filedRef: `OB-${TODAY.getUTCFullYear()}-Q${qi + 1}-${4000 + qi * 13}`,
          filedAt: new Date(qEnd.getTime() + 20 * 86400_000),
          filedById: marta.id,
        },
      });
    }
  });

  // ── The current state (what the prototype shows) ───────────────────────────
  console.log("Current state…");
  await tenant(A, async (tx) => {
    // Open sales to make the receivables realistic.
    const sellNow = async (cust: string, regime: TaxRegime, lines: [PKey, number][], issue: Date, whId: string, list: 0 | 1 | 2, send = true) => {
      const draft = await saveDraft(tx, {
        administrationId: A,
        customerId: R[cust]!,
        issueDate: issue,
        regime,
        warehouseId: whId,
        lines: lines.map(([k, n]) => ({ productId: P[k], qtyUnits: n, unitPriceCents: eur(PRODUCTS[k].lists[list]) })),
        createdById: marta.id,
      });
      if (!send) return draft;
      return (await sendInvoice(tx, { administrationId: A, invoiceId: draft.id, userId: marta.id })).invoice;
    };
    // Return Rotterdam stock that was sold this month (keeps target levels honest).
    const restock = await tx.purchaseInvoice.create({
      data: {
        administrationId: A, supplierId: R["Bodegas Altamira"], supplierName: "Bodegas Altamira", supplierCountry: "ES", number: "BA-77310",
        issueDate: day(-9), dueDate: day(21), vatTreatment: "EU_ACQUISITION", warehouseId: wh.rtm.id, status: "TO_APPROVE", ocrConfidence: 98,
        netCents: eur(6840), totalCents: eur(6840), totalSourceCents: eur(6840),
        lines: { create: [{ administrationId: A, description: "Altamira Rioja Crianza 2021 · 0.75 L · 13.5%", productId: P.rioja, accountCode: "3000", qty: 1200, unitPriceSrcCents: eur(5.7), amountSrcCents: eur(6840), amountCents: eur(6840) }] },
      },
    });
    await bookPurchase(tx, { administrationId: A, invoiceId: restock.id, userId: marta.id });
    const dumontPaid = await sellNow("Wijnkoperij Dumont", "EU_B2B", [["port", 60], ["rioja", 150]], day(-15), wh.rtm.id, 1);
    const l1 = await bankLine(tx, day(-6), "Wijnkoperij Dumont", `Betaling ${dumontPaid.number}`, dumontPaid.totalCents);
    await reconcile(tx, { administrationId: A, txId: l1.id, choice: { kind: "sales", invoiceId: dumontPaid.id }, userId: marta.id });
    const kade = await sellNow("Bar Kade 12", "DOMESTIC", [["helles", 300], ["tripel", 120]], day(-32), wh.ams.id, 0);
    const lagos = await sellNow("Lagos Fine Spirits", "EXPORT", [["glen", 420], ["mezcal", 240]], day(-13), wh.rtm.id, 2);
    const meridiaanOld = await sellNow("Hotel Meridiaan", "DOMESTIC", [["rioja", 180], ["glen", 36], ["water", 480]], day(-23), wh.ams.id, 0);
    const nordvin = await sellNow("Nordvin AB", "EU_B2B", [["rhone", 600], ["rioja", 300]], day(-7), wh.rtm.id, 1);
    const rosa = await sellNow("Café Rosa", "DOMESTIC", [["rioja", 60], ["helles", 200], ["soda", 96]], day(-5), wh.ams.id, 0);
    await sellNow("Hotel Meridiaan", "DOMESTIC", [["rioja", 120], ["port", 24], ["water", 240]], TODAY, wh.ams.id, 0, false);
    void lagos;
    void nordvin;

    // Unreconciled bank lines (prototype "To reconcile").
    await bankLine(tx, day(-1), "Hotel Meridiaan", `Payment ${meridiaanOld.number}`, meridiaanOld.totalCents, "NL44 RABO 0123 4567 89");
    await bankLine(tx, day(-2), "Café Rosa", `Factuur ${rosa.number!.slice(-4)}`, rosa.totalCents, "NL02 ABNA 0412 3456 78");
    await bankLine(tx, day(-3), "Shell Waalhaven", "Card payment · fuel", -eur(86.4));
    await bankLine(tx, day(-4), "Belastingdienst / Douane", "MRN 26NL0004129384A2", -eur(412.3));
    await bankLine(tx, day(-5), "Bar Kade 12", `Deelbetaling factuur ${kade.number!.slice(-4)}`, eur(500));
    await bankLine(tx, day(-6), "KPN B.V.", `Direct debit ${String(TODAY.getUTCMonth() + 1).padStart(2, "0")}/${TODAY.getUTCFullYear()}`, -eur(64.95));
    await bankLine(tx, day(-1), "Albert Heijn 1432", "Pinbetaling", -eur(48.9));

    // Glen Arrow purchase in transit (booked), plus three to approve.
    const ga = calcPurchase({ fxRate: 1.155, treatment: "IMPORT", lines: [{ description: "Glen Arrow 12 Single Malt · 0.7 L · 40%", productId: P.glen, accountCode: "3020", qty: 1920, unitPriceSrcCents: eur(16.8) }] });
    const gaInv = await tx.purchaseInvoice.create({
      data: {
        administrationId: A, supplierId: R["Glen Arrow Distillers"], supplierName: "Glen Arrow Distillers", supplierCountry: "GB", number: "GA-5521",
        issueDate: day(-8), dueDate: day(22), currency: "GBP", fxRate: 1.155, fxDate: day(-8), vatTreatment: "IMPORT", warehouseId: wh.transit.id,
        orderRef: "PO-0918 · SHP-1179", status: "TO_APPROVE", ocrConfidence: 96, netCents: ga.netCents, totalCents: ga.totalCents, totalSourceCents: ga.totalSourceCents,
        lines: { create: ga.lines.map((l) => ({ ...l, administrationId: A })) },
      },
    });
    await bookPurchase(tx, { administrationId: A, invoiceId: gaInv.id, userId: marta.id });

    const ds = calcPurchase({ fxRate: 1, treatment: "EU_ACQUISITION", lines: [
      { description: "Côtes du Rhône 2022 · 0.75 L · 14%", productId: P.rhone, accountCode: "3000", qty: 600, unitPriceSrcCents: eur(6.2) },
      { description: "Transport Orange → Rotterdam", accountCode: "4300", qty: 1, unitPriceSrcCents: eur(180) },
    ] });
    await tx.purchaseInvoice.create({
      data: {
        administrationId: A, supplierId: R["Domaine Sauvage SARL"], supplierName: "Domaine Sauvage SARL", supplierCountry: "FR", number: "FA-22871",
        issueDate: day(-2), dueDate: day(28), vatTreatment: "EU_ACQUISITION", warehouseId: wh.rtm.id, orderRef: "PO-0932 · 600 of 600 bottles",
        status: "TO_APPROVE", ocrConfidence: 98, netCents: ds.netCents, totalCents: ds.totalCents, totalSourceCents: ds.totalSourceCents,
        lines: { create: ds.lines.map((l) => ({ ...l, administrationId: A })) },
      },
    });
    const cl = calcPurchase({ fxRate: 0.0486, treatment: "IMPORT", lines: [{ description: "Mezcal Espadín · 0.7 L · 42%", productId: P.mezcal, accountCode: "3020", qty: 2400, unitPriceSrcCents: eur(100) }] });
    await tx.purchaseInvoice.create({
      data: {
        administrationId: A, supplierId: R["Distilería Casa Lume"], supplierName: "Distilería Casa Lume", supplierCountry: "MX", number: "CL-2026-118",
        issueDate: day(-5), dueDate: day(25), currency: "MXN", fxRate: 0.0486, fxDate: day(-5), vatTreatment: "IMPORT", warehouseId: wh.transit.id,
        orderRef: "PO-0921 · shipment SHP-1182", status: "TO_APPROVE", ocrConfidence: 94,
        warning: "Invoiced in Mexican pesos. Converted at 1 MXN = €0.0486 (ECB) — check against your bank before booking.",
        netCents: cl.netCents, totalCents: cl.totalCents, totalSourceCents: cl.totalSourceCents,
        lines: { create: cl.lines.map((l) => ({ ...l, administrationId: A })) },
      },
    });
    const rh = calcPurchase({ fxRate: 1, treatment: "DOMESTIC", lines: [{ description: "Bonded storage · 212 pallets", accountCode: "4400", qty: 1, unitPriceSrcCents: eur(1528.93), vatRateBp: 2100 }] });
    await tx.purchaseInvoice.create({
      data: {
        administrationId: A, supplierId: R["Rhenus Warehousing B.V."], supplierName: "Rhenus Warehousing B.V.", supplierCountry: "NL", number: "RH-88120",
        issueDate: day(-6), dueDate: day(8), vatTreatment: "DOMESTIC", orderRef: "Contract RH-2024-07 · monthly",
        status: "TO_APPROVE", ocrConfidence: 99, netCents: rh.netCents, vatCents: rh.vatCents, totalCents: rh.totalCents, totalSourceCents: rh.totalSourceCents,
        lines: { create: rh.lines.map((l) => ({ ...l, administrationId: A })) },
      },
    });

    // Receipts (prototype "Costs & receipts").
    const receipts = [
      { d: 0, supplier: "Staples Rotterdam", what: "Printer paper & toner", amount: 86.47, cat: "office", paid: "CARD", status: "SUGGESTED", why: "Booked as office supplies 6 times before" },
      { d: -1, supplier: "Restaurant Het Pakhuis", what: "Lunch with Nordvin buyer · 2 people", amount: 142.5, cat: "meals", paid: "CARD", status: "SUGGESTED", why: "Restaurant, weekday · customer named in note" },
      { d: -1, supplier: "NS", what: "Train Rotterdam – Amsterdam return", amount: 37.2, cat: "travel", paid: "OWN", who: "Joost", status: "SUGGESTED", why: "Public transport ticket" },
      { d: -2, supplier: "Albert Heijn", what: "Bread, cheese & fruit for team lunch", amount: 48.9, cat: "staff", paid: "OWN", who: "Marta", status: "SUGGESTED", why: "Supermarket · weekly team lunch" },
      { d: -6, supplier: "bol.com", what: "Order 4021-8812 · 3 items", amount: 129, cat: null, paid: "CARD", status: "UNSORTED", why: "Web shop — could be several things" },
      { d: -3, supplier: "Messe Düsseldorf", what: "ProWein · stand deposit", amount: 2400, cat: "fairs", paid: "BANK", status: "BOOK", vat: "FOREIGN_VAT" },
      { d: -4, supplier: "Q-Park", what: "Parking Rotterdam Centraal", amount: 18, cat: "parking", paid: "CARD", status: "BOOK" },
      { d: -5, supplier: "Adobe Ireland", what: "Creative Cloud · monthly", amount: 71.39, cat: "software", paid: "CARD", status: "BOOK", vat: "EU_SERVICES" },
    ] as const;
    for (const r of receipts) {
      const rec = await tx.receipt.create({
        data: {
          administrationId: A,
          date: day(r.d),
          supplier: r.supplier,
          description: r.what,
          amountCents: eur(r.amount),
          categoryKey: r.cat,
          paidBy: r.paid,
          employeeName: "who" in r ? r.who : null,
          status: r.status === "BOOK" ? "SUGGESTED" : r.status,
          suggestionReason: "why" in r ? r.why : null,
          vatOverride: "vat" in r ? r.vat : null,
        },
      });
      if (r.status === "BOOK") await bookReceipt(tx, { administrationId: A, receiptId: rec.id, userId: marta.id });
    }
    void receiptLines;

    // Shipments & customs documents.
    const ships = [
      ["SHP-1190", "EXPORT", "Rotterdam", "Lagos", "Sea · 40 ft container", "4,800 btl spirits & wine", 5, "BOOKED", "Booked · export declaration drafted", false],
      ["SHP-1182", "IMPORT", "Veracruz", "Rotterdam", "Sea · 20 ft container", "2,400 Mezcal Espadín", 7, "IN_TRANSIT", "At sea", false],
      ["SHP-1188", "EU", "Rotterdam", "Stockholm", "Road · e-AD under EMCS", "3,600 btl wine & beer", 2, "IN_TRANSIT", "On the road", false],
      ["SHP-1179", "IMPORT", "Glasgow", "Rotterdam", "Sea · 20 ft container", "1,920 Glen Arrow 12", null, "AT_CUSTOMS", "Held · T1 document missing", true],
      ["SHP-1185", "IMPORT", "Logroño", "Rotterdam", "Road · truck", "1,200 Rioja Crianza", -1, "ARRIVED", "Arrived · booked into stock", false],
      ["SHP-1191", "DOMESTIC", "Amsterdam", "Café Rosa", "Van", "18 cases mixed", -5, "ARRIVED", "Delivered · signed", false],
    ] as const;
    const shipIds: Record<string, string> = {};
    for (const [ref, dir, from, to, mode, goods, eta, stage, note, blocked] of ships) {
      const s = await tx.shipment.create({
        data: { administrationId: A, ref, direction: dir, origin: from, destination: to, mode, goods, eta: eta === null ? null : day(eta), stage, stageNote: note, blocked, blockReason: blocked ? "T1 transit document missing" : null },
      });
      shipIds[ref] = s.id;
    }
    await tx.purchaseInvoice.update({ where: { id: gaInv.id }, data: { shipmentId: shipIds["SHP-1179"] } });
    await tx.customsDocument.createMany({
      data: [
        { administrationId: A, type: "IMPORT_DECLARATION", reference: "MRN 26NL0004129384A2", shipmentId: shipIds["SHP-1185"], status: "RELEASED", notes: "Rioja from Logroño" },
        { administrationId: A, type: "E_AD", reference: "ARC 26NLA9V2K3TQ8811P5", shipmentId: shipIds["SHP-1188"], status: "AWAITING", notes: "Nordvin, Stockholm" },
        { administrationId: A, type: "EXPORT_DECLARATION", reference: "MRN 26NL0004190022E8", shipmentId: shipIds["SHP-1190"], status: "DRAFT", notes: "Lagos" },
        { administrationId: A, type: "T1", reference: null, shipmentId: shipIds["SHP-1179"], status: "MISSING", notes: "Glen Arrow, Glasgow" },
      ],
    });
  });

  // ── Other clients ─────────────────────────────────────────────────────────
  console.log("Other clients…");
  for (const c of OTHER_CLIENTS) {
    const { client, administration } = await system((tx) =>
      createClientWithAdministration(tx, { name: c.name, country: c.cc, vatNumber: c.vat, plan: c.plan, trial: c.status === "TRIAL", modules: [...c.mods] }),
    );
    await prisma.client.update({
      where: { id: client.id },
      data: {
        status: c.status,
        trialEndsAt: "trialLeft" in c ? day(c.trialLeft) : null,
        lastActiveAt: day(-c.last),
        createdAt: day(-30 * (2 + (c.name.length % 14))),
      },
    });
    for (const u of OTHER_USERS.filter((x) => x.client === c.name)) {
      const user = await prisma.user.create({
        data: {
          name: u.name,
          email: u.email,
          locale: u.locale,
          passwordHash: pw,
          status: u.status,
          lockedUntil: u.status === "LOCKED" ? new Date(Date.now() + 15 * 60_000) : null,
          lockReason: u.status === "LOCKED" ? "5 failed 2FA attempts" : null,
          totpSecretEnc: u.mfa === "app" ? sealedTotp : null,
          totpEnabledAt: u.mfa === "app" ? new Date() : null,
          phone: u.mfa === "sms" ? "+49 151 2345 6712" : null,
          smsEnabled: u.mfa === "sms",
          lastSignInAt: u.status === "ACTIVE" ? day(-c.last) : null,
          lastAdministrationId: administration.id,
        },
      });
      await system((tx) => addMembership(tx, user.id, administration.id, u.role));
    }
  }

  // Subscription invoices for this month and audit history.
  const clients = await prisma.client.findMany();
  const price: Record<string, number> = { STARTER: 4900, BUSINESS: 14900, PRO: 24900, ENTERPRISE: 0 };
  let n = 101;
  for (const c of clients.filter((c) => c.status !== "TRIAL")) {
    await prisma.subscriptionInvoice.create({
      data: {
        clientId: c.id,
        number: `LL-${TODAY.getUTCFullYear()}-${String(TODAY.getUTCMonth() + 1).padStart(2, "0")}-${n++}`,
        plan: c.plan,
        periodStart: monthStart(0),
        periodEnd: monthStart(-1, 0),
        amountCents: price[c.plan]!,
        status: c.status === "PAST_DUE" ? "FAILED" : c.status === "SUSPENDED" ? "OPEN" : "PAID",
        paidAt: c.status === "ACTIVE" ? monthStart(0, 1) : null,
      },
    });
  }
  const byName = Object.fromEntries(clients.map((c) => [c.name, c.id]));
  const audit = [
    [-0.01, "USER", "Giulia Rossi", "auth.sign_in", "Signed in · authenticator app", "Cantina Rossi S.r.l.", "93.41.12.208"],
    [-0.02, "STAFF", "Noor El Amrani", "support.open", "Opened support access · ticket #4407 · 60 min", "Vale & Hart Drinks B.V.", "185.12.4.71"],
    [-0.03, "USER", "Marta Visser", "auth.sign_in", "Signed in · passkey · trusted device", "Vale & Hart Drinks B.V.", "84.26.190.3"],
    [-0.05, "USER", "Sabine Hoff", "auth.locked", "Account locked · 5 failed 2FA attempts", "Weinhandel Krüger GmbH", "91.64.7.122"],
    [-0.08, "SYSTEM", "System", "billing.trial_reminder", "Trial ending in 4 days · reminder sent", "Lumo Drinks B.V.", null],
    [-1, "STAFF", "Ruben Janssen", "client.plan", "Changed plan Business → Pro", "Maison Duret SAS", "185.12.4.70"],
    [-1.1, "SYSTEM", "System", "billing.payment_failed", "Payment failed · card expired · retry in 3 days", "Hurtownia Napojów Wisła Sp. z o.o.", null],
    [-1.2, "USER", "Marta Visser", "user.invite", "Invited lars@valehart.nl as Bookkeeper", "Vale & Hart Drinks B.V.", "84.26.190.3"],
    [-2, "STAFF", "Ruben Janssen", "rates.update", "Updated NL excise rates (effective 1 January)", null, "185.12.4.70"],
  ] as const;
  for (const [offset, type, label, action, summary, client, ip] of audit) {
    await prisma.auditEvent.create({
      data: { at: new Date(Date.now() + offset * 86400_000), actorType: type, actorLabel: label, action, summary, clientId: client ? byName[client] : null, ip },
    });
  }

  console.log("\n────────────────────────────────────────────────────────────");
  console.log("Demo data ready.\n");
  console.log(`Client app      ${process.env.APP_URL ?? "http://localhost:3000"}/login`);
  console.log(`  marta@valehart.nl (Owner) · joost@valehart.nl (Warehouse) · eva@bakker-accountants.nl (Accountant)`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  authenticator secret (add to your app, or generate codes with otplib): ${DEMO_TOTP}`);
  console.log(`  current code: ${authenticator.generate(DEMO_TOTP)}`);
  console.log(`\nInvite link for Lars Kim: ${process.env.APP_URL ?? "http://localhost:3000"}/invite?token=${inviteToken}`);
  console.log("\nPlatform admin — set up a passkey for each staff member:");
  for (const l of staffLinks) console.log("  " + l);
  console.log("────────────────────────────────────────────────────────────\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
