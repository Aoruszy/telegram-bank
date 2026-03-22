export async function adminFetch(input, init = {}) {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const headers = { ...(init.headers || {}) };
  if (key) headers["X-Admin-Key"] = key;
  return fetch(input, { ...init, headers });
}
