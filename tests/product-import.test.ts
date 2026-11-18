import { describe, expect, it } from "vitest";
import { categoryOf, countryOf, newProductIssues, parseProductSheet, TEMPLATE_CSV } from "@/lib/domain/product-import";

describe("product import from a spreadsheet", () => {
  it("reads Dutch headers pasted from Excel (tabs), in any order", () => {
    const sheet = [
      "Naam\tArtikelcode\tCategorie\tInhoud\tAlcohol %\tFlessen per doos\tKostprijs\tPrijs horeca\tGroothandel\tLand van herkomst",
      "Pisco Quebranta\tsp-3012\tGedistilleerd\t0,7\t40%\t6\t€ 14,20\t24,50\t21,00\tPeru",
      "Cava Brut\tWN-2001\tMousserende wijn\t75 cl\t11,5\t6\t5,10\t9,95\t\tSpanje",
    ].join("\n");
    const r = parseProductSheet(sheet);
    expect(r.missing).toEqual([]);
    expect(r.ignored).toEqual([]);
    expect(r.columns.priceLists).toEqual(["Horeca", "Wholesale"]);
    expect(r.rows[0]).toMatchObject({
      line: 2,
      issues: [],
      product: { sku: "SP-3012", name: "Pisco Quebranta", category: "SPIRITS", volumeMl: 700, abvBp: 4000, unitsPerCase: 6, costCents: 1420, originCountry: "PE", prices: { Horeca: 2450, Wholesale: 2100 } },
    });
    expect(r.rows[1]!.product).toMatchObject({ category: "WINE", sparkling: true, volumeMl: 750, abvBp: 1150, originCountry: "ES", prices: { Horeca: 995 } });
  });

  it("reads a CSV with quotes, ml volumes and beer Plato", () => {
    const csv = 'SKU,Name,Category,Volume ml,ABV,Plato,Price\nBR-1,"Tripel, oak aged",Beer,330,8.5,18.5,1.85\nBR-2,Session,Beer,330,0.5,,"1,20"\n';
    const r = parseProductSheet(csv);
    expect(r.rows[0]!.product).toMatchObject({ sku: "BR-1", name: "Tripel, oak aged", category: "BEER", volumeMl: 330, abvBp: 850, platoTenths: 185, prices: { Horeca: 185 } });
    expect(r.rows[1]!.product).toMatchObject({ abvBp: 50, prices: { Horeca: 120 } }); // 0.5% stays 0.5%
  });

  it("reports what it can't read, per row", () => {
    const r = parseProductSheet("SKU;Name;Category;Volume;ABV;Origin;Colour\nX1;Thing;Kombucha?;big;140;Atlantis;red\nX1;Again;Wine;0,75;12;FR;\n;No code;Wine;0,75;12;;\n");
    expect(r.ignored).toEqual(["Colour"]);
    expect(r.rows[0]!.issues.map((i) => i.code).sort()).toEqual(["category", "country", "number", "volume"]);
    expect(r.rows[1]!.issues).toEqual([{ code: "duplicateSku", sku: "X1" }]);
    expect(r.rows[2]!.issues).toEqual([{ code: "missingSku" }]);
  });

  it("knows what a new product needs, and the template parses cleanly", () => {
    expect(newProductIssues({ sku: "A", prices: {} }).map((i) => i.code)).toEqual(["missingName", "category", "volume"]);
    const t = parseProductSheet(TEMPLATE_CSV);
    expect(t.ignored).toEqual([]);
    expect(t.rows.every((r) => r.issues.length === 0 && newProductIssues(r.product).length === 0)).toBe(true);
    expect(t.rows[2]!.product).toMatchObject({ category: "BEER", platoTenths: 185, depositCents: 10, ean: "5411081200039" });
  });

  it("maps categories and countries from free text", () => {
    expect(categoryOf("Port")).toBe("FORTIFIED");
    expect(categoryOf("Frisdrank")).toBe("SOFT");
    expect(categoryOf("Rode wijn")).toBe("WINE");
    expect(categoryOf("gin")).toBe("SPIRITS");
    expect(countryOf("Frankrijk")).toBe("FR");
    expect(countryOf("de")).toBe("DE");
  });
});
