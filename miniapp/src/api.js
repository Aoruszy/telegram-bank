const TOKEN_KEY = "bank_vk_session";

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function tokenVkIdMatches(expectedVkId) {
  const t = getToken();
  if (!t || expectedVkId == null) return false;
  try {
    const payload = JSON.parse(atob(t.split(".")[1]));
    return String(payload.sub) === String(expectedVkId);
  } catch {
    return false;
  }
}

export function isTokenLikelyValid() {
  const t = getToken();
  if (!t) return false;
  try {
    const payload = JSON.parse(atob(t.split(".")[1]));
    if (!payload.exp) return false;
    return payload.exp * 1000 > Date.now() + 5000;
  } catch {
    return false;
  }
}

export async function apiFetch(input, init = {}) {
  const headers = { ...(init.headers || {}), ...authHeaders() };
  if (init.body && typeof init.body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent("bank-pin-required"));
  }
  return res;
}
