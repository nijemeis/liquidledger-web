import type { Metadata } from "next";
import { lockTokenValid } from "@/lib/auth/flow";
import { LinkInvalid } from "../reset/reset-form";
import { LockConfirm } from "./lock-confirm";

export const metadata: Metadata = { title: "Lock your account", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

// GET only shows a confirmation; locking needs an explicit click (mail scanners
// and link previews open links too).
export default async function LockPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  if (!token || !(await lockTokenValid(token))) return <LinkInvalid kind="lock" />;
  return <LockConfirm token={token} />;
}
