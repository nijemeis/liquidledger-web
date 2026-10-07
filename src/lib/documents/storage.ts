import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Document } from "@prisma/client";
import type { Tx } from "@/lib/db";

// Uploaded documents (purchase invoices, receipts). Stored in the `documents`
// table by default, or in S3-compatible object storage (DigitalOcean Spaces)
// when the S3_* variables are set. Files are validated by their magic bytes,
// never by the extension or the browser-provided content type.

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export { ALLOWED_TYPES, sniffType, type DocumentMime } from "./sniff";
import { sniffType, type DocumentMime } from "./sniff";

/** Upload rejected. `code` maps to an i18n key (purchases.err.file.<code>). */
export class DocumentError extends Error {
  constructor(
    public code: "empty" | "tooLarge" | "type" | "storage",
    message: string,
  ) {
    super(message);
  }
}

/** Validate an upload; throws a plain-language DocumentError. */
export function validateUpload(bytes: Uint8Array, filename: string): { mime: DocumentMime; sha256: string } {
  if (!bytes.length) throw new DocumentError("empty", `${filename} is empty.`);
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new DocumentError("tooLarge", `${filename} is larger than 10 MB.`);
  const mime = sniffType(bytes);
  if (!mime) throw new DocumentError("type", `${filename} isn't a PDF or photo (JPEG, PNG, WebP or HEIC).`);
  return { mime, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Keep only safe characters in a filename (it ends up in headers and UI). */
export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const s = base.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return s || "document";
}

// ── S3 ───────────────────────────────────────────────────────────────────────

let s3: S3Client | null = null;
function s3Config() {
  const { S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_BUCKET || !S3_ENDPOINT || !S3_REGION || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  if (!s3) {
    s3 = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      forcePathStyle: false,
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    });
  }
  return { client: s3, bucket: S3_BUCKET };
}

export function usesObjectStorage() {
  return s3Config() !== null;
}

export interface StoredBlob {
  storage: "db" | "s3";
  storageKey: string | null;
  data: Uint8Array<ArrayBuffer> | null;
}

/**
 * Put the bytes where they belong. Call this BEFORE the database transaction
 * (network I/O); if the transaction then fails, call `discardBlob`.
 */
export async function putBlob(administrationId: string, bytes: Uint8Array, mime: string): Promise<StoredBlob> {
  const cfg = s3Config();
  if (!cfg) return { storage: "db", storageKey: null, data: new Uint8Array(bytes) };
  const key = `${administrationId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
  await cfg.client.send(
    new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: bytes, ContentType: mime, ACL: "private", ServerSideEncryption: "AES256" }),
  );
  return { storage: "s3", storageKey: key, data: null };
}

export async function discardBlob(blob: StoredBlob) {
  const cfg = s3Config();
  if (blob.storage !== "s3" || !blob.storageKey || !cfg) return;
  try {
    await cfg.client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: blob.storageKey }));
  } catch (e) {
    console.error("[documents] couldn't delete object", blob.storageKey, e);
  }
}

/** Insert the document row (inside the tenant transaction). */
export async function createDocument(
  tx: Tx,
  input: { administrationId: string; kind: string; filename: string; mime: string; size: number; sha256: string; blob: StoredBlob; uploadedById?: string | null; extraction?: unknown; status?: "UPLOADED" | "PROCESSED" | "FAILED"; error?: string | null },
) {
  return tx.document.create({
    data: {
      administrationId: input.administrationId,
      kind: input.kind,
      filename: input.filename,
      mimeType: input.mime,
      size: input.size,
      sha256: input.sha256,
      storage: input.blob.storage,
      storageKey: input.blob.storageKey,
      data: input.blob.data,
      status: input.status ?? "UPLOADED",
      extraction: input.extraction === undefined ? undefined : (input.extraction as object),
      error: input.error ?? null,
      uploadedById: input.uploadedById ?? null,
    },
    select: { id: true, filename: true, mimeType: true },
  });
}

/** Read the bytes of a document row. */
export async function readBlob(doc: Pick<Document, "storage" | "storageKey" | "data">): Promise<Uint8Array> {
  if (doc.storage === "s3") {
    const cfg = s3Config();
    if (!cfg || !doc.storageKey) throw new DocumentError("storage", "Object storage isn't configured.");
    const out = await cfg.client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: doc.storageKey }));
    if (!out.Body) throw new DocumentError("storage", "Document not found in storage.");
    return out.Body.transformToByteArray();
  }
  return doc.data ? new Uint8Array(doc.data) : new Uint8Array();
}

/** Delete a document row (inside the transaction) and return what to clean up afterwards. */
export async function deleteDocument(tx: Tx, administrationId: string, id: string): Promise<StoredBlob | null> {
  const doc = await tx.document.findFirst({ where: { id, administrationId }, select: { id: true, storage: true, storageKey: true } });
  if (!doc) return null;
  await tx.document.delete({ where: { id: doc.id } });
  return { storage: doc.storage === "s3" ? "s3" : "db", storageKey: doc.storageKey, data: null };
}
