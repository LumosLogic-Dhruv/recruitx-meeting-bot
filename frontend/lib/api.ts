const BASE = process.env.NEXT_PUBLIC_API_URL || "";

function token() {
  return typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";
}

export function authHeaders() {
  return { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };
}

export function authHeadersOnly() {
  return { Authorization: `Bearer ${token()}` };
}

export async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
  });
  return res;
}

export async function apiJSON<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await api(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data as T;
}

export function getUser() {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/login";
}

export async function checkSession(): Promise<boolean> {
  try {
    const res = await api("/api/auth/me");
    return res.ok;
  } catch { return false; }
}
