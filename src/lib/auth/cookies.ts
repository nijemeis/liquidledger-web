import "server-only";
import { cookies } from "next/headers";
import { isProd } from "../env";

// In production the __Host- prefix pins cookies to this exact host, HTTPS and
// path=/, so a sibling subdomain can never set or read them.
const p = (name: string) => (isProd ? `__Host-${name}` : name);

export const COOKIE = {
  session: p("ll_session"),
  staff: p("ll_staff"),
  challenge: p("ll_challenge"),
  staffChallenge: p("ll_staff_challenge"),
  device: p("ll_device"),
  support: p("ll_support"), // platform staff viewing a client app (support access)
} as const;

export async function setCookie(name: string, value: string, maxAgeSeconds?: number) {
  const jar = await cookies();
  jar.set(name, value, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    ...(maxAgeSeconds ? { maxAge: maxAgeSeconds } : {}),
  });
}

export async function getCookie(name: string): Promise<string | undefined> {
  return (await cookies()).get(name)?.value;
}

export async function deleteCookie(name: string) {
  const jar = await cookies();
  jar.set(name, "", { httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: 0 });
}
