import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { LoginFlow } from "./login-flow";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string; next?: string }> }) {
  if (await getUserSession()) redirect("/dashboard");
  const sp = await searchParams;
  return <LoginFlow notice={sp.reset === "1" ? "reset" : null} />;
}
