// File type detection by magic bytes (no server-only imports so it can be unit-tested).

export const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export type DocumentMime = (typeof ALLOWED_TYPES)[number];

/** Detect the real file type from its first bytes. */
export function sniffType(b: Uint8Array): DocumentMime | null {
  const at = (i: number, s: string) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (b.length >= 5 && at(0, "%PDF-")) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && at(1, "PNG") && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (b.length >= 12 && at(4, "ftyp")) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

