"use server";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { appAction, auditApp, canEditIn, getAppContext, type ActionResult } from "@/lib/app-context";
import { PostingError } from "@/lib/domain/ledger";
import { getI18n } from "@/i18n/server";
import { parseXaf, XafError, type XafFile } from "@/lib/xaf/parse";
import { previewImport, reverseImport, runImport, type ImportPreview, type ImportResult } from "@/lib/xaf/import";

// XAF import: the browser gzips the file (XML shrinks ~10×, so large years fit
// the Server Action body limit), we parse it outside the database transaction,
// then preview and import run in the tenant transaction.

const MAX_XML_BYTES = 150 * 1024 * 1024;

type Read = { file: XafFile; hash: string; name: string };

async function readUpload(form: FormData, t: (k: string, v?: Record<string, string | number>) => string): Promise<Read | { error: string }> {
  const f = form.get("file");
  if (!(f instanceof File)) return { error: t("xaf.err.noFile") };
  const name = String(form.get("name") || f.name || "auditfile.xaf").replace(/[^\w .()-]/g, "_").slice(0, 200);
  let buf: Buffer = Buffer.from(await f.arrayBuffer());
  try {
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf, { maxOutputLength: MAX_XML_BYTES });
  } catch {
    return { error: t("xaf.err.tooLarge") };
  }
  if (buf.length > MAX_XML_BYTES) return { error: t("xaf.err.tooLarge") };
  if (buf[0] === 0x50 && buf[1] === 0x4b) return { error: t("xaf.err.zip") };
  const hash = createHash("sha256").update(buf).digest("hex");
  // Auditfiles are UTF-8 by default; older packages write Windows-1252/ISO-8859-1 or UTF-16.
  const head = buf.subarray(0, 200).toString("latin1");
  const declared = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase();
  const encoding =
    buf[0] === 0xff && buf[1] === 0xfe ? "utf-16le" : buf[0] === 0xfe && buf[1] === 0xff ? "utf-16be" : declared && /^(iso-8859-1|iso-8859-15|windows-1252|cp1252|latin1)$/.test(declared) ? "windows-1252" : "utf-8";
  try {
    const file = parseXaf(new TextDecoder(encoding).decode(buf));
    return { file, hash, name };
  } catch (e) {
    if (e instanceof XafError) return { error: t("xaf.err.parse", { detail: e.message }) };
    console.error("[xaf.parse]", e);
    return { error: t("xaf.err.parse", { detail: "" }) };
  }
}

export async function previewXaf(form: FormData): Promise<ActionResult<{ preview?: ImportPreview; fileName?: string }>> {
  const ctx = await getAppContext();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  const { t } = await getI18n(ctx.locale);
  if (!canEditIn(ctx, "reports")) return { ok: false, error: t("xaf.err.role") };
  const read = await readUpload(form, t);
  if ("error" in read) return { ok: false, error: read.error };
  return appAction<{ preview?: ImportPreview; fileName?: string }>(
    "reports",
    async (ctx, tx) => {
      const a = ctx.administration;
      const preview = await previewImport(tx, read.file, read.hash, {
        administrationId: a.id,
        country: a.country,
        baseCurrency: a.baseCurrency,
        ledgerLanguage: a.ledgerLanguage,
        lockedThrough: a.lockedThrough,
        userId: ctx.kind === "user" ? ctx.userId : null,
      });
      return { preview, fileName: read.name };
    },
    { revalidate: [] },
  );
}

const target = z.object({ code: z.string().trim().max(6), create: z.boolean(), name: z.string().max(200), type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COST"]) });
const options = z.object({
  mapping: z.record(z.string().max(35), target),
  journals: z.array(z.string().max(35)).max(500),
  opening: z.boolean(),
  allRelations: z.boolean(),
  lock: z.boolean(),
});

export async function importXaf(form: FormData): Promise<ActionResult<{ result?: ImportResult }>> {
  const ctx = await getAppContext();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  const { t, fmt } = await getI18n(ctx.locale);
  if (!canEditIn(ctx, "reports")) return { ok: false, error: t("xaf.err.role") };
  let opts: z.infer<typeof options>;
  try {
    opts = options.parse(JSON.parse(String(form.get("options") ?? "")));
  } catch {
    return { ok: false, error: t("xaf.err.options") };
  }
  if (opts.lock && !canEditIn(ctx, "users")) return { ok: false, error: t("xaf.err.lockRole") };
  const read = await readUpload(form, t);
  if ("error" in read) return { ok: false, error: read.error };
  return appAction<{ result?: ImportResult }>(
    "reports",
    async (ctx, tx) => {
      const a = ctx.administration;
      const result = await runImport(
        tx,
        read.file,
        { fileName: read.name, fileHash: read.hash },
        { administrationId: a.id, country: a.country, baseCurrency: a.baseCurrency, ledgerLanguage: a.ledgerLanguage, lockedThrough: a.lockedThrough, userId: ctx.kind === "user" ? ctx.userId : null },
        opts,
      );
      let locked: Date | null = null;
      if (opts.lock && result.last) {
        // Close through the end of the last imported month, never in the current month.
        const last = new Date(result.last + "T00:00:00Z");
        const monthEnd = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0));
        const now = new Date();
        const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        if (monthEnd.getTime() < today && (!a.lockedThrough || monthEnd > a.lockedThrough)) {
          await tx.administration.update({ where: { id: a.id }, data: { lockedThrough: monthEnd } });
          locked = monthEnd;
        }
      }
      await auditApp(
        ctx,
        "ledger.import.xaf",
        `Imported auditfile ${read.name} (${read.file.header.software || "unknown software"}, ${result.first} – ${result.last}): ${result.entries} entries, ${result.accountsCreated} new accounts, ${result.relationsCreated} new relations${locked ? `; closed the books through ${locked.toISOString().slice(0, 10)}` : ""}`,
        { targetType: "import_batch", targetId: result.batchId, after: { ...result, journals: opts.journals, opening: opts.opening } },
        tx,
      );
      return {
        result,
        message: t("xaf.toast.imported", { n: fmt.int(result.entries) }),
      };
    },
    { timeout: 180_000 },
  );
}

export async function reverseXafImport(batchId: string) {
  return appAction("reports", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    if (typeof batchId !== "string" || !batchId) throw new PostingError(t("xaf.err.notFound"));
    const r = await reverseImport(tx, ctx.administration.id, batchId, ctx.kind === "user" ? ctx.userId : null);
    await auditApp(ctx, "ledger.import.reverse", `Reversed auditfile import ${r.batch.fileName}: ${r.reversed} entries`, { targetType: "import_batch", targetId: batchId }, tx);
    return { message: t("xaf.toast.reversed", { n: fmt.int(r.reversed) }) };
  }, { timeout: 180_000 });
}
