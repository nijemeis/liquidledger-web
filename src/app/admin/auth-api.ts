// Client-side helper for /api/admin-auth/*.
export type AdminAuthResponse = { ok: boolean; next?: string; redirect?: string; error?: string; minutes?: number; message?: string; reason?: string; options?: unknown };

export async function adminAuthPost<T = AdminAuthResponse>(action: string, body: object = {}): Promise<T> {
  try {
    const res = await fetch(`/api/admin-auth/${action}`, {
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
