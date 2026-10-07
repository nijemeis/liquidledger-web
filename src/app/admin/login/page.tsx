import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth/session";
import { AuthFrame } from "../auth-frame";
import { StaffLogin } from "./staff-login";

export const metadata: Metadata = { title: "Sign in" };

export default async function AdminLoginPage() {
  if (await getStaffSession()) redirect("/admin");
  return (
    <AuthFrame>
      <StaffLogin />
    </AuthFrame>
  );
}
