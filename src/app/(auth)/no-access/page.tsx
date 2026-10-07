import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { getAppContext } from "@/lib/app-context";
import { NoAccess } from "./no-access";

export const metadata: Metadata = { title: "No administration" };
export const dynamic = "force-dynamic";

export default async function NoAccessPage() {
  const s = await getUserSession();
  if (!s) redirect("/login");
  if (await getAppContext()) redirect("/dashboard");
  return <NoAccess email={s.user.email} />;
}
