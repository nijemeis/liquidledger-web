import type { Metadata } from "next";
import { findEmailToken } from "@/lib/auth/flow";
import { ResetForm, LinkInvalid } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const row = token ? await findEmailToken(token, "RESET_PASSWORD") : null;
  const usable = row?.user && (row.user.status === "ACTIVE" || row.user.status === "LOCKED");
  if (!usable) return <LinkInvalid kind="reset" />;
  return <ResetForm token={token} email={row.user!.email} />;
}
