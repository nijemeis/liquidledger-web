"use server";
import { getStaffContext } from "@/lib/admin/staff";
import { searchPlatform } from "@/lib/admin/data";

export type SearchResults = Awaited<ReturnType<typeof searchPlatform>>;

/** Top-bar search (client, user, email or VAT number). */
export async function adminSearch(q: string): Promise<SearchResults> {
  const ctx = await getStaffContext();
  if (!ctx || typeof q !== "string") return { clients: [], users: [], staff: [] };
  return searchPlatform(ctx, q, 5);
}
