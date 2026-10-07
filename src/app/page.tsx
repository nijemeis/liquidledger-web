import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";

export default async function Home() {
  const s = await getUserSession();
  redirect(s ? "/dashboard" : "/login");
}
