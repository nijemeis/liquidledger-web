export type MfaMethods = { totp: boolean; passkey: boolean; sms: string | null; recovery: boolean };

export type LoginResponse =
  | { ok: true; next: "done"; redirect: string; name: string; company: string | null; trusted?: boolean }
  | { ok: true; next: "mfa"; methods: MfaMethods }
  | { ok: true; next: "enroll" }
  | { ok: false; error: string; minutes?: number };

export async function authPost<T = LoginResponse>(action: string, body: object = {}): Promise<T> {
  try {
    const res = await fetch(`/api/auth/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    return (await res.json()) as T;
  } catch {
    return { ok: false, error: "server" } as T;
  }
}
