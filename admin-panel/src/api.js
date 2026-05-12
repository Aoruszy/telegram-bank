const ADMIN_API_BASE = (import.meta.env.VITE_ADMIN_API_BASE || "https://api.zf-bank.ru").replace(/\/$/, "");

export function adminUrl(path, base = ADMIN_API_BASE) {
  const normalized = String(base || ADMIN_API_BASE).replace(/\/$/, "");
  return `${normalized}${path}`;
}

export async function adminFetch(input, init = {}) {
  const response = await fetch(input, {
    credentials: "include",
    ...init,
    headers: {
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.detail || payload?.error || `HTTP ${response.status}`;
    throw new Error(String(detail));
  }

  return response;
}
