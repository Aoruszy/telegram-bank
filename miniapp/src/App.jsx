import { useCallback, useEffect, useState } from "react";
import bridge from "@vkontakte/vk-bridge";
import {
  apiFetch,
  clearToken,
  getToken,
  isTokenLikelyValid,
  setToken,
  tokenVkIdMatches,
} from "./api.js";
import {
  sanitizeDigitsOnly,
  validateAccountName,
  validateAmount,
  validateMessage,
  validatePin,
  validateRequired,
} from "./validation.js";

const API_BASE = (import.meta.env.VITE_API_BASE || window.location.origin).replace(/\/$/, "");

function launchParamsFromSearch() {
  const q = new URLSearchParams(window.location.search);
  const o = {};
  for (const [k, v] of q) o[k] = v;
  return o;
}

function normalizeRussianPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    return `+7${digits}`;
  }

  return String(phone || "").trim();
}

function isValidRussianPhone(phone) {
  return /^\+7\d{10}$/.test(normalizeRussianPhone(phone));
}

const TRANSFER_DRAFT_KEY = "zfbank_transfer_draft";

function saveTransferDraft(draft) {
  try {
    window.localStorage.setItem(TRANSFER_DRAFT_KEY, JSON.stringify(draft || {}));
  } catch {
    /* no-op */
  }
}

function readTransferDraft() {
  try {
    const raw = window.localStorage.getItem(TRANSFER_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function clearTransferDraft() {
  try {
    window.localStorage.removeItem(TRANSFER_DRAFT_KEY);
  } catch {
    /* no-op */
  }
}

function useViewportWidth() {
  const getWidth = () => (typeof window === "undefined" ? 1280 : window.innerWidth);
  const [width, setWidth] = useState(getWidth);

  useEffect(() => {
    const onResize = () => setWidth(getWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return width;
}

const pinGateWrap = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px 16px",
  boxSizing: "border-box",
};

const pinGateCard = {
  width: "100%",
  maxWidth: "360px",
  background: "#121d2c",
  borderRadius: "20px",
  padding: "24px",
  border: "1px solid #1f3248",
  boxSizing: "border-box",
};

const pinGateTitle = {
  fontSize: "clamp(20px, 5vw, 24px)",
  fontWeight: "700",
  marginBottom: "8px",
  color: "#eef4ff",
};

const pinGateHint = {
  fontSize: "14px",
  color: "#aab9cc",
  marginBottom: "20px",
};

const pinInput = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0f1927",
  color: "#eef4ff",
  border: "1px solid #263b55",
  borderRadius: "12px",
  padding: "16px",
  fontSize: "22px",
  letterSpacing: "0.2em",
  textAlign: "center",
  outline: "none",
};

const pinGateErr = {
  marginTop: "14px",
  color: "#ff8a8a",
  fontSize: "14px",
};

const pinGateSubmit = {
  width: "100%",
  marginTop: "20px",
  background: "#2a5f96",
  color: "#ffffff",
  border: "none",
  borderRadius: "14px",
  padding: "14px",
  fontSize: "16px",
  cursor: "pointer",
};

function PinGate({ vkContext, userData, onSuccess }) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const setup = !userData.pin_set;

  const submitSetup = async () => {
    setErr("");
    const e1 = validatePin(pin);
    const e2 = validatePin(pin2);
    if (e1 || e2) {
      setErr(e1 || e2);
      return;
    }
    if (pin !== pin2) {
      setErr("PIN Рё РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ РЅРµ СЃРѕРІРїР°РґР°СЋС‚");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/vk/pin/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          launch_params: vkContext.launchParams,
          pin,
          pin_confirm: pin2,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.detail === "string" ? data.detail : "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ PIN");
        setLoading(false);
        return;
      }
      setToken(data.access_token);
      onSuccess();
    } catch {
      setErr("РћС€РёР±РєР° СЃРµС‚Рё");
    }
    setLoading(false);
  };

  const submitLogin = async () => {
    setErr("");
    const e1 = validatePin(pin);
    if (e1) {
      setErr(e1);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/vk/pin/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          launch_params: vkContext.launchParams,
          pin,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data.detail;
        setErr(typeof d === "string" ? d : "РќРµРІРµСЂРЅС‹Р№ PIN");
        setLoading(false);
        return;
      }
      setToken(data.access_token);
      onSuccess();
    } catch {
      setErr("РћС€РёР±РєР° СЃРµС‚Рё");
    }
    setLoading(false);
  };

  return (
    <div className="app-shell" style={pinGateWrap}>
      <div style={pinGateCard}>
        <div style={pinGateTitle}>{setup ? "РџСЂРёРґСѓРјР°Р№С‚Рµ PIN-РєРѕРґ" : "Р’РІРµРґРёС‚Рµ PIN-РєРѕРґ"}</div>
        <div style={pinGateHint}>4вЂ“6 С†РёС„СЂ. РќРµ СЃРѕРѕР±С‰Р°Р№С‚Рµ РєРѕРґ РЅРёРєРѕРјСѓ.</div>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          style={pinInput}
          value={pin}
          onChange={(e) => setPin(sanitizeDigitsOnly(e.target.value))}
          placeholder="вЂўвЂўвЂўвЂў"
          aria-label="PIN"
        />
        {setup && (
          <input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            style={{ ...pinInput, marginTop: 12 }}
            value={pin2}
            onChange={(e) => setPin2(sanitizeDigitsOnly(e.target.value))}
            placeholder="РџРѕРІС‚РѕСЂРёС‚Рµ PIN"
            aria-label="РџРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ PIN"
          />
        )}
        {err && <div style={pinGateErr}>{err}</div>}
        <button
          type="button"
          style={{ ...pinGateSubmit, opacity: loading ? 0.7 : 1 }}
          disabled={loading}
          onClick={setup ? submitSetup : submitLogin}
        >
          {loading ? "РџСЂРѕРІРµСЂРєР°вЂ¦" : setup ? "РЎРѕС…СЂР°РЅРёС‚СЊ Рё РІРѕР№С‚Рё" : "Р’РѕР№С‚Рё"}
        </button>
      </div>
    </div>
  );
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatOperationDate(value) {
  if (!value) return "Р‘РµР· РґР°С‚С‹";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function categoryLabelRu(category) {
  const map = {
    transfer: "РџРµСЂРµРІРѕРґ",
    shopping: "РџРѕРєСѓРїРєРё",
    subscription: "РџРѕРґРїРёСЃРєРё",
    topup: "РџРѕРїРѕР»РЅРµРЅРёРµ",
    services: "РЈСЃР»СѓРіРё",
    commission: "РљРѕРјРёСЃСЃРёСЏ",
    other: "РџСЂРѕС‡РµРµ",
  };
  return map[category] || "РћРїРµСЂР°С†РёСЏ";
}

function repairMojibake(value) {
  if (typeof value !== "string" || !value) return value;

  const decodeUnicodeEscapes = (input) => {
    if (!/\\u[0-9a-fA-F]{4}/.test(input)) return input;
    try {
      return input.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
    } catch {
      return input;
    }
  };

  const score = (input) => {
    const cyrillic = (input.match(/[РЂ-Уї]/g) || []).length;
    const latin = (input.match(/[A-Za-z]/g) || []).length;
    const broken = (input.match(/[?пїЅ]/g) || []).length;
    return cyrillic * 3 + latin - broken * 4;
  };

  const tryDecode = (input) => {
    try {
      const bytes = Uint8Array.from([...input].map((char) => char.charCodeAt(0) & 255));
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      return input;
    }
  };

  let normalized = decodeUnicodeEscapes(value);
  for (let i = 0; i < 3; i += 1) {
    const candidate = tryDecode(normalized);
    if (!candidate || score(candidate) <= score(normalized)) break;
    normalized = candidate;
  }

  if (/vk\s*id/i.test(normalized) && /[?]/.test(normalized)) {
    const tail = normalized
      .replace(/.*vk\s*id/iu, "")
      .replace(/[?]+/g, " ")
      .replace(/^[^A-Za-zРЂ-Уї]+/u, "")
      .replace(/\s+/g, " ")
      .trim();
    return tail ? `РџРµСЂРµРІРѕРґ РїРѕ VK ID РєР»РёРµРЅС‚Сѓ ${tail}` : "РџРµСЂРµРІРѕРґ РїРѕ VK ID";
  }

  return normalized;
}


function extractReadableTail(value) {
  if (typeof value !== "string") return "";
  const normalized = repairMojibake(value).replace(/\s+/g, " ").trim();
  const match = normalized.match(/([A-Za-zРЂ-Уї-]+(?:\s+[A-Za-zРЂ-Уї-]+){0,3})\s*$/u);
  return repairMojibake(match?.[1] || "").trim();
}



function humanizeOperationTitle(title, operationType) {
  const normalized = repairMojibake(title || "").trim();
  if (!normalized) {
    return operationType === "income" ? "РџРѕРїРѕР»РЅРµРЅРёРµ СЃС‡С‘С‚Р°" : "РћРїРµСЂР°С†РёСЏ РїРѕ СЃС‡С‘С‚Сѓ";
  }
  const lower = normalized.toLowerCase();
  if (lower.includes("vk id") || lower.includes("vkid")) {
    let recipientName = extractReadableTail(normalized);
    recipientName = recipientName
      .replace(/.*vk\s*id\s*/i, "")
      .replace(/^(РєР»РёРµРЅС‚Сѓ|РѕС‚)\s+/i, "")
      .replace(/РїРµСЂРµРІРѕРґ\s+РїРѕ\s+vk\s*id/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (operationType === "income") {
      return recipientName ? `РџРµСЂРµРІРѕРґ РїРѕ VK ID РѕС‚ ${recipientName}` : "РџРµСЂРµРІРѕРґ РїРѕ VK ID";
    }
    return recipientName ? `РџРµСЂРµРІРѕРґ РїРѕ VK ID РєР»РёРµРЅС‚Сѓ ${recipientName}` : "РџРµСЂРµРІРѕРґ РїРѕ VK ID";
  }
  return normalized;
}




function deriveRecentRecipients(operations) {
  const seen = new Set();
  const result = [];

  for (const item of operations || []) {
    if (item?.category !== "transfer" || item?.operation_type !== "expense") continue;

    const title = humanizeOperationTitle(item.title, item.operation_type) || "";
    const match = title.match(/РєР»РёРµРЅС‚Сѓ\s+(.+)$/i);
    const recipientName = repairMojibake(match?.[1] || "").trim();
    if (!recipientName) continue;

    const key = recipientName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      id: item.id,
      recipientName,
      amount: Number(item.amount || 0),
      date: item.created_at,
      title,
    });
  }

  return result.slice(0, 4);
}

function getPrimaryAccount(accounts) {
  const normalized = Array.isArray(accounts) ? accounts : [];
  return normalized.find((account) => account?.is_primary) || normalized[0] || null;
}

function getPrimaryCard(cards) {
  const normalized = Array.isArray(cards) ? cards : [];
  return normalized.find((card) => card?.is_primary_account_card) || normalized[0] || null;
}

function serviceRequestStatusTone(status) {
  const normalized = repairMojibake(status || "");
  if (normalized.includes("Р’С‹Рї")) {
    return {
      background: "rgba(95, 194, 129, 0.14)",
      border: "1px solid rgba(95, 194, 129, 0.28)",
      color: "#9ee2b0",
    };
  }

  if (normalized.includes("РћС‚РєР»РѕРЅ")) {
    return {
      background: "rgba(255, 107, 107, 0.14)",
      border: "1px solid rgba(255, 107, 107, 0.28)",
      color: "#ffb1b1",
    };
  }

  return {
    background: "rgba(122, 184, 255, 0.12)",
    border: "1px solid rgba(122, 184, 255, 0.22)",
    color: "#dcecff",
  };
}

function applicationStatusTone(status) {
  const normalized = repairMojibake(status || "").toLowerCase();
  if (normalized.includes("РѕРґРѕР±СЂ")) {
    return { background: "rgba(95, 194, 129, 0.14)", border: "1px solid rgba(95, 194, 129, 0.28)", color: "#9ee2b0" };
  }
  if (normalized.includes("РѕС‚РєР»")) {
    return { background: "rgba(255, 107, 107, 0.14)", border: "1px solid rgba(255, 107, 107, 0.28)", color: "#ffb1b1" };
  }
  return { background: "rgba(122, 184, 255, 0.12)", border: "1px solid rgba(122, 184, 255, 0.22)", color: "#dcecff" };
}

function App() {
  const viewportWidth = useViewportWidth();
  const isCompact = viewportWidth <= 860;
  const [vkContext, setVkContext] = useState(null);
  const [vkInitError, setVkInitError] = useState(null);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await bridge.send("VKWebAppInit");
      } catch (e) {
        console.warn("VKWebAppInit", e);
      }
      try {
        await bridge.send("VKWebAppExpand");
      } catch (e) {
        console.warn("VKWebAppExpand", e);
      }
      let lp = launchParamsFromSearch();
      const devId = import.meta.env.VITE_DEV_VK_USER_ID;
      if (!lp.vk_user_id && devId) {
        lp = {
          ...lp,
          vk_user_id: String(devId),
          vk_app_id: import.meta.env.VITE_VK_APP_ID || "0",
          vk_is_app_user: "1",
        };
      }
      let fullName = "";
      let phone = null;
      try {
        const u = await bridge.send("VKWebAppGetUserInfo");
        if (u && !cancelled) {
          fullName = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
        }
      } catch (_) {
        /* РІРЅРµ VK РёР»Рё РЅРµС‚ РїСЂР°РІ */
      }
      if (cancelled) return;
      if (!lp.vk_user_id) {
        setVkInitError(
          "РћС‚РєСЂРѕР№С‚Рµ РјРёРЅРё-РїСЂРёР»РѕР¶РµРЅРёРµ РІРѕ Р’РљРѕРЅС‚Р°РєС‚Рµ РёР»Рё Р·Р°РґР°Р№С‚Рµ VITE_DEV_VK_USER_ID РґР»СЏ Р»РѕРєР°Р»СЊРЅРѕР№ РѕС‚Р»Р°РґРєРё."
        );
        return;
      }
      setVkContext({ launchParams: lp, fullName, phone });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [userData, setUserData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [cards, setCards] = useState([]);
  const [operations, setOperations] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [activeTab, setActiveTab] = useState("home");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [selectedOperationId, setSelectedOperationId] = useState(null);
  const [pinSessionReady, setPinSessionReady] = useState(() => isTokenLikelyValid() && !!getToken());

  useEffect(() => {
    const onPinRequired = () => setPinSessionReady(false);
    window.addEventListener("bank-pin-required", onPinRequired);
    return () => window.removeEventListener("bank-pin-required", onPinRequired);
  }, []);

  useEffect(() => {
    if (!vkContext) return;
    const vid = String(vkContext.launchParams.vk_user_id);
    if (getToken() && !tokenVkIdMatches(vid)) {
      clearToken();
      setPinSessionReady(false);
    } else if (isTokenLikelyValid() && tokenVkIdMatches(vid)) {
      setPinSessionReady(true);
    } else {
      setPinSessionReady(false);
    }
  }, [vkContext]);

  const doVkAuth = useCallback(async () => {
    if (!vkContext) return;
    try {
      setAuthError(null);
      const userRes = await fetch(`${API_BASE}/auth/vk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          launch_params: vkContext.launchParams,
          full_name: vkContext.fullName,
          phone: vkContext.phone,
        }),
      });
      const userJson = await userRes.json().catch(() => ({}));
      if (!userRes.ok || !userJson.user) {
        setUserData(null);
        setAuthError(
          typeof userJson.detail === "string"
            ? userJson.detail
            : "РќРµ СѓРґР°Р»РѕСЃСЊ Р°РІС‚РѕСЂРёР·РѕРІР°С‚СЊСЃСЏ РІ VK Mini App"
        );
        return;
      }
      setUserData(userJson.user);
    } catch (err) {
      console.error(err);
      setAuthError("РћС€РёР±РєР° СЃРµС‚Рё РїСЂРё Р°РІС‚РѕСЂРёР·Р°С†РёРё");
    }
  }, [vkContext]);

  const loadBankData = useCallback(async () => {
    if (!vkContext || !isTokenLikelyValid()) return;
    const vkId = String(vkContext.launchParams.vk_user_id);
    if (!tokenVkIdMatches(vkId)) return;
    try {
      const accountsRes = await apiFetch(`${API_BASE}/users/${vkId}/accounts`);
      const accountsJson = await accountsRes.json();
      setAccounts(Array.isArray(accountsJson) ? accountsJson : []);

      const cardsRes = await apiFetch(`${API_BASE}/users/${vkId}/cards`);
      const cardsJson = await cardsRes.json();
      setCards(Array.isArray(cardsJson) ? cardsJson : []);

      const operationsRes = await apiFetch(`${API_BASE}/users/${vkId}/operations`);
      const operationsJson = await operationsRes.json();
      setOperations(Array.isArray(operationsJson) ? operationsJson : []);

      const analyticsRes = await apiFetch(`${API_BASE}/users/${vkId}/expense-analytics`);
      const analyticsJson = await analyticsRes.json();
      setAnalytics(analyticsJson);

      const notifRes = await apiFetch(`${API_BASE}/users/${vkId}/notifications`);
      const notifJson = await notifRes.json();
      setNotifications(Array.isArray(notifJson) ? notifJson : []);

      const favoritesRes = await apiFetch(`${API_BASE}/users/${vkId}/favorites`);
      const favoritesJson = await favoritesRes.json();
      setFavorites(Array.isArray(favoritesJson) ? favoritesJson : []);
    } catch (err) {
      console.error("РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РґР°РЅРЅС‹С…:", err);
    }
  }, [vkContext]);

  useEffect(() => {
    if (!vkContext) return;
    doVkAuth();
  }, [vkContext, doVkAuth]);

  useEffect(() => {
    if (!vkContext || !userData || !pinSessionReady) return;
    loadBankData();
  }, [vkContext, userData, pinSessionReady, refreshKey, loadBankData]);

  const onPinSuccess = useCallback(() => {
    setPinSessionReady(true);
  }, []);

  const resetPinSession = useCallback(() => {
    clearToken();
    setPinSessionReady(false);
  }, []);

  if (vkInitError) {
    return (
      <div className="app-shell" style={loading}>
        {vkInitError}
      </div>
    );
  }
  if (!vkContext) {
    return (
      <div className="app-shell" style={loading}>
        Р—Р°РіСЂСѓР·РєР°...
      </div>
    );
  }
  if (authError && !userData) {
    return <div className="app-shell" style={loading}>{authError}</div>;
  }
  if (!userData) {
    return (
      <div className="app-shell" style={loading}>
        Р—Р°РіСЂСѓР·РєР°...
      </div>
    );
  }
  if (!pinSessionReady) {
    return <PinGate vkContext={vkContext} userData={userData} onSuccess={onPinSuccess} />;
  }

  const vkId = String(vkContext.launchParams.vk_user_id);

  return (
    <div
      className="app-shell"
      style={isCompact ? { ...page, padding: "12px 12px calc(92px + env(safe-area-inset-bottom, 0px))" } : page}
    >
      {activeTab === "home" && (
        <HomeScreen
          userData={userData}
          accounts={accounts}
          cards={cards}
          operations={operations}
          analytics={analytics}
          notifications={notifications}
          setActiveTab={setActiveTab}
          isCompact={isCompact}
          onToggleBalance={() => setActiveTab("settings")}
          onOpenOperation={(operationId) => {
            setSelectedOperationId(operationId);
            setActiveTab("operationDetails");
          }}
        />
      )}

      {activeTab === "payments" && (
        <PaymentsScreen
          setActiveTab={setActiveTab}
          favorites={favorites}
          operations={operations}
          accounts={accounts}
          cards={cards}
        />
      )}

      {activeTab === "chat" && (
        <ChatScreenSafe vkId={vkId} />
      )}

      {activeTab === "more" && (
        <MoreScreen setActiveTab={setActiveTab} />
      )}

      {activeTab === "accounts" && (
        <AccountsScreen
          accounts={accounts}
          cards={cards}
          setActiveTab={setActiveTab}
          onCardOpen={(cardId) => {
            setSelectedCardId(cardId);
            setActiveTab("cardDetails");
          }}
          hideBalance={userData.hide_balance}
        />
      )}

      {activeTab === "cards" && (
        <CardsScreen
          cards={cards}
          onActionDone={() => setRefreshKey((prev) => prev + 1)}
          onCardOpen={(cardId) => {
            setSelectedCardId(cardId);
            setActiveTab("cardDetails");
          }}
        />
      )}

      {activeTab === "cardDetails" && selectedCardId && (
        <CardDetailsScreen
          cardId={selectedCardId}
          onBack={() => setActiveTab("cards")}
        />
      )}

      {activeTab === "operations" && (
        <OperationsScreen
          vkId={vkId}
          accounts={accounts}
          onOpenOperation={(operationId) => {
            setSelectedOperationId(operationId);
            setActiveTab("operationDetails");
          }}
        />
      )}

      {activeTab === "operationDetails" && selectedOperationId && (
        <OperationDetailsScreen
          vkId={vkId}
          operationId={selectedOperationId}
          onBack={() => setActiveTab("operations")}
          setActiveTab={setActiveTab}
        />
      )}

      {activeTab === "analytics" && (
        <AnalyticsScreen analytics={analytics} />
      )}

      {activeTab === "support" && (
        <SupportScreen setActiveTab={setActiveTab} />
      )}

      {activeTab === "safetyTips" && <SafetyTipsScreen />}

      {activeTab === "application" && (
        <ApplicationScreenSafe vkId={vkId} />
      )}

      {activeTab === "applications" && (
        <ApplicationsListScreenSafe vkId={vkId} />
      )}

      {activeTab === "transfer" && (
        <TransferScreen
          senderVkId={vkId}
          accounts={accounts}
          favorites={favorites}
          onTransferSuccess={() => setRefreshKey((prev) => prev + 1)}
          onFavoriteSaved={() => setRefreshKey((prev) => prev + 1)}
        />
      )}

      {activeTab === "internalTransfer" && (
        <InternalTransferScreen
          vkId={vkId}
          accounts={accounts}
          onSuccess={() => setRefreshKey((prev) => prev + 1)}
        />
      )}

      {activeTab === "topup" && (
        <TopUpScreenSafe vkId={vkId} accounts={accounts} onSuccess={() => setRefreshKey((prev) => prev + 1)} />
      )}

      {activeTab === "pay" && (
        <PayScreenSafe
          vkId={vkId}
          accounts={accounts}
          onSuccess={() => setRefreshKey((prev) => prev + 1)}
          onFavoriteSaved={() => setRefreshKey((prev) => prev + 1)}
        />
      )}

      {activeTab === "security" && (
        <SecurityScreen
          vkId={vkId}
          userData={userData}
          cards={cards}
          onActionDone={() => setRefreshKey((prev) => prev + 1)}
          onRefresh={() => setRefreshKey((prev) => prev + 1)}
          setActiveTab={setActiveTab}
        />
      )}

      {activeTab === "serviceRequests" && (
        <ServiceRequestsScreenSafe vkId={vkId} />
      )}

      {activeTab === "faq" && <FaqScreen />}
      {activeTab === "callBank" && <CallBankScreen />}
      {activeTab === "problemReport" && (
        <ProblemReportScreenSafe vkId={vkId} />
      )}

      {activeTab === "interbankTransfer" && (
        <InterbankTransferScreen
          vkId={vkId}
          accounts={accounts}
          onSuccess={() => setRefreshKey((prev) => prev + 1)}
        />
      )}

      {activeTab === "createAccount" && (
        <CreateAccountScreen
          vkId={vkId}
          onSuccess={() => setRefreshKey((prev) => prev + 1)}
        />
      )}

      {activeTab === "notifications" && (
        <NotificationsScreen
          vkId={vkId}
          notifications={notifications}
          onRefresh={() => setRefreshKey((prev) => prev + 1)}
        />
      )}

      {activeTab === "favorites" && (
        <FavoritesScreen favorites={favorites} setActiveTab={setActiveTab} />
      )}

      {activeTab === "profile" && (
        <ProfileScreen
          vkId={vkId}
          userData={userData}
          isCompact={isCompact}
          onRefresh={() => setRefreshKey((prev) => prev + 1)}
          setActiveTab={setActiveTab}
        />
      )}

      {activeTab === "settings" && (
        <SettingsScreen
          vkId={vkId}
          userData={userData}
          onRefresh={() => setRefreshKey((prev) => prev + 1)}
          onLogout={resetPinSession}
        />
      )}

      {activeTab === "onboarding" && (
        <OnboardingScreen
          vkId={vkId}
          onDone={() => setRefreshKey((prev) => prev + 1)}
        />
      )}

      <div
        style={
          isCompact
            ? { ...bottomNav, width: "calc(100% - 12px)", bottom: "max(0px, env(safe-area-inset-bottom, 0px))" }
            : bottomNav
        }
      >
        <NavItem
          icon="рџЏ "
          label="Р“Р»Р°РІРЅР°СЏ"
          active={activeTab === "home"}
          onClick={() => setActiveTab("home")}
        />
        <NavItem
          icon="рџ’ё"
          label="РџР»Р°С‚РµР¶Рё"
          active={activeTab === "payments"}
          onClick={() => setActiveTab("payments")}
        />
        <NavItem
          icon="рџ’¬"
          label="Р§Р°С‚"
          active={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
        />
        <NavItem
          icon="в°"
          label="Р•С‰Рµ"
          active={activeTab === "more"}
          onClick={() => setActiveTab("more")}
        />
      </div>
    </div>
  );
}

function HomeScreen({
  userData,
  accounts,
  cards,
  operations,
  analytics,
  notifications,
  setActiveTab,
  isCompact,
  onOpenOperation,
}) {
  const mainAccount = getPrimaryAccount(accounts);
  const mainCard = getPrimaryCard(cards);
  const totalExpenses = Number(analytics?.total_expenses || 0);
  const categories = analytics?.categories || {};
  const unreadCount = notifications.filter((item) => !item.is_read).length;
  const latestNotification = notifications[0];
  const latestOperations = operations.slice(0, 6);
  const totalBalance = accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const visibleBalance = userData.hide_balance ? "вЂўвЂўвЂўвЂўвЂўвЂў в‚Ѕ" : `${formatMoney(totalBalance)} в‚Ѕ`;
  const primaryCategory = Object.entries(categories)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 3)
    .map(([key, value]) => ({ key, value: Number(value || 0) }));
  const incomeThisMonth = operations.filter((item) => item.operation_type === "income").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenseThisMonth = operations.filter((item) => item.operation_type === "expense").reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return (
    <>
      {!userData.onboarding_completed && (
        <div style={onboardingBanner} onClick={() => setActiveTab("onboarding")}>
          Р—Р°РІРµСЂС€РёС‚Рµ РЅР°СЃС‚СЂРѕР№РєСѓ РїСЂРѕС„РёР»СЏ, С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ РІРµСЃСЊ Р±Р°РЅРєРѕРІСЃРєРёР№ С„СѓРЅРєС†РёРѕРЅР°Р»
        </div>
      )}

      {!isCompact ? <div style={topBadge}>ZF BANK PREMIER</div> : null}

      <div style={isCompact ? { ...header, alignItems: "flex-start" } : header}>
        <div style={isCompact ? { ...headerIdentity, alignItems: "flex-start" } : headerIdentity}>
          <div style={avatar}>{userData.full_name ? userData.full_name[0].toUpperCase() : "U"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={headerEyebrow}>Р“Р»Р°РІРЅС‹Р№ СЌРєСЂР°РЅ</div>
            <div style={userName}>{repairMojibake(userData.full_name)}</div>
            <div style={userTag}>Р‘Р°РЅРє РІРѕ Р’РљРѕРЅС‚Р°РєС‚Рµ</div>
          </div>
        </div>
        <div style={isCompact ? { ...headerActionsWrap, flexShrink: 0 } : headerActionsWrap}>
          <div style={headerAction} onClick={() => setActiveTab("settings")}>вљ™</div>
          <div style={headerAction} onClick={() => setActiveTab("notifications")}>
            рџ””
            {unreadCount > 0 && <div style={badgeDot}>{unreadCount}</div>}
          </div>
        </div>
      </div>

      <div style={isCompact ? { ...search, marginBottom: "18px", padding: "15px 16px" } : search} onClick={() => setActiveTab("more")}>РџРѕРёСЃРє РїРµСЂРµРІРѕРґРѕРІ, РєР°СЂС‚, Р·Р°СЏРІРѕРє Рё СЃРµСЂРІРёСЃРѕРІ</div>

      <div style={premiumHomeLayout}>
        <div style={isCompact ? { ...premiumHeroCard, borderRadius: "26px", padding: "18px" } : premiumHeroCard}>
          <div style={premiumHeroGlow} />
          <div style={isCompact ? { ...premiumHeroTop, flexDirection: "column", alignItems: "stretch" } : premiumHeroTop}>
            <div>
              <div style={premiumKicker}>Р”РѕСЃС‚СѓРїРЅРѕ РЅР° РІСЃРµС… СЃС‡РµС‚Р°С…</div>
              <div style={isCompact ? { ...premiumBalance, fontSize: "clamp(28px, 10vw, 40px)" } : premiumBalance}>{visibleBalance}</div>
              <div style={premiumHeroSub}>РћСЃРЅРѕРІРЅРѕР№ СЃС‡С‘С‚: {repairMojibake(mainAccount?.account_name) || "Р•С‰С‘ РЅРµ РѕС‚РєСЂС‹С‚"}</div>
            </div>
            <div style={isCompact ? { ...premiumHeroBadge, alignSelf: "flex-start" } : premiumHeroBadge}>{accounts.length} {accounts.length === 1 ? "СЃС‡С‘С‚" : accounts.length < 5 ? "СЃС‡С‘С‚Р°" : "СЃС‡РµС‚РѕРІ"}</div>
          </div>

          <div style={isCompact ? { ...premiumHeroMetrics, gridTemplateColumns: "1fr" } : premiumHeroMetrics}>
            <div style={premiumMetricCard}><div style={premiumMetricLabel}>Р Р°СЃС…РѕРґС‹ Р·Р° РјРµСЃСЏС†</div><div style={premiumMetricValue}>{formatMoney(totalExpenses)} в‚Ѕ</div></div>
            <div style={premiumMetricCard}><div style={premiumMetricLabel}>РџРѕСЃС‚СѓРїР»РµРЅРёСЏ</div><div style={premiumMetricValue}>{formatMoney(incomeThisMonth)} в‚Ѕ</div></div>
            <div style={premiumMetricCard}><div style={premiumMetricLabel}>РђРєС‚РёРІРЅР°СЏ РєР°СЂС‚Р°</div><div style={premiumMetricValue}>{mainCard?.card_number_mask || "Р‘РµР· РєР°СЂС‚С‹"}</div></div>
          </div>

          <div style={isCompact ? { ...premiumActionStrip, gridTemplateColumns: "1fr" } : premiumActionStrip}>
             <div style={premiumActionPill} onClick={() => setActiveTab("transfer")}><span style={premiumActionIcon}>в†’</span><div><div style={premiumActionTitle}>РџРµСЂРµРІРѕРґ РїРѕ VK ID</div><div style={premiumActionMeta}>РћСЃРЅРѕРІРЅРѕР№ СЃС†РµРЅР°СЂРёР№ Р±Р°РЅРєР°</div></div></div>
             <div style={premiumActionPill} onClick={() => setActiveTab("internalTransfer")}><span style={premiumActionIcon}>в‡„</span><div><div style={premiumActionTitle}>РњРµР¶РґСѓ СЃРІРѕРёРјРё СЃС‡РµС‚Р°РјРё</div><div style={premiumActionMeta}>Р‘С‹СЃС‚СЂРѕРµ РїРµСЂРµРјРµС‰РµРЅРёРµ РґРµРЅРµРі РІРЅСѓС‚СЂРё Р±Р°РЅРєР°</div></div></div>
             <div style={premiumActionPill} onClick={() => setActiveTab("cards")}><span style={premiumActionIcon}>рџ’і</span><div><div style={premiumActionTitle}>РњРѕРё РєР°СЂС‚С‹</div><div style={premiumActionMeta}>РљР°СЂС‚С‹ РїСЂРёРІСЏР·Р°РЅС‹ Рє РѕСЃРЅРѕРІРЅРѕРјСѓ СЃС‡РµС‚Сѓ</div></div></div>
             <div style={premiumActionPill} onClick={() => setActiveTab("analytics")}><span style={premiumActionIcon}>%</span><div><div style={premiumActionTitle}>РђРЅР°Р»РёС‚РёРєР°</div><div style={premiumActionMeta}>Р Р°Р·Р±РѕСЂ СЂР°СЃС…РѕРґРѕРІ Рё РєР°С‚РµРіРѕСЂРёР№</div></div></div>
           </div>
        </div>

        <div style={premiumAsideCard}>
          <div style={sectionHeader}><div style={screenSubtitle}>РЎС‡РµС‚Р° Рё РїСЂРѕРґСѓРєС‚С‹</div><button style={miniButton} onClick={() => setActiveTab("accounts")}>РћС‚РєСЂС‹С‚СЊ</button></div>
          {accounts.length === 0 ? <div style={emptyBlock}>РџРѕРєР° РЅРµС‚ Р°РєС‚РёРІРЅС‹С… СЃС‡РµС‚РѕРІ</div> : <div style={premiumAccountStack}>{accounts.slice(0, 4).map((account) => <div key={account.id} style={premiumAccountRow} onClick={() => setActiveTab("accounts")}><div><div style={premiumAccountTitle}>{repairMojibake(account.account_name)}</div><div style={premiumAccountMeta}>{account.status}</div></div><div style={premiumAccountAmount}>{userData.hide_balance ? "вЂўвЂўвЂўвЂўвЂўвЂў в‚Ѕ" : `${formatMoney(account.balance)} в‚Ѕ`}</div></div>)}</div>}
        </div>

        <div style={premiumSectionBlock}>
          <div style={sectionHeader}>
            <div><div style={screenSubtitle}>РџРѕСЃР»РµРґРЅРёРµ РѕРїРµСЂР°С†РёРё</div><div style={sectionLead}>Р–РёРІР°СЏ Р»РµРЅС‚Р° СЂР°СЃС…РѕРґРѕРІ, РїРѕРїРѕР»РЅРµРЅРёР№ Рё РїРµСЂРµРІРѕРґРѕРІ РїРѕ РІР°С€РµРјСѓ РїСЂРѕС„РёР»СЋ.</div></div>
            <button style={miniButton} onClick={() => setActiveTab("operations")}>Р’СЃРµ РѕРїРµСЂР°С†РёРё</button>
          </div>
          {latestOperations.length === 0 ? (
            <div style={emptyBlock}>РЈ РІР°СЃ РїРѕРєР° РЅРµС‚ РѕРїРµСЂР°С†РёР№. РџРµСЂРІР°СЏ Р°РєС‚РёРІРЅРѕСЃС‚СЊ РїРѕСЏРІРёС‚СЃСЏ СЃСЂР°Р·Сѓ РїРѕСЃР»Рµ РїРµСЂРµРІРѕРґР° РёР»Рё РѕРїР»Р°С‚С‹.</div>
          ) : (
            <div style={premiumOperationsList}>
              {latestOperations.map((item) => (
                <div key={item.id} style={premiumOperationRow} onClick={() => onOpenOperation ? onOpenOperation(item.id) : setActiveTab("operations")}>
                  <div style={premiumOperationIcon}>{item.operation_type === "income" ? "в†“" : "в†‘"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={premiumOperationTitle}>{humanizeOperationTitle(item.title, item.operation_type)}</div>
                    <div style={premiumOperationMeta}>{categoryLabelRu(item.category)} В· {formatOperationDate(item.created_at)}</div>
                  </div>
                  <div style={item.operation_type === "income" ? premiumIncomeAmount : premiumExpenseAmount}>{item.operation_type === "income" ? "+" : "в€’"}{formatMoney(item.amount)} в‚Ѕ</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={isCompact ? { ...premiumHighlightsGrid, gridTemplateColumns: "1fr" } : premiumHighlightsGrid}>
          <div style={premiumInfoCard}>
            <div style={premiumInfoLabel}>РќР° С‡С‚Рѕ СѓС…РѕРґСЏС‚ РґРµРЅСЊРіРё</div>
            {primaryCategory.length === 0 ? <div style={premiumInfoValue}>РљР°С‚РµРіРѕСЂРёРё РїРѕСЏРІСЏС‚СЃСЏ РїРѕСЃР»Рµ РїРµСЂРІС‹С… СЂР°СЃС…РѕРґРѕРІ</div> : <div style={premiumTagRow}>{primaryCategory.map((item) => <div key={item.key} style={premiumTag}>{categoryLabelRu(item.key)} В· {formatMoney(item.value)} в‚Ѕ</div>)}</div>}
          </div>
          <div style={premiumInfoCard}>
            <div style={premiumInfoLabel}>Р Р°СЃС…РѕРґС‹ Рё РїРѕСЃС‚СѓРїР»РµРЅРёСЏ</div>
            <div style={premiumDualStat}>
              <div><div style={premiumDualLabel}>РџРѕСЃС‚СѓРїР»РµРЅРёСЏ</div><div style={premiumIncomeAmount}>+{formatMoney(incomeThisMonth)} в‚Ѕ</div></div>
              <div><div style={premiumDualLabel}>Р Р°СЃС…РѕРґС‹</div><div style={premiumExpenseAmount}>в€’{formatMoney(expenseThisMonth)} в‚Ѕ</div></div>
            </div>
          </div>
        </div>

        <div style={premiumAsideCard}>
          <div style={screenSubtitle}>Р‘С‹СЃС‚СЂС‹Рµ СЃС†РµРЅР°СЂРёРё</div>
          <div style={isCompact ? { ...premiumShortcutGrid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } : premiumShortcutGrid}>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("internalTransfer")}><div style={premiumShortcutIcon}>в‡„</div><div style={premiumShortcutTitle}>РЎРІРѕРё СЃС‡РµС‚Р°</div><div style={premiumShortcutMeta}>РџРµСЂРµРІРѕРґ РјРµР¶РґСѓ Р±Р°Р»Р°РЅСЃР°РјРё РІРЅСѓС‚СЂРё Р±Р°РЅРєР°</div></div>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("favorites")}><div style={premiumShortcutIcon}>в…</div><div style={premiumShortcutTitle}>РР·Р±СЂР°РЅРЅРѕРµ</div><div style={premiumShortcutMeta}>РЁР°Р±Р»РѕРЅС‹ Рё С‡Р°СЃС‚С‹Рµ РїРµСЂРµРІРѕРґС‹</div></div>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("application")}><div style={premiumShortcutIcon}>+</div><div style={premiumShortcutTitle}>Р—Р°СЏРІРєР°</div><div style={premiumShortcutMeta}>РћС‚РєСЂС‹С‚СЊ РЅРѕРІС‹Р№ РїСЂРѕРґСѓРєС‚</div></div>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("support")}><div style={premiumShortcutIcon}>?</div><div style={premiumShortcutTitle}>РџРѕРґРґРµСЂР¶РєР°</div><div style={premiumShortcutMeta}>Р§Р°С‚ Рё СЃРµСЂРІРёСЃРЅС‹Рµ Р·Р°РїСЂРѕСЃС‹</div></div>
          </div>
        </div>

        {latestNotification ? <div style={premiumNoticeCard} onClick={() => setActiveTab("notifications")}><div style={premiumNoticeKicker}>РџРѕСЃР»РµРґРЅРµРµ СѓРІРµРґРѕРјР»РµРЅРёРµ</div><div style={premiumNoticeTitle}>{repairMojibake(latestNotification.title)}</div><div style={premiumNoticeText}>{repairMojibake(latestNotification.message)}</div></div> : null}
        <div style={isCompact ? { ...premiumBannerCard, flexDirection: "column", alignItems: "flex-start" } : premiumBannerCard} onClick={() => setActiveTab("application")}><div><div style={premiumBannerTitle}>РќРѕРІС‹Р№ РїСЂРѕРґСѓРєС‚ РІ РѕРґРёРЅ С‚Р°Рї</div><div style={premiumBannerText}>РћС„РѕСЂРјРёС‚Рµ РєР°СЂС‚Сѓ РёР»Рё РѕС‚РєСЂРѕР№С‚Рµ СЃС‡С‘С‚ РїСЂСЏРјРѕ РёР· РјРёРЅРё-РїСЂРёР»РѕР¶РµРЅРёСЏ.</div></div><div style={premiumBannerIcon}>в†’</div></div>
      </div>
    </>
  );
}

function PaymentsScreen({ setActiveTab, favorites, operations, accounts, cards }) {
  const vkTemplates = (favorites || []).filter((item) => item.payment_type === "vk_transfer").slice(0, 4);
  const serviceTemplates = (favorites || []).filter((item) => item.payment_type === "service_payment").slice(0, 4);
  const recentRecipients = deriveRecentRecipients(operations);
  const activeCards = (cards || []).filter((card) => !repairMojibake(card?.status || "").toLowerCase().includes("Р±Р»РѕРє")).length;
  const totalBalance = (accounts || []).reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const primaryAccount = getPrimaryAccount(accounts);

  const openTransferDraft = (draft) => {
    saveTransferDraft(draft);
    setActiveTab("transfer");
  };

  return (
    <ScreenLayout title="РџР»Р°С‚РµР¶Рё Рё РїРµСЂРµРІРѕРґС‹">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>РџР»Р°С‚РµР¶РЅС‹Р№ С†РµРЅС‚СЂ</div>
        <div style={paymentsShowcaseTitle}>Р’СЃРµ РµР¶РµРґРЅРµРІРЅС‹Рµ РїРµСЂРµРІРѕРґС‹ Рё РїР»Р°С‚РµР¶Рё РІ РѕРґРЅРѕРј РјРµСЃС‚Рµ</div>
        <div style={paymentsShowcaseText}>РСЃРїРѕР»СЊР·СѓР№С‚Рµ РїРµСЂРµРІРѕРґС‹ РїРѕ VK ID, Р±С‹СЃС‚СЂС‹Рµ С€Р°Р±Р»РѕРЅС‹ Рё РїРѕРІС‚РѕСЂРЅС‹Рµ СЃС†РµРЅР°СЂРёРё Р±РµР· Р»РёС€РЅРёС… С€Р°РіРѕРІ.</div>
        <div style={paymentsShowcaseChipRow}>
          <div style={paymentsShowcaseChip}>РџРµСЂРµРІРѕРґ РїРѕ VK ID</div>
          <div style={paymentsShowcaseChip}>РЁР°Р±Р»РѕРЅС‹</div>
          <div style={paymentsShowcaseChip}>РћРїР»Р°С‚Р° СѓСЃР»СѓРі</div>
        </div>
      </div>

      <div style={paymentsFeatureGrid}>
        <div style={paymentsFeatureCardPrimary} onClick={() => setActiveTab("transfer")}>
          <div style={paymentsFeatureIcon}>в†’</div>
          <div style={paymentsFeatureTitle}>РџРµСЂРµРІРѕРґ РїРѕ VK ID</div>
          <div style={paymentsFeatureText}>Р“Р»Р°РІРЅС‹Р№ СЃС†РµРЅР°СЂРёР№ Р±Р°РЅРєР°: РЅР°Р№РґРёС‚Рµ РєР»РёРµРЅС‚Р° Рё РѕС‚РїСЂР°РІСЊС‚Рµ РґРµРЅСЊРіРё Р·Р° РїР°СЂСѓ С€Р°РіРѕРІ.</div>
        </div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("internalTransfer")}>
          <div style={paymentsFeatureIcon}>в‡„</div>
          <div style={paymentsFeatureTitle}>РњРµР¶РґСѓ СЃРІРѕРёРјРё СЃС‡РµС‚Р°РјРё</div>
          <div style={paymentsFeatureText}>Р‘С‹СЃС‚СЂРѕ РїРµСЂРµРІРµРґРёС‚Рµ РґРµРЅСЊРіРё РјРµР¶РґСѓ СЃРІРѕРёРјРё Р±Р°РЅРєРѕРІСЃРєРёРјРё СЃС‡РµС‚Р°РјРё.</div>
        </div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("topup")}>
          <div style={paymentsFeatureIcon}>+</div>
          <div style={paymentsFeatureTitle}>РџРѕРїРѕР»РЅРёС‚СЊ СЃС‡РµС‚</div>
          <div style={paymentsFeatureText}>Р‘С‹СЃС‚СЂРѕРµ РїРѕРїРѕР»РЅРµРЅРёРµ РєР°СЂС‚С‹ РёР»Рё Р±Р°РЅРєРѕРІСЃРєРѕРіРѕ СЃС‡РµС‚Р°.</div>
        </div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("pay")}>
          <div style={paymentsFeatureIcon}>в‚Ѕ</div>
          <div style={paymentsFeatureTitle}>РћРїР»Р°С‚Р° СѓСЃР»СѓРі</div>
          <div style={paymentsFeatureText}>РЎРІСЏР·СЊ, РєРѕРјРјСѓРЅР°Р»СЊРЅС‹Рµ СѓСЃР»СѓРіРё Рё СЂРµРіСѓР»СЏСЂРЅС‹Рµ РїР»Р°С‚РµР¶Рё.</div>
        </div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("favorites")}>
          <div style={paymentsFeatureIcon}>в…</div>
          <div style={paymentsFeatureTitle}>РР·Р±СЂР°РЅРЅРѕРµ</div>
          <div style={paymentsFeatureText}>РџРѕРІС‚РѕСЂСЏР№С‚Рµ РіРѕС‚РѕРІС‹Рµ СЃС†РµРЅР°СЂРёРё Р±РµР· СЂСѓС‡РЅРѕРіРѕ РІРІРѕРґР°.</div>
        </div>
      </div>

      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>РћСЃРЅРѕРІРЅРѕР№ СЃС‡РµС‚</div>
          <div style={premiumMetricValue}>{formatMoney(primaryAccount?.balance || 0)} в‚Ѕ</div>
          <div style={operationsSummaryMeta}>{repairMojibake(primaryAccount?.account_name || "РџРѕРєР° РЅРµ РѕС‚РєСЂС‹С‚")}</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>РђРєС‚РёРІРЅС‹Рµ РєР°СЂС‚С‹</div>
          <div style={premiumMetricValue}>{activeCards}</div>
          <div style={operationsSummaryMeta}>РњРѕР¶РЅРѕ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РґР»СЏ РѕРїР»Р°С‚С‹ Рё РїРµСЂРµРІРѕРґРѕРІ</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>РЁР°Р±Р»РѕРЅС‹</div>
          <div style={premiumMetricValue}>{favorites.length}</div>
          <div style={operationsSummaryMeta}>Р§Р°СЃС‚С‹Рµ СЃС†РµРЅР°СЂРёРё РґР»СЏ Р±С‹СЃС‚СЂРѕРіРѕ РїРѕРІС‚РѕСЂР°</div>
        </div>
      </div>

      <div style={premiumPanelGrid}>
        <div style={menuCard}>
          <div style={sectionHeader}>
            <div>
              <div style={screenSubtitle}>РџРѕСЃР»РµРґРЅРёРµ РїРѕР»СѓС‡Р°С‚РµР»Рё</div>
              <div style={sectionLead}>Р‘С‹СЃС‚СЂС‹Р№ РїРѕРІС‚РѕСЂ РЅРµРґР°РІРЅРёС… РїРµСЂРµРІРѕРґРѕРІ РїРѕ VK ID.</div>
            </div>
          </div>
          {recentRecipients.length === 0 ? (
            <div style={emptyBlock}>РџРѕРєР° РЅРµС‚ РЅРµРґР°РІРЅРёС… РїРµСЂРµРІРѕРґРѕРІ.</div>
          ) : (
            <div style={operationsList}>
              {recentRecipients.map((item, index) => (
                <div key={`${item.recipientName}-${index}`} style={premiumOperationRow} onClick={() => openTransferDraft({ recipientName: item.recipientName, amount: String(Math.round(Math.abs(item.amount))), comment: "" })}>
                  <div style={operationIcon}>в†’</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={premiumOperationTitle}>{item.recipientName}</div>
                    <div style={operationMeta}>РџРµСЂРµРІРѕРґ РЅР° {formatMoney(Math.abs(item.amount))} в‚Ѕ</div>
                  </div>
                  <button style={compactButton} onClick={(event) => { event.stopPropagation(); openTransferDraft({ recipientName: item.recipientName, amount: String(Math.round(Math.abs(item.amount))), comment: "" }); }}>РџРѕРІС‚РѕСЂРёС‚СЊ</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={menuCard}>
          <div style={sectionHeader}>
            <div>
              <div style={screenSubtitle}>РЁР°Р±Р»РѕРЅС‹ Рё СЃС†РµРЅР°СЂРёРё</div>
              <div style={sectionLead}>Р“РѕС‚РѕРІС‹Рµ РїРµСЂРµРІРѕРґС‹ Рё РѕРїР»Р°С‚С‹ СѓСЃР»СѓРі РґР»СЏ РµР¶РµРґРЅРµРІРЅС‹С… СЃС†РµРЅР°СЂРёРµРІ.</div>
            </div>
            <button style={miniButton} onClick={() => setActiveTab("favorites")}>Р’СЃРµ С€Р°Р±Р»РѕРЅС‹</button>
          </div>
          <div style={premiumTemplatesGrid}>
            {vkTemplates.map((item) => (
              <div key={`vk-template-${item.id}`} style={premiumShortcutCard} onClick={() => openTransferDraft({ recipientName: repairMojibake(item.recipient_name || ""), amount: String(item.amount || ""), comment: "" })}>
                <div style={premiumShortcutIcon}>в†’</div>
                <div style={premiumShortcutTitle}>{repairMojibake(item.recipient_name || "РџРµСЂРµРІРѕРґ РїРѕ VK ID")}</div>
                <div style={premiumShortcutMeta}>VK ID: {item.recipient_value}</div>
              </div>
            ))}
            {serviceTemplates.map((item) => (
              <div key={`service-template-${item.id}`} style={premiumShortcutCard} onClick={() => setActiveTab("pay")}>
                <div style={premiumShortcutIcon}>в‚Ѕ</div>
                <div style={premiumShortcutTitle}>{repairMojibake(item.title || "РћРїР»Р°С‚Р° СѓСЃР»СѓРіРё")}</div>
                <div style={premiumShortcutMeta}>{repairMojibake(item.provider_name || item.recipient_value || "РЎРµСЂРІРёСЃ")}</div>
              </div>
            ))}
            {vkTemplates.length === 0 && serviceTemplates.length === 0 ? <div style={emptyBlock}>РЁР°Р±Р»РѕРЅРѕРІ РїРѕРєР° РЅРµС‚.</div> : null}
          </div>
        </div>
      </div>
    </ScreenLayout>
  );
}





function ChatScreen({ vkId }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const quickTopics = [
    "РљР°Рє РїРѕРїРѕР»РЅРёС‚СЊ Р±Р°Р»Р°РЅСЃ?",
    "РљР°Рє РїРµСЂРµРІРµСЃС‚Рё РїРѕ VK ID?",
    "РљР°Рє РёР·РјРµРЅРёС‚СЊ PIN-РєРѕРґ?",
    "РЈ РјРµРЅСЏ РїСЂРѕР±Р»РµРјР° СЃ РєР°СЂС‚РѕР№",
  ];

  const loadMessages = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/support/messages/${vkId}`);
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setMessages([]);
    }
  };

  useEffect(() => {
    loadMessages();
  }, [vkId]);

  const sendMessage = async () => {
    const validationError = validateMessage(text);
    if (validationError) {
      setMessage(validationError);
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/support/ai-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vk_id: String(vkId), message: text.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ"));
        return;
      }
      setText("");
      setMessage(
        data.service_request
          ? `Р”РёР°Р»РѕРі РїРµСЂРµРґР°РЅ РѕРїРµСЂР°С‚РѕСЂСѓ: ${repairMojibake(data.service_request.request_type || "РѕР±СЂР°С‰РµРЅРёРµ")}`
          : ""
      );
      await loadMessages();
    } catch (error) {
      console.error(error);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  const clearChat = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/support/messages/${vkId}/clear`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‡РёСЃС‚РёС‚СЊ С‡Р°С‚"));
        return;
      }
      setMessages([]);
      setMessage("Р§Р°С‚ РѕС‡РёС‰РµРЅ");
    } catch (error) {
      console.error(error);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  return (
    <ScreenLayout title="Р§Р°С‚ РїРѕРґРґРµСЂР¶РєРё">
      <div style={menuCard}>
        <div style={sectionHeader}>
          <div>
            <div style={screenSubtitle}>Р‘С‹СЃС‚СЂС‹Рµ С‚РµРјС‹</div>
            <div style={sectionLead}>Р’С‹Р±РµСЂРёС‚Рµ РіРѕС‚РѕРІС‹Р№ РІРѕРїСЂРѕСЃ РёР»Рё РЅР°РїРёС€РёС‚Рµ СЃРІРѕР№.</div>
          </div>
          <button style={miniButton} onClick={clearChat}>РћС‡РёСЃС‚РёС‚СЊ С‡Р°С‚</button>
        </div>
        <div style={premiumTagRow}>
          {quickTopics.map((item) => (
            <button key={item} type="button" style={compactButton} onClick={() => setText(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>

      <div style={menuCard}>
        <div style={screenSubtitle}>Р”РёР°Р»РѕРі</div>
        <div style={sectionLead}>РСЃС‚РѕСЂРёСЏ РїРµСЂРµРїРёСЃРєРё СЃ AI-РїРѕРјРѕС‰РЅРёРєРѕРј Рё СЃРѕС‚СЂСѓРґРЅРёРєР°РјРё Р±Р°РЅРєР°.</div>
        {messages.length === 0 ? (
          <div style={emptyBlock}>Р§Р°С‚ РїРѕРєР° РїСѓСЃС‚. РќР°С‡РЅРёС‚Рµ РґРёР°Р»РѕРі РїРµСЂРІС‹Рј.</div>
        ) : (
          <div style={operationsList}>
            {messages.map((item) => {
              const senderLabel =
                repairMojibake(item.sender_label || "") ||
                (item.sender_type === "user"
                  ? "Р’С‹"
                  : item.sender_type === "operator"
                    ? "РћРїРµСЂР°С‚РѕСЂ"
                    : "AI-РїРѕРјРѕС‰РЅРёРє");

              return (
                <div key={item.id} style={menuCard}>
                  <div style={screenSubtitle}>{senderLabel}</div>
                  <div style={{ color: "#eaf1ff", marginTop: 8, lineHeight: 1.6 }}>
                    {repairMojibake(item.text || item.message || "")}
                  </div>
                  <div style={{ color: "#8ca0ba", fontSize: 13, marginTop: 8 }}>
                    {repairMojibake(item.created_at || "")}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={menuCard}>
        <div style={screenSubtitle}>РќРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ</div>
        <div style={sectionLead}>РћРїРёС€РёС‚Рµ РїСЂРѕР±Р»РµРјСѓ РёР»Рё Р·Р°РґР°Р№С‚Рµ РІРѕРїСЂРѕСЃ РїРѕ РєР°СЂС‚Р°Рј, РїРµСЂРµРІРѕРґР°Рј Рё РїСЂРѕРґСѓРєС‚Р°Рј.</div>
        <textarea
          style={{ ...textarea, minHeight: 140 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="РќР°РїСЂРёРјРµСЂ: РЅРµ РїСЂРѕС…РѕРґРёС‚ РїРµСЂРµРІРѕРґ РїРѕ VK ID"
        />
        {message ? <div style={messageBox}>{message}</div> : null}
        <button style={primaryButton} onClick={sendMessage}>РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ</button>
      </div>
    </ScreenLayout>
  );
}


function MoreScreen({ setActiveTab }) {
  return (
    <ScreenLayout title="Р•С‰С‘">
      <div style={premiumPanelGrid}>
        <MenuCard title="РџСЂРѕС„РёР»СЊ" subtitle="Р›РёС‡РЅС‹Рµ РґР°РЅРЅС‹Рµ, С‚РµРјР°, СЏР·С‹Рє" onClick={() => setActiveTab("profile")} />
        <MenuCard title="РњРѕРё РєР°СЂС‚С‹" subtitle="Р РµРєРІРёР·РёС‚С‹ Рё СѓРїСЂР°РІР»РµРЅРёРµ РєР°СЂС‚Р°РјРё" onClick={() => setActiveTab("cards")} />
        <MenuCard title="Р—Р°СЏРІРєРё" subtitle="РќРѕРІС‹Рµ РїСЂРѕРґСѓРєС‚С‹ Рё РёС… СЃС‚Р°С‚СѓСЃС‹" onClick={() => setActiveTab("applications")} />
        <MenuCard title="РћС‚РєСЂС‹С‚СЊ СЃС‡С‘С‚" subtitle="Р‘С‹СЃС‚СЂРѕРµ РѕС„РѕСЂРјР»РµРЅРёРµ РЅРѕРІРѕРіРѕ СЃС‡С‘С‚Р°" onClick={() => setActiveTab("createAccount")} />
        <MenuCard title="Р‘РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ" subtitle="PIN, РєР°СЂС‚С‹ Рё СЂРµРєРѕРјРµРЅРґР°С†РёРё" onClick={() => setActiveTab("security")} />
        <MenuCard title="РџРѕРґРґРµСЂР¶РєР°" subtitle="FAQ, С‡Р°С‚ Рё Р·Р°РїСЂРѕСЃС‹" onClick={() => setActiveTab("support")} />
        <MenuCard title="РќР°СЃС‚СЂРѕР№РєРё" subtitle="РўРµРјР°, СЏР·С‹Рє, СЃРєСЂС‹С‚РёРµ Р±Р°Р»Р°РЅСЃР°" onClick={() => setActiveTab("settings")} />
      </div>
    </ScreenLayout>
  );
}


function AccountsScreen({ accounts, cards, setActiveTab, onCardOpen, hideBalance }) {
  return (
    <ScreenLayout title="РњРѕРё СЃС‡РµС‚Р° Рё РєР°СЂС‚С‹">
      <div style={premiumPanelGrid}>
        <div style={menuCard}>
          <div style={screenSubtitle}>РЎС‡РµС‚Р°</div>
          {accounts.length === 0 ? <div style={emptyBlock}>РђРєС‚РёРІРЅС‹С… СЃС‡РµС‚РѕРІ РїРѕРєР° РЅРµС‚</div> : accounts.map((account) => (
            <div key={account.id} style={premiumOperationRow}>
              <div style={operationIcon}>в‚Ѕ</div>
              <div style={{ flex: 1 }}>
                <div style={premiumOperationTitle}>
                  {repairMojibake(account.account_name || "РЎС‡С‘С‚")}
                  {account.is_primary ? " В· РћСЃРЅРѕРІРЅРѕР№" : ""}
                </div>
                <div style={operationMeta}>{repairMojibake(account.status || "РђРєС‚РёРІРµРЅ")}</div>
              </div>
              <div style={premiumOperationAmount}>{hideBalance ? "вЂўвЂўвЂўвЂўвЂўвЂў в‚Ѕ" : `${formatMoney(account.balance)} в‚Ѕ`}</div>
            </div>
          ))}
        </div>
        <div style={menuCard}>
          <div style={sectionHeader}><div style={screenSubtitle}>РљР°СЂС‚С‹</div><button style={miniButton} onClick={() => setActiveTab("cards")}>РћС‚РєСЂС‹С‚СЊ</button></div>
          {cards.length === 0 ? <div style={emptyBlock}>РљР°СЂС‚ РїРѕРєР° РЅРµС‚</div> : cards.map((card) => (
            <div key={card.id} style={premiumOperationRow} onClick={() => onCardOpen(card.id)}>
              <div style={operationIcon}>рџ’і</div>
              <div style={{ flex: 1 }}>
                <div style={premiumOperationTitle}>{repairMojibake(card.card_name || "Р‘Р°РЅРєРѕРІСЃРєР°СЏ РєР°СЂС‚Р°")}</div>
                <div style={operationMeta}>{repairMojibake(card.card_number_mask || "0000 вЂўвЂўвЂўвЂў вЂўвЂўвЂўвЂў 0000")}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ScreenLayout>
  );
}




function CardsScreen({ cards, onActionDone, onCardOpen }) {
  const [message, setMessage] = useState("");

  const normalizedCards = (cards || []).map((card) => {
    const safeStatus = repairMojibake(card?.status) || "???????";
    return {
      ...card,
      safeName: repairMojibake(card?.card_name) || "?????????? ?????",
      safeMask: repairMojibake(card?.card_number_mask) || "0000 ???? ???? 0000",
      safeSystem: repairMojibake(card?.payment_system) || "???",
      safeStatus,
      safeLinkedAccountName: repairMojibake(card?.linked_account_name) || "???????? ????",
      isBlocked: safeStatus.toLowerCase().includes("????"),
    };
  });

  const featuredCard = normalizedCards.find((card) => card.is_primary_account_card) || normalizedCards[0] || null;
  const activeCards = normalizedCards.filter((card) => !card.isBlocked);

  const blockCard = async (cardId) => {
    try {
      const res = await apiFetch(`${API_BASE}/cards/${cardId}/block`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "?? ??????? ????????????? ?????"));
        return;
      }
      setMessage("????? ?????????????");
      onActionDone();
    } catch {
      setMessage("??????? ??????");
    }
  };

  const requestUnblock = async (cardId) => {
    try {
      const res = await apiFetch(`${API_BASE}/cards/${cardId}/request-unblock`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "?? ??????? ????????? ?????? ?? ?????????????"));
        return;
      }
      setMessage("?????? ?? ????????????? ?????????");
      onActionDone();
    } catch {
      setMessage("??????? ??????");
    }
  };

  return (
    <ScreenLayout title="??? ?????">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>????? ????</div>
          <div style={premiumMetricValue}>{normalizedCards.length}</div>
          <div style={operationsSummaryMeta}>??? ?????, ????????? ? ????? ???????.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>????????</div>
          <div style={premiumMetricValue}>{activeCards.length}</div>
          <div style={operationsSummaryMeta}>?????, ???????? ????? ???????????? ????? ??????.</div>
        </div>
      </div>

      {message ? <div style={messageBox}>{message}</div> : null}

      <div style={menuCard}>
        <div style={paymentsShowcaseEyebrow}>??????? ?????</div>
        {featuredCard ? (
          <>
            <div style={{ ...accountCard, minHeight: 0 }}>
              <div style={cardLogo}>{featuredCard.safeSystem}</div>
              <div style={accountCardLabel}>{featuredCard.safeName}</div>
              <div style={{ ...accountCardNumber, marginTop: 8 }}>{featuredCard.safeMask}</div>
              <div style={{ ...accountCardMeta, marginTop: 8 }}>
                {featuredCard.safeStatus} ? {featuredCard.safeLinkedAccountName}
              </div>
              <div style={{ ...accountCardAmount, marginTop: 12 }}>{formatMoney(featuredCard.balance || 0)} ?</div>
            </div>
            <div style={detailActionBar}>
              <button style={compactButton} onClick={() => onCardOpen(featuredCard.id)}>?????????</button>
              {!featuredCard.isBlocked ? (
                <button style={compactButton} onClick={() => blockCard(featuredCard.id)}>?????????????</button>
              ) : (
                <button style={compactButton} onClick={() => requestUnblock(featuredCard.id)}>????????? ?????????????</button>
              )}
            </div>
          </>
        ) : (
          <div style={emptyBlock}>? ??? ???? ??? ????. ???????? ????? ??????? ? ??????? ??????.</div>
        )}
      </div>

      <div style={accountCardsGrid}>
        {normalizedCards.map((card) => (
          <div key={card.id} style={accountCard} onClick={() => onCardOpen(card.id)}>
            <div style={cardLogo}>{card.safeSystem}</div>
            <div style={accountCardLabel}>{card.safeName}</div>
            <div style={accountCardNumber}>{card.safeMask}</div>
            <div style={accountCardMeta}>{card.safeStatus}</div>
            <div style={accountCardMeta}>{card.safeLinkedAccountName}</div>
            <div style={accountCardAmount}>{formatMoney(card.balance || 0)} ?</div>
            <div style={detailActionBar}>
              <button
                style={compactButton}
                onClick={(e) => {
                  e.stopPropagation();
                  onCardOpen(card.id);
                }}
              >
                ???????
              </button>
              {!card.isBlocked ? (
                <button
                  style={compactButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    blockCard(card.id);
                  }}
                >
                  ??????????
                </button>
              ) : (
                <button
                  style={compactButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    requestUnblock(card.id);
                  }}
                >
                  ??????????????
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ScreenLayout>
  );
}

function CardDetailsScreen({ cardId, onBack }) {
  const [cardData, setCardData] = useState(null);
  const [showFullNumber, setShowFullNumber] = useState(false);

  useEffect(() => {
    apiFetch(`${API_BASE}/cards/${cardId}`)
      .then((res) => res.json())
      .then((data) => setCardData(data))
      .catch((err) => console.error("Card load error:", err));
  }, [cardId]);

  if (!cardData) {
    return <div style={loading}>Р—Р°РіСЂСѓР·РєР°...</div>;
  }

  const requisites = cardData?.requisites || {};
  const title = repairMojibake(cardData?.card_name) || "Р‘Р°РЅРєРѕРІСЃРєР°СЏ РєР°СЂС‚Р°";
  const mask = repairMojibake(showFullNumber ? cardData?.full_card_number : cardData?.card_number_mask) || "0000 вЂўвЂўвЂўвЂў вЂўвЂўвЂўвЂў 0000";
  const status = repairMojibake(cardData?.status) || "РђРєС‚РёРІРЅР°";
  const paymentSystem = repairMojibake(cardData?.payment_system) || "РњРР ";
  const expiry = repairMojibake(cardData?.expiry_date) || "12/30";
  const linkedAccountName = repairMojibake(cardData?.linked_account_name) || "РћСЃРЅРѕРІРЅРѕР№ СЃС‡РµС‚";

  return (
    <ScreenLayout title="Р РµРєРІРёР·РёС‚С‹ РєР°СЂС‚С‹">
      <div style={menuCard}>
        <button style={{ ...compactButton, width: "fit-content" }} onClick={onBack}>в†ђ РќР°Р·Р°Рґ Рє РєР°СЂС‚Р°Рј</button>
        <div style={{ height: 16 }} />
        <div style={paymentsShowcaseCard}>
          <div style={paymentsShowcaseEyebrow}>Р”РµС‚Р°Р»Рё Рё СЃС‚Р°С‚СѓСЃ</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={paymentsShowcaseTitle}>{title}</div>
              <div style={paymentsShowcaseText}>{paymentSystem} вЂў {status} вЂў {linkedAccountName}</div>
              <div style={{ marginTop: 16, fontSize: 28, fontWeight: 800, color: "#f3f7ff" }}>{mask}</div>
              <div style={{ marginTop: 10, color: "#8ea8c6" }}>РЎСЂРѕРє РґРµР№СЃС‚РІРёСЏ: {expiry}</div>
              <div style={{ marginTop: 10, color: "#d8ecff", fontWeight: 700 }}>Р‘Р°Р»Р°РЅСЃ РєР°СЂС‚С‹: {formatMoney(cardData?.balance || 0)} в‚Ѕ</div>
            </div>
            <button style={compactButton} onClick={() => setShowFullNumber((prev) => !prev)}>{showFullNumber ? "РЎРєСЂС‹С‚СЊ РЅРѕРјРµСЂ" : "РџРѕРєР°Р·Р°С‚СЊ РЅРѕРјРµСЂ"}</button>
          </div>
        </div>
      </div>

      <div style={menuCard}>
        <div style={sectionHeader}>
          <div>
            <div style={screenSubtitle}>Р‘Р°РЅРєРѕРІСЃРєРёРµ СЂРµРєРІРёР·РёС‚С‹</div>
            <div style={sectionLead}>Р”Р°РЅРЅС‹Рµ РєР°СЂС‚С‹ РґР»СЏ РїРµСЂРµРІРѕРґРѕРІ Рё РїСЂРѕРІРµСЂРѕРє.</div>
          </div>
        </div>
        <div style={detailsInfoGrid}>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>РЎС‡РµС‚</div><div style={premiumInfoValue}>{repairMojibake(requisites.account_number) || "РќРµС‚ РґР°РЅРЅС‹С…"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Р‘РРљ</div><div style={premiumInfoValue}>{repairMojibake(requisites.bik) || "РќРµС‚ РґР°РЅРЅС‹С…"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>РљРѕСЂСЂ. СЃС‡РµС‚</div><div style={premiumInfoValue}>{repairMojibake(requisites.correspondent_account) || "РќРµС‚ РґР°РЅРЅС‹С…"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Р‘Р°РЅРє</div><div style={premiumInfoValue}>{repairMojibake(requisites.bank_name) || "ZF Bank"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Р’Р°Р»СЋС‚Р°</div><div style={premiumInfoValue}>{repairMojibake(requisites.currency) || "RUB"}</div></div>
        </div>
      </div>
    </ScreenLayout>
  );
}



function OperationsScreen({ vkId, accounts, onOpenOperation }) {
  const [operations, setOperations] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [operationType, setOperationType] = useState("");
  const [category, setCategory] = useState("");
  const quickCategories = [
    { key: "", label: "Р’СЃРµ" },
    { key: "transfer", label: "РџРµСЂРµРІРѕРґС‹" },
    { key: "shopping", label: "РџРѕРєСѓРїРєРё" },
    { key: "services", label: "РЈСЃР»СѓРіРё" },
    { key: "subscription", label: "РџРѕРґРїРёСЃРєРё" },
  ];

  const loadOperations = async () => {
    const params = new URLSearchParams();
    if (accountId) params.append("account_id", accountId);
    if (operationType) params.append("operation_type", operationType);
    if (category) params.append("category", category);
    const url = `${API_BASE}/users/${vkId}/operations${params.toString() ? `?${params.toString()}` : ""}`;
    apiFetch(url)
      .then((res) => res.json())
      .then((data) => setOperations(Array.isArray(data) ? data : []))
      .catch((err) => console.error("РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РѕРїРµСЂР°С†РёР№:", err));
  };

  useEffect(() => {
    loadOperations();
  }, [vkId, accountId, operationType, category]);

  const incomeCount = operations.filter((item) => item.operation_type === "income").length;
  const expenseCount = operations.filter((item) => item.operation_type === "expense").length;
  const incomeSum = operations.filter((item) => item.operation_type === "income").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenseSum = operations.filter((item) => item.operation_type === "expense").reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return (
    <ScreenLayout title="РћРїРµСЂР°С†РёРё">
      <div style={operationsSummaryGrid}>
        <div style={operationsSummaryCard}><div style={premiumMetricLabel}>Р’СЃРµРіРѕ РѕРїРµСЂР°С†РёР№</div><div style={operationsSummaryValue}>{operations.length}</div></div>
        <div style={operationsSummaryCard}><div style={premiumMetricLabel}>РџРѕСЃС‚СѓРїР»РµРЅРёСЏ</div><div style={premiumIncomeAmount}>+{formatMoney(incomeSum)} в‚Ѕ</div><div style={operationsSummaryMeta}>{incomeCount} РѕРїРµСЂР°С†РёР№</div></div>
        <div style={operationsSummaryCard}><div style={premiumMetricLabel}>Р Р°СЃС…РѕРґС‹</div><div style={premiumExpenseAmount}>в€’{formatMoney(expenseSum)} в‚Ѕ</div><div style={operationsSummaryMeta}>{expenseCount} РѕРїРµСЂР°С†РёР№</div></div>
      </div>

      <div style={premiumSectionBlock}>
        <div style={sectionHeader}><div><div style={screenSubtitle}>Р¤РёР»СЊС‚СЂС‹</div><div style={sectionLead}>РЈС‚РѕС‡РЅСЏР№С‚Рµ РІС‹РґР°С‡Сѓ РїРѕ СЃС‡С‘С‚Сѓ, С‚РёРїСѓ Рё РєР°С‚РµРіРѕСЂРёРё, С‡С‚РѕР±С‹ Р±С‹СЃС‚СЂРµРµ РЅР°С…РѕРґРёС‚СЊ РЅСѓР¶РЅРѕРµ РґРІРёР¶РµРЅРёРµ.</div></div></div>
        <div style={{ marginBottom: "14px" }}>
          <div style={{ ...inputLabel, marginTop: 0 }}>Р‘С‹СЃС‚СЂС‹Рµ С„РёР»СЊС‚СЂС‹</div>
          <div style={premiumTagRow}>
            {quickCategories.map((item) => (
              <button
                key={item.key || "all"}
                type="button"
                style={
                  category === item.key
                    ? { ...compactButton, background: "#2a5f96", borderColor: "#417fbe", color: "#ffffff", minHeight: "40px", padding: "10px 12px" }
                    : { ...compactButton, minHeight: "40px", padding: "10px 12px" }
                }
                onClick={() => setCategory(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div style={filtersGrid}>
          <div><div style={inputLabel}>РЎС‡С‘С‚</div><select style={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Р’СЃРµ СЃС‡РµС‚Р°</option>{accounts.map((acc) => <option key={acc.id} value={acc.id}>{repairMojibake(acc.account_name)}</option>)}</select></div>
          <div><div style={inputLabel}>РўРёРї РѕРїРµСЂР°С†РёРё</div><select style={input} value={operationType} onChange={(e) => setOperationType(e.target.value)}><option value="">Р’СЃРµ</option><option value="income">РўРѕР»СЊРєРѕ РїРѕСЃС‚СѓРїР»РµРЅРёСЏ</option><option value="expense">РўРѕР»СЊРєРѕ СЂР°СЃС…РѕРґС‹</option></select></div>
          <div><div style={inputLabel}>РљР°С‚РµРіРѕСЂРёСЏ</div><select style={input} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Р’СЃРµ РєР°С‚РµРіРѕСЂРёРё</option><option value="transfer">РџРµСЂРµРІРѕРґС‹</option><option value="shopping">РџРѕРєСѓРїРєРё</option><option value="subscription">РџРѕРґРїРёСЃРєРё</option><option value="topup">РџРѕРїРѕР»РЅРµРЅРёСЏ</option><option value="services">РЈСЃР»СѓРіРё</option><option value="commission">РљРѕРјРёСЃСЃРёРё</option></select></div>
        </div>
      </div>

      {operations.length === 0 ? <div style={emptyBlock}>РћРїРµСЂР°С†РёРё РЅРµ РЅР°Р№РґРµРЅС‹. РџРѕРїСЂРѕР±СѓР№С‚Рµ СЃРЅСЏС‚СЊ С„РёР»СЊС‚СЂС‹ РёР»Рё РІС‹РїРѕР»РЅРёС‚СЊ РїРµСЂРІРѕРµ РґРµР№СЃС‚РІРёРµ РІ РїСЂРёР»РѕР¶РµРЅРёРё.</div> : (
        <div style={premiumSectionBlock}>
          <div style={sectionHeader}><div><div style={screenSubtitle}>Р›РµРЅС‚Р° РѕРїРµСЂР°С†РёР№</div><div style={sectionLead}>РџРѕРєР°Р·С‹РІР°РµРј СЃР°РјС‹Рµ СЃРІРµР¶РёРµ РґРІРёР¶РµРЅРёСЏ РїРѕ СЃС‡РµС‚Р°Рј СЃ РєСЂР°С‚РєРѕР№ РјРµС‚РєРѕР№ РєР°С‚РµРіРѕСЂРёРё.</div></div></div>
          <div style={premiumOperationsList}>
            {operations.map((item) => (
              <div key={item.id} style={premiumOperationCard} onClick={() => onOpenOperation?.(item.id)}>
                <div style={premiumOperationLeading}>
                  <div style={premiumOperationIcon}>{item.operation_type === "income" ? "в†“" : "в†‘"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={premiumOperationTitle}>{humanizeOperationTitle(item.title, item.operation_type)}</div><div style={premiumOperationMeta}>{formatOperationDate(item.created_at)}</div></div>
                </div>
                <div style={premiumOperationTrailing}><div style={premiumCategoryPill}>{categoryLabelRu(item.category)}</div><div style={item.operation_type === "income" ? premiumIncomeAmount : premiumExpenseAmount}>{item.operation_type === "income" ? "+" : "в€’"}{formatMoney(item.amount)} в‚Ѕ</div></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </ScreenLayout>
  );
}

function OperationDetailsScreen({ vkId, operationId, onBack, setActiveTab }) {
  const [operation, setOperation] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch(`${API_BASE}/users/${vkId}/operations/${operationId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setOperation(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError("РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РѕРїРµСЂР°С†РёСЋ");
      });
    return () => {
      cancelled = true;
    };
  }, [vkId, operationId]);

  if (error) {
    return <ScreenLayout title="Р”РµС‚Р°Р»СЊ РѕРїРµСЂР°С†РёРё"><div style={messageBox}>{error}</div></ScreenLayout>;
  }

  if (!operation) {
    return <div style={loading}>Р—Р°РіСЂСѓР·РєР°...</div>;
  }

  const title = humanizeOperationTitle(operation.title, operation.operation_type);
  const subtitle = `${repairMojibake(operation.category || "transfer")} вЂў ${formatOperationDate(operation.created_at)}`;
  const isExpense = operation.operation_type === "expense";
  const isVkTransfer = title.toLowerCase().includes("vk id");

  return (
    <ScreenLayout title="Р”РµС‚Р°Р»СЊ РѕРїРµСЂР°С†РёРё">
      <div style={menuCard}>
        <button style={{ ...compactButton, width: "fit-content", marginBottom: 16 }} onClick={onBack}>в†ђ РќР°Р·Р°Рґ Рє РѕРїРµСЂР°С†РёСЏРј</button>
        <div style={premiumNoticeCard}>
          <div style={premiumNoticeKicker}>РћРїРµСЂР°С†РёСЏ</div>
          <div style={premiumNoticeTitle}>{title}</div>
          <div style={premiumNoticeText}>{subtitle}</div>
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, color: isExpense ? "#ffb36a" : "#87f0ad", marginTop: 18 }}>
          {isExpense ? "-" : "+"}{formatMoney(Math.abs(Number(operation.amount || 0)))} в‚Ѕ
        </div>
      </div>

      <div style={menuCard}>
        <div style={detailsInfoGrid}>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>РЎС‚Р°С‚СѓСЃ</div><div style={premiumInfoValue}>{repairMojibake(operation.status) || "Р’ РѕР±СЂР°Р±РѕС‚РєРµ"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>РЎС‡РµС‚</div><div style={premiumInfoValue}>{repairMojibake(operation.account_name) || "РЎС‡РµС‚ Р±Р°РЅРєР°"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>РљР°С‚РµРіРѕСЂРёСЏ</div><div style={premiumInfoValue}>{repairMojibake(operation.category || "transfer")}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>ID</div><div style={premiumInfoValue}>{operation.id}</div></div>
        </div>
      </div>

      <div style={paymentsFeatureGrid}>
        <div style={paymentsFeatureCardPrimary} onClick={() => setActiveTab(isVkTransfer && isExpense ? "transfer" : "payments")}>
          <div style={paymentsFeatureIcon}>в†’</div>
          <div style={paymentsFeatureTitle}>{isVkTransfer && isExpense ? "РџРѕРІС‚РѕСЂРёС‚СЊ РїРµСЂРµРІРѕРґ" : "Р’ РїР»Р°С‚РµР¶Рё"}</div>
          <div style={paymentsFeatureText}>Р‘С‹СЃС‚СЂС‹Р№ РїРµСЂРµС…РѕРґ Рє РїРѕРІС‚РѕСЂСѓ СЃС†РµРЅР°СЂРёСЏ РёР»Рё РЅРѕРІРѕР№ РѕРїРµСЂР°С†РёРё.</div>
        </div>
        <div style={serviceFeatureCard} onClick={() => setActiveTab("favorites")}>
          <div style={paymentsFeatureIcon}>в…</div>
          <div style={paymentsFeatureTitle}>РЎРѕС…СЂР°РЅРёС‚СЊ С€Р°Р±Р»РѕРЅ</div>
          <div style={paymentsFeatureText}>Р”РѕР±Р°РІСЊС‚Рµ СЃС†РµРЅР°СЂРёР№ РІ РёР·Р±СЂР°РЅРЅРѕРµ РґР»СЏ РїРѕРІС‚РѕСЂР°.</div>
        </div>
        <div style={serviceFeatureCard} onClick={() => setActiveTab("support")}>
          <div style={paymentsFeatureIcon}>?</div>
          <div style={paymentsFeatureTitle}>РќСѓР¶РЅР° РїРѕРјРѕС‰СЊ</div>
          <div style={paymentsFeatureText}>Р•СЃР»Рё РїРѕ РѕРїРµСЂР°С†РёРё РµСЃС‚СЊ РІРѕРїСЂРѕСЃС‹, СЃСЂР°Р·Сѓ РѕС‚РєСЂРѕР№С‚Рµ РїРѕРґРґРµСЂР¶РєСѓ.</div>
        </div>
      </div>
    </ScreenLayout>
  );
}


function AnalyticsScreen({ analytics }) {
  const categories = analytics?.categories || {};
  const total = Number(analytics?.total_expenses || 0);

  const categoryMap = [
    { key: "shopping", label: "РџРѕРєСѓРїРєРё" },
    { key: "transfer", label: "РџРµСЂРµРІРѕРґС‹" },
    { key: "subscription", label: "РџРѕРґРїРёСЃРєРё" },
    { key: "services", label: "РЈСЃР»СѓРіРё" },
    { key: "commission", label: "РљРѕРјРёСЃСЃРёРё" },
    { key: "other", label: "Р”СЂСѓРіРѕРµ" },
  ];

  return (
    <ScreenLayout title="РђРЅР°Р»РёС‚РёРєР° СЂР°СЃС…РѕРґРѕРІ">
      <div style={analyticsCard}>
        <div style={analyticsTotalLabel}>РћР±С‰РёРµ СЂР°СЃС…РѕРґС‹</div>
        <div style={analyticsTotalValue}>
          {total.toLocaleString("ru-RU", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} в‚Ѕ
        </div>
      </div>

      {categoryMap.map((item) => {
        const value = Number(categories[item.key] || 0);
        const percent = total > 0 ? (value / total) * 100 : 0;

        return (
          <div key={item.key} style={analyticsItem}>
            <div style={analyticsRow}>
              <div>{item.label}</div>
              <div>
                {value.toLocaleString("ru-RU", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} в‚Ѕ
              </div>
            </div>

            <div style={analyticsBarWrap}>
              <div style={{ ...analyticsBar, width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </ScreenLayout>
  );
}

function NotificationsScreen({ vkId, notifications, onRefresh }) {
  const unread = notifications.filter((item) => !item.is_read);
  const read = notifications.filter((item) => item.is_read);

  const markRead = async (id) => {
    await apiFetch(`${API_BASE}/notifications/${id}/read`, { method: "POST" });
    onRefresh();
  };

  const markAllRead = async () => {
    await Promise.all(unread.map((item) => apiFetch(`${API_BASE}/notifications/${item.id}/read`, { method: "POST" })));
    onRefresh();
  };

  return (
    <ScreenLayout title="РЈРІРµРґРѕРјР»РµРЅРёСЏ">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}><div style={premiumMetricLabel}>Р’СЃРµРіРѕ</div><div style={premiumMetricValue}>{notifications.length}</div><div style={operationsSummaryMeta}>Р’СЃРµ СЃРѕР±С‹С‚РёСЏ РїРѕ РІР°С€РµРјСѓ Р±Р°РЅРєСѓ.</div></div>
        <div style={premiumMetricCard}><div style={premiumMetricLabel}>РќРµРїСЂРѕС‡РёС‚Р°РЅРЅС‹Рµ</div><div style={premiumMetricValue}>{unread.length}</div><div style={operationsSummaryMeta}>РќРѕРІС‹Рµ СЃРѕР±С‹С‚РёСЏ, С‚СЂРµР±СѓСЋС‰РёРµ РІРЅРёРјР°РЅРёСЏ.</div></div>
      </div>

      <div style={menuCard}>
        <div style={sectionHeader}>
          <div>
            <div style={screenSubtitle}>РќРѕРІС‹Рµ СѓРІРµРґРѕРјР»РµРЅРёСЏ</div>
            <div style={sectionLead}>РЎРЅР°С‡Р°Р»Р° РїРѕРєР°Р·С‹РІР°РµРј РЅРµРїСЂРѕС‡РёС‚Р°РЅРЅРѕРµ.</div>
          </div>
          <button style={miniButton} onClick={markAllRead}>РџСЂРѕС‡РёС‚Р°С‚СЊ РІСЃРµ</button>
        </div>
        {unread.length === 0 ? <div style={emptyBlock}>РќРµРїСЂРѕС‡РёС‚Р°РЅРЅС‹С… СѓРІРµРґРѕРјР»РµРЅРёР№ РЅРµС‚</div> : (
          <div style={operationsList}>
            {unread.map((item) => (
              <div key={item.id} style={premiumOperationRow}>
                <div style={operationIcon}>вЂў</div>
                <div style={{ flex: 1 }}>
                  <div style={premiumOperationTitle}>{repairMojibake(item.title)}</div>
                  <div style={operationMeta}>{repairMojibake(item.message)}</div>
                </div>
                <button style={secondaryButton} onClick={() => markRead(item.id)}>РћС‚РјРµС‚РёС‚СЊ</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={menuCard}>
        <div style={sectionHeader}><div><div style={screenSubtitle}>РСЃС‚РѕСЂРёСЏ</div><div style={sectionLead}>Р’СЃРµ РїСЂРѕС€Р»С‹Рµ СѓРІРµРґРѕРјР»РµРЅРёСЏ.</div></div></div>
        {read.length === 0 ? <div style={emptyBlock}>РСЃС‚РѕСЂРёСЏ РїРѕРєР° РїСѓСЃС‚Р°</div> : (
          <div style={operationsList}>
            {read.map((item) => (
              <div key={item.id} style={premiumOperationRow}>
                <div style={operationIcon}>вњ“</div>
                <div style={{ flex: 1 }}>
                  <div style={premiumOperationTitle}>{repairMojibake(item.title)}</div>
                  <div style={operationMeta}>{repairMojibake(item.message)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ScreenLayout>
  );
}


function FavoritesScreen({ favorites, setActiveTab }) {
  const vkFavorites = favorites.filter((item) => item.payment_type === "vk_transfer");
  const serviceFavorites = favorites.filter((item) => item.payment_type === "service_payment");

  const openFavorite = (item) => {
    if (item.payment_type === "vk_transfer") {
      saveTransferDraft({ recipientName: repairMojibake(item.recipient_name || ""), amount: String(item.amount || ""), comment: "" });
      setActiveTab("transfer");
    } else {
      setActiveTab("pay");
    }
  };

  return (
    <ScreenLayout title="РР·Р±СЂР°РЅРЅРѕРµ">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}><div style={premiumMetricLabel}>Р’СЃРµРіРѕ С€Р°Р±Р»РѕРЅРѕРІ</div><div style={premiumMetricValue}>{favorites.length}</div><div style={operationsSummaryMeta}>РЎРѕС…СЂР°РЅРµРЅРЅС‹Рµ СЃС†РµРЅР°СЂРёРё РґР»СЏ Р±С‹СЃС‚СЂРѕРіРѕ Р·Р°РїСѓСЃРєР°.</div></div>
        <div style={premiumMetricCard}><div style={premiumMetricLabel}>VK ID</div><div style={premiumMetricValue}>{vkFavorites.length}</div><div style={operationsSummaryMeta}>Р§Р°СЃС‚С‹Рµ РїРµСЂРµРІРѕРґС‹ РєР»РёРµРЅС‚Р°Рј.</div></div>
        <div style={premiumMetricCard}><div style={premiumMetricLabel}>РЈСЃР»СѓРіРё</div><div style={premiumMetricValue}>{serviceFavorites.length}</div><div style={operationsSummaryMeta}>РЁР°Р±Р»РѕРЅС‹ РґР»СЏ СЃРµСЂРІРёСЃРЅС‹С… РїР»Р°С‚РµР¶РµР№.</div></div>
      </div>

      {favorites.length === 0 ? <div style={emptyBlock}>РР·Р±СЂР°РЅРЅРѕРµ РїРѕРєР° РїСѓСЃС‚Рѕ</div> : (
        <div style={premiumTemplatesGrid}>
          {favorites.map((item) => (
            <div key={item.id} style={premiumShortcutCard}>
              <div style={premiumShortcutIcon}>{item.payment_type === "vk_transfer" ? "в†’" : "в‚Ѕ"}</div>
              <div style={premiumShortcutTitle}>{repairMojibake(item.title || item.recipient_name || "РЁР°Р±Р»РѕРЅ")}</div>
              <div style={premiumShortcutMeta}>{item.payment_type === "vk_transfer" ? `VK ID: ${item.recipient_value}` : repairMojibake(item.provider_name || item.recipient_value || "РЈСЃР»СѓРіР°")}</div>
              <div style={detailActionBar}>
                <button type="button" style={compactButton} onClick={() => openFavorite(item)}>РџРѕРІС‚РѕСЂРёС‚СЊ</button>
                <button type="button" style={compactButton} onClick={() => setActiveTab(item.payment_type === "vk_transfer" ? "transfer" : "pay")}>
РћС‚РєСЂС‹С‚СЊ</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </ScreenLayout>
  );
}





function ProfileScreen({ vkId, userData, onRefresh, setActiveTab }) {
  const profile = userData || {};
  const fullName = repairMojibake(profile.full_name || "РљР»РёРµРЅС‚ ZF Bank");
  const avatarLetter = fullName ? fullName[0].toUpperCase() : "Рљ";
  const phone = profile.phone ? normalizeRussianPhone(profile.phone) : "РќРѕРјРµСЂ РЅРµ СѓРєР°Р·Р°РЅ";
  const language = profile.language === "en" ? "РђРЅРіР»РёР№СЃРєРёР№" : "Р СѓСЃСЃРєРёР№";
  const theme = repairMojibake(profile.app_theme || "dark").toLowerCase() === "dark" ? "РўРµРјРЅР°СЏ" : "РЎРІРµС‚Р»Р°СЏ";
  const createdAt = repairMojibake(profile.created_at || "РќРµС‚ РґР°РЅРЅС‹С…");
  const [phoneDraft, setPhoneDraft] = useState(profile.phone ? normalizeRussianPhone(profile.phone) : "");
  const [message, setMessage] = useState("");
  const [isEditingPhone, setIsEditingPhone] = useState(!profile.phone);

  useEffect(() => {
    setPhoneDraft(profile.phone ? normalizeRussianPhone(profile.phone) : "");
    setIsEditingPhone(!profile.phone);
  }, [profile.phone]);

  const savePhone = async () => {
    const normalizedPhone = normalizeRussianPhone(phoneDraft);
    if (!isValidRussianPhone(normalizedPhone)) {
      setMessage("РЈРєР°Р¶РёС‚Рµ РЅРѕРјРµСЂ РІ С„РѕСЂРјР°С‚Рµ +7XXXXXXXXXX");
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/users/${vkId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ С‚РµР»РµС„РѕРЅ"));
        return;
      }
      setMessage("РўРµР»РµС„РѕРЅ РїСЂРёРІСЏР·Р°РЅ Рє РїСЂРѕС„РёР»СЋ");
      setIsEditingPhone(false);
      onRefresh();
    } catch (err) {
      console.error(err);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  const requestUnblock = async (cardId) => {
    try {
      const res = await apiFetch(`${API_BASE}/cards/${cardId}/request-unblock`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(typeof data.error === "string" ? data.error : "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ Р·Р°РїСЂРѕСЃ РЅР° СЂР°Р·Р±Р»РѕРєРёСЂРѕРІРєСѓ"));
        return;
      }
      setMessage("Р—Р°РїСЂРѕСЃ РЅР° СЂР°Р·Р±Р»РѕРєРёСЂРѕРІРєСѓ РѕС‚РїСЂР°РІР»РµРЅ");
      onActionDone();
    } catch (err) {
      console.error(err);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  return (
    <ScreenLayout title="РџСЂРѕС„РёР»СЊ">
      <div style={menuCard}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ ...avatar, width: 72, height: 72, fontSize: 30 }}>{avatarLetter}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "28px", fontWeight: 800, color: "#f3f7ff" }}>{fullName}</div>
            <div style={{ color: "#8bb7f0", marginTop: 4 }}>Р‘Р°РЅРє РІРѕ Р’РљРѕРЅС‚Р°РєС‚Рµ</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={pill}>VK ID: {profile.vk_id}</div>
            <div style={pill}>{phone}</div>
          </div>
        </div>
      </div>

      <div style={menuCard}>
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#f3f7ff", marginBottom: 8 }}>РљРѕРЅС‚Р°РєС‚С‹ Рё Р±РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ</div>
        <div style={{ color: "#9ab2cc", marginBottom: 16 }}>РџСЂРёРІСЏР¶РёС‚Рµ Р°РєС‚СѓР°Р»СЊРЅС‹Р№ С‚РµР»РµС„РѕРЅ Рє Р±Р°РЅРєРѕРІСЃРєРѕРјСѓ РїСЂРѕС„РёР»СЋ Рё РїРµСЂРµР№РґРёС‚Рµ РІ СЂР°Р·РґРµР» Р±РµР·РѕРїР°СЃРЅРѕСЃС‚Рё РґР»СЏ СѓРїСЂР°РІР»РµРЅРёСЏ PIN Рё РІС…РѕРґР°РјРё.</div>
        {!isEditingPhone && profile.phone ? (
          <div style={detailsInfoGrid}>
            <div style={detailsInfoCard}>
              <div style={premiumInfoLabel}>РўРµРєСѓС‰РёР№ С‚РµР»РµС„РѕРЅ</div>
              <div style={premiumInfoValue}>{phone}</div>
            </div>
          </div>
        ) : (
          <>
            <div style={inputLabel}>РўРµР»РµС„РѕРЅ</div>
            <input
              style={input}
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              placeholder="+79990000000"
            />
          </>
        )}
        {message ? <div style={messageBox}>{message}</div> : null}
        <div style={detailActionBar}>
          {isEditingPhone || !profile.phone ? (
            <button style={primaryButton} onClick={savePhone}>РЎРѕС…СЂР°РЅРёС‚СЊ С‚РµР»РµС„РѕРЅ</button>
          ) : (
            <button style={secondaryButton} onClick={() => { setIsEditingPhone(true); setMessage(""); }}>
              РР·РјРµРЅРёС‚СЊ РЅРѕРјРµСЂ С‚РµР»РµС„РѕРЅР°
            </button>
          )}
          <button style={secondaryButton} onClick={() => setActiveTab("security")}>РћС‚РєСЂС‹С‚СЊ Р±РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ</button>
        </div>
      </div>

      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>РЎС‚Р°С‚СѓСЃ РїСЂРѕС„РёР»СЏ</div>
          <div style={premiumMetricValue}>РђРєС‚РёРІРµРЅ</div>
          <div style={operationsSummaryMeta}>РџРµСЂРµРІРѕРґС‹, РєР°СЂС‚С‹ Рё РїСЂРѕРґСѓРєС‚С‹ РґРѕСЃС‚СѓРїРЅС‹.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>РЇР·С‹Рє</div>
          <div style={premiumMetricValue}>{language}</div>
          <div style={operationsSummaryMeta}>РњРѕР¶РЅРѕ РёР·РјРµРЅРёС‚СЊ РїРѕР·Р¶Рµ РІ РЅР°СЃС‚СЂРѕР№РєР°С….</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>РўРµРјР°</div>
          <div style={premiumMetricValue}>{theme}</div>
          <div style={operationsSummaryMeta}>Р•РґРёРЅС‹Р№ СЃС‚РёР»СЊ Р±Р°РЅРєР° РЅР° РІСЃРµС… СЌРєСЂР°РЅР°С….</div>
        </div>
      </div>

      <div style={menuCard}>
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#f3f7ff", marginBottom: 8 }}>Р›РёС‡РЅС‹Рµ РґР°РЅРЅС‹Рµ</div>
        <div style={{ color: "#9ab2cc", marginBottom: 16 }}>РљСЂР°С‚РєР°СЏ СЃРІРѕРґРєР° РїРѕ РІР°С€РµРјСѓ Р±Р°РЅРєРѕРІСЃРєРѕРјСѓ РїСЂРѕС„РёР»СЋ.</div>
        <div style={detailsInfoGrid}>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Р¤РРћ</div><div style={premiumInfoValue}>{fullName}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>РўРµР»РµС„РѕРЅ</div><div style={premiumInfoValue}>{phone}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>VK ID</div><div style={premiumInfoValue}>{profile.vk_id}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Р”Р°С‚Р° СЂРµРіРёСЃС‚СЂР°С†РёРё</div><div style={premiumInfoValue}>{createdAt}</div></div>
        </div>
      </div>
    </ScreenLayout>
  );
}





function SettingsScreen({ vkId, userData, onRefresh, onLogout }) {
  const [message, setMessage] = useState("");

  const updateSettings = async (patch) => {
    try {
      const res = await apiFetch(`${API_BASE}/users/${vkId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё"));
        return;
      }
      setMessage("РќР°СЃС‚СЂРѕР№РєРё РѕР±РЅРѕРІР»РµРЅС‹");
      onRefresh();
    } catch (err) {
      console.error(err);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  return (
    <ScreenLayout title="РќР°СЃС‚СЂРѕР№РєРё">
      <div style={premiumPanelGrid}>
        <div style={premiumMetricsGrid}>
          <MenuCard
            title="РЎРєСЂС‹С‚РёРµ Р±Р°Р»Р°РЅСЃР°"
            subtitle={userData.hide_balance ? "Р‘Р°Р»Р°РЅСЃ СЃРєСЂС‹С‚ РІРѕ РІСЃРµС… РІРёС‚СЂРёРЅР°С…" : "Р‘Р°Р»Р°РЅСЃ РѕС‚РѕР±СЂР°Р¶Р°РµС‚СЃСЏ РЅР° СЌРєСЂР°РЅР°С…"}
            onClick={() => updateSettings({ hide_balance: !userData.hide_balance })}
          />
          <MenuCard
            title="РЈРІРµРґРѕРјР»РµРЅРёСЏ"
            subtitle={userData.notifications_enabled ? "РЈРІРµРґРѕРјР»РµРЅРёСЏ РІРєР»СЋС‡РµРЅС‹" : "РЈРІРµРґРѕРјР»РµРЅРёСЏ РІС‹РєР»СЋС‡РµРЅС‹"}
            onClick={() => updateSettings({ notifications_enabled: !userData.notifications_enabled })}
          />
          <MenuCard
            title="РЇР·С‹Рє"
            subtitle={userData.language === "en" ? "РђРЅРіР»РёР№СЃРєРёР№" : "Р СѓСЃСЃРєРёР№"}
            onClick={() => updateSettings({ language: userData.language === "en" ? "ru" : "en" })}
          />
          <MenuCard
            title="РўРµРјР°"
            subtitle={repairMojibake(userData.app_theme || "dark") === "light" ? "РЎРІРµС‚Р»Р°СЏ" : "РўРµРјРЅР°СЏ"}
            onClick={() => updateSettings({ app_theme: repairMojibake(userData.app_theme || "dark") === "light" ? "dark" : "light" })}
          />
        </div>
        {message ? <div style={messageBox}>{message}</div> : null}
        <MenuCard title="Р’С‹Р№С‚Рё" subtitle="Р—Р°РІРµСЂС€РёС‚СЊ СЃРµСЃСЃРёСЋ РІ Р±Р°РЅРєРµ" onClick={onLogout} />
      </div>
    </ScreenLayout>
  );
}


function OnboardingScreen({ vkId, onDone }) {
  const steps = [
    { title: "РћС‚РєСЂРѕР№С‚Рµ СЃС‡С‘С‚", text: "РЎРѕР·РґР°Р№С‚Рµ РїРµСЂРІС‹Р№ СЃС‡С‘С‚ РґР»СЏ РїРµСЂРµРІРѕРґРѕРІ Рё С…СЂР°РЅРµРЅРёСЏ РґРµРЅРµРі." },
    { title: "РџРµСЂРµРІРѕРґ РїРѕ VK ID", text: "Р‘С‹СЃС‚СЂРѕ РЅР°Р№РґРёС‚Рµ РєР»РёРµРЅС‚Р° Рё РѕС‚РїСЂР°РІСЊС‚Рµ РґРµРЅСЊРіРё РІ РїР°СЂСѓ С€Р°РіРѕРІ." },
    { title: "Р”РµСЂР¶РёС‚Рµ РІСЃС‘ РїРѕРґ СЂСѓРєРѕР№", text: "РСЃС‚РѕСЂРёСЏ РѕРїРµСЂР°С†РёР№, РєР°СЂС‚С‹, СѓРІРµРґРѕРјР»РµРЅРёСЏ Рё РїРѕРґРґРµСЂР¶РєР° РІ РѕРґРЅРѕРј РјРµСЃС‚Рµ." },
  ];
  return (
    <ScreenLayout title="РќР°С‡Р°Р»Рѕ СЂР°Р±РѕС‚С‹">
      <div style={paymentsShowcaseCard}><div style={paymentsShowcaseEyebrow}>ZF Bank</div><div style={paymentsShowcaseTitle}>Р’Р°С€ Р±Р°РЅРє РІРЅСѓС‚СЂРё VK</div><div style={paymentsShowcaseText}>РљРѕСЂРѕС‚РєРѕ РїРѕРєР°Р¶РµРј РѕСЃРЅРѕРІРЅС‹Рµ СЃС†РµРЅР°СЂРёРё.</div></div>
      <div style={premiumPanelGrid}>{steps.map((step) => <MenuCard key={step.title} title={step.title} subtitle={step.text} />)}</div>
      <button style={primaryButton} onClick={onDone}>РџРѕРЅСЏС‚РЅРѕ</button>
    </ScreenLayout>
  );
}



function SupportScreen({ setActiveTab }) {
  return (
    <ScreenLayout title="РџРѕРґРґРµСЂР¶РєР°">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>РЎРµСЂРІРёСЃРЅС‹Р№ С†РµРЅС‚СЂ</div>
        <div style={paymentsShowcaseTitle}>РџРѕРјРѕР¶РµРј СЃ РїРµСЂРµРІРѕРґР°РјРё, РєР°СЂС‚Р°РјРё Рё СЃРµСЂРІРёСЃР°РјРё Р±Р°РЅРєР°</div>
        <div style={paymentsShowcaseText}>Р’С‹Р±РµСЂРёС‚Рµ С‡Р°С‚, СЃРµСЂРІРёСЃРЅС‹Р№ Р·Р°РїСЂРѕСЃ, FAQ РёР»Рё СЃРѕРѕР±С‰РµРЅРёРµ Рѕ РїСЂРѕР±Р»РµРјРµ.</div>
      </div>

      <div style={serviceCenterGrid}>
        <div style={serviceFeatureCardPrimary} onClick={() => setActiveTab("chat")}>
          <div style={paymentsFeatureIcon}>рџ’¬</div>
          <div style={paymentsFeatureTitle}>Р§Р°С‚ СЃ Р±Р°РЅРєРѕРј</div>
          <div style={paymentsFeatureText}>РџСЂСЏРјРѕР№ РґРёР°Р»РѕРі СЃ РїРѕРґРґРµСЂР¶РєРѕР№ РІ РјРёРЅРё-РїСЂРёР»РѕР¶РµРЅРёРё.</div>
        </div>
        <div style={serviceFeatureCard} onClick={() => setActiveTab("serviceRequests")}>
          <div style={paymentsFeatureIcon}>рџ§ѕ</div>
          <div style={paymentsFeatureTitle}>РЎРµСЂРІРёСЃРЅС‹Рµ Р·Р°РїСЂРѕСЃС‹</div>
          <div style={paymentsFeatureText}>РСЃС‚РѕСЂРёСЏ Р·Р°СЏРІРѕРє Рё СЃС‚Р°С‚СѓСЃС‹ РѕР±СЂР°С‰РµРЅРёР№.</div>
        </div>
        <div style={serviceFeatureCard} onClick={() => setActiveTab("problemReport")}>
          <div style={paymentsFeatureIcon}>!</div>
          <div style={paymentsFeatureTitle}>РЎРѕРѕР±С‰РёС‚СЊ Рѕ РїСЂРѕР±Р»РµРјРµ</div>
          <div style={paymentsFeatureText}>Р‘С‹СЃС‚СЂРѕ РїРµСЂРµРґР°Р№С‚Рµ РІ Р±Р°РЅРє РѕРїРёСЃР°РЅРёРµ РѕС€РёР±РєРё.</div>
        </div>
        <div style={serviceFeatureCard} onClick={() => setActiveTab("faq")}>
          <div style={paymentsFeatureIcon}>i</div>
          <div style={paymentsFeatureTitle}>FAQ</div>
          <div style={paymentsFeatureText}>Р§Р°СЃС‚С‹Рµ РІРѕРїСЂРѕСЃС‹ РїРѕ РїРµСЂРµРІРѕРґР°Рј, РєР°СЂС‚Р°Рј Рё Р·Р°СЏРІРєР°Рј.</div>
        </div>
      </div>
    </ScreenLayout>
  );
}



function SafetyTipsScreen() {
  const tips = [
    "РќРёРєРѕРјСѓ РЅРµ СЃРѕРѕР±С‰Р°Р№С‚Рµ CVC/CVV-РєРѕРґ РєР°СЂС‚С‹.",
    "РќРµ РїРµСЂРµРґР°РІР°Р№С‚Рµ PIN-РєРѕРґ РґР°Р¶Рµ СЃРѕС‚СЂСѓРґРЅРёРєР°Рј Р±Р°РЅРєР°.",
    "РџСЂРѕРІРµСЂСЏР№С‚Рµ Р°РґСЂРµСЃ СЃР°Р№С‚Р° Рё РЅРµ РїРµСЂРµС…РѕРґРёС‚Рµ РїРѕ РїРѕРґРѕР·СЂРёС‚РµР»СЊРЅС‹Рј СЃСЃС‹Р»РєР°Рј.",
    "РџРѕРґРєР»СЋС‡Р°Р№С‚Рµ СѓРІРµРґРѕРјР»РµРЅРёСЏ Рѕ СЃРїРёСЃР°РЅРёСЏС… Рё РїРµСЂРµРІРѕРґР°С….",
    "Р•СЃР»Рё Р·Р°РјРµС‚РёР»Рё СЃС‚СЂР°РЅРЅСѓСЋ РѕРїРµСЂР°С†РёСЋ вЂ” СЃСЂР°Р·Сѓ Р±Р»РѕРєРёСЂСѓР№С‚Рµ РєР°СЂС‚Сѓ Рё РїРёС€РёС‚Рµ РІ РїРѕРґРґРµСЂР¶РєСѓ.",
    "РќРµ РІРІРѕРґРёС‚Рµ РґР°РЅРЅС‹Рµ РєР°СЂС‚С‹ РІ РЅРµРїСЂРѕРІРµСЂРµРЅРЅС‹С… РїСЂРёР»РѕР¶РµРЅРёСЏС… Рё С‡Р°С‚Р°С….",
  ];

  return (
    <ScreenLayout title="РЎРѕРІРµС‚С‹ РїРѕ Р±РµР·РѕРїР°СЃРЅРѕСЃС‚Рё">
      {tips.map((tip, index) => (
        <div key={index} style={menuCard}>
          <div style={menuCardTitle}>РЎРѕРІРµС‚ {index + 1}</div>
          <div style={menuCardSubtitle}>{tip}</div>
        </div>
      ))}
    </ScreenLayout>
  );
}

function ApplicationScreen({ vkId }) {
  const productConfigs = {
    "Р”РµР±РµС‚РѕРІР°СЏ РєР°СЂС‚Р°": { subtitle: "РљР°СЂС‚Р° РґР»СЏ РµР¶РµРґРЅРµРІРЅС‹С… РїРѕРєСѓРїРѕРє, РїРµСЂРµРІРѕРґРѕРІ Рё РЅР°РєРѕРїР»РµРЅРёР№.", fields: [{ key: "fullName", label: "Р¤РРћ", placeholder: "Р’Р°С€Рµ РёРјСЏ Рё С„Р°РјРёР»РёСЏ" }, { key: "phone", label: "РўРµР»РµС„РѕРЅ", placeholder: "+79990000000" }, { key: "deliveryCity", label: "Р“РѕСЂРѕРґ РґРѕСЃС‚Р°РІРєРё", placeholder: "РњРѕСЃРєРІР°" }] },
    "РљСЂРµРґРёС‚РЅР°СЏ РєР°СЂС‚Р°": { subtitle: "РћС„РѕСЂРјР»РµРЅРёРµ РєСЂРµРґРёС‚РЅРѕРіРѕ Р»РёРјРёС‚Р° СЃ РїСЂРѕРІРµСЂРєРѕР№ РґРѕС…РѕРґР°.", fields: [{ key: "fullName", label: "Р¤РРћ", placeholder: "Р’Р°С€Рµ РёРјСЏ Рё С„Р°РјРёР»РёСЏ" }, { key: "phone", label: "РўРµР»РµС„РѕРЅ", placeholder: "+79990000000" }, { key: "income", label: "Р•Р¶РµРјРµСЃСЏС‡РЅС‹Р№ РґРѕС…РѕРґ", placeholder: "120000" }, { key: "limit", label: "Р–РµР»Р°РµРјС‹Р№ Р»РёРјРёС‚", placeholder: "300000" }] },
    "Р’РєР»Р°Рґ": { subtitle: "РћС‚РєСЂРѕР№С‚Рµ РІРєР»Р°Рґ СЃ СѓРґРѕР±РЅС‹Рј СЃСЂРѕРєРѕРј Рё СЃСѓРјРјРѕР№ СЂР°Р·РјРµС‰РµРЅРёСЏ.", fields: [{ key: "fullName", label: "Р¤РРћ", placeholder: "Р’Р°С€Рµ РёРјСЏ Рё С„Р°РјРёР»РёСЏ" }, { key: "phone", label: "РўРµР»РµС„РѕРЅ", placeholder: "+79990000000" }, { key: "amount", label: "РЎСѓРјРјР° РІРєР»Р°РґР°", placeholder: "500000" }, { key: "term", label: "РЎСЂРѕРє СЂР°Р·РјРµС‰РµРЅРёСЏ", placeholder: "12 РјРµСЃСЏС†РµРІ" }] },
    "РќР°РєРѕРїРёС‚РµР»СЊРЅС‹Р№ СЃС‡РµС‚": { subtitle: "Р“РёР±РєРёР№ СЃС‡РµС‚ РґР»СЏ С…СЂР°РЅРµРЅРёСЏ СЃСЂРµРґСЃС‚РІ СЃ РµР¶РµРґРЅРµРІРЅС‹Рј РґРѕСЃС‚СѓРїРѕРј.", fields: [{ key: "fullName", label: "Р¤РРћ", placeholder: "Р’Р°С€Рµ РёРјСЏ Рё С„Р°РјРёР»РёСЏ" }, { key: "phone", label: "РўРµР»РµС„РѕРЅ", placeholder: "+79990000000" }, { key: "amount", label: "РџР»Р°РЅРёСЂСѓРµРјР°СЏ СЃСѓРјРјР°", placeholder: "150000" }] },
    "РљСЂРµРґРёС‚": { subtitle: "Р—Р°РїСЂРѕСЃ РЅР° РїРѕС‚СЂРµР±РёС‚РµР»СЊСЃРєРёР№ РєСЂРµРґРёС‚ СЃ РїСЂРµРґРІР°СЂРёС‚РµР»СЊРЅРѕР№ РѕС†РµРЅРєРѕР№ СѓСЃР»РѕРІРёР№.", fields: [{ key: "fullName", label: "Р¤РРћ", placeholder: "Р’Р°С€Рµ РёРјСЏ Рё С„Р°РјРёР»РёСЏ" }, { key: "phone", label: "РўРµР»РµС„РѕРЅ", placeholder: "+79990000000" }, { key: "income", label: "Р•Р¶РµРјРµСЃСЏС‡РЅС‹Р№ РґРѕС…РѕРґ", placeholder: "120000" }, { key: "amount", label: "РЎСѓРјРјР° РєСЂРµРґРёС‚Р°", placeholder: "700000" }, { key: "term", label: "РЎСЂРѕРє РєСЂРµРґРёС‚Р°", placeholder: "36 РјРµСЃСЏС†РµРІ" }] },
  };
  const [productType, setProductType] = useState("Р”РµР±РµС‚РѕРІР°СЏ РєР°СЂС‚Р°");
  const [form, setForm] = useState({ fullName: "", phone: "", deliveryCity: "", income: "", limit: "", amount: "", term: "" });
  const [message, setMessage] = useState("");
  const config = productConfigs[productType] || productConfigs["Р”РµР±РµС‚РѕРІР°СЏ РєР°СЂС‚Р°"];
  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const sendApplication = async () => {
    const normalizedPhone = normalizeRussianPhone(form.phone);
    if (!form.fullName.trim() || !form.phone.trim()) return setMessage("Р—Р°РїРѕР»РЅРёС‚Рµ Р¤РРћ Рё С‚РµР»РµС„РѕРЅ");
    if (!normalizedPhone) return setMessage("РЈРєР°Р¶РёС‚Рµ РЅРѕРјРµСЂ РІ С„РѕСЂРјР°С‚Рµ +7XXXXXXXXXX");
    const details = config.fields.map((field) => `${field.label}: ${form[field.key] || "РЅРµ СѓРєР°Р·Р°РЅРѕ"}`).join("; ");
    try {
      const res = await apiFetch(`${API_BASE}/service-request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vk_id: String(vkId), request_type: productType, details }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setMessage(repairMojibake(data.error || "Р—Р°СЏРІРєР° РЅРµ РѕС‚РїСЂР°РІР»РµРЅР°"));
      setMessage("Р—Р°СЏРІРєР° РѕС‚РїСЂР°РІР»РµРЅР° РІ Р±Р°РЅРє");
    } catch (err) {
      console.error(err);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };
  return (
    <ScreenLayout title="РќРѕРІС‹Р№ РїСЂРѕРґСѓРєС‚">
      <div style={paymentsShowcaseCard}><div style={paymentsShowcaseEyebrow}>Р—Р°СЏРІРєР° РЅР° РїСЂРѕРґСѓРєС‚</div><div style={paymentsShowcaseTitle}>{productType}</div><div style={paymentsShowcaseText}>{config.subtitle}</div></div>
      <div style={premiumTagRow}>{Object.keys(productConfigs).map((name) => <button key={name} type="button" style={{ ...compactButton, background: productType === name ? "#2d5f96" : compactButton.background, borderColor: productType === name ? "#5f9fe4" : compactButton.border }} onClick={() => setProductType(name)}>{name}</button>)}</div>
      <div style={menuCard}>{config.fields.map((field) => <div key={field.key}><div style={inputLabel}>{field.label}</div><input style={input} value={form[field.key] || ""} onChange={(e) => updateField(field.key, e.target.value)} placeholder={field.placeholder} /></div>)}{message ? <div style={messageBox}>{message}</div> : null}<button style={primaryButton} onClick={sendApplication}>РћС‚РїСЂР°РІРёС‚СЊ Р·Р°СЏРІРєСѓ</button></div>
    </ScreenLayout>
  );
}


function ApplicationsListScreen({ vkId }) {
  const [applications, setApplications] = useState([]);
  useEffect(() => {
    apiFetch(`${API_BASE}/users/${vkId}/applications`).then((res) => res.json()).then((data) => setApplications(Array.isArray(data) ? data : [])).catch((err) => { console.error(err); setApplications([]); });
  }, [vkId]);
  const active = applications.filter((item) => !repairMojibake(item.status || "").toLowerCase().includes("РѕРґРѕР±СЂРµРЅ") && !repairMojibake(item.status || "").toLowerCase().includes("РѕС‚РєР»РѕРЅ")).length;
  return (
    <ScreenLayout title="РњРѕРё Р·Р°СЏРІРєРё">
      <div style={premiumMetricsGrid}><div style={premiumMetricCard}><div style={premiumMetricLabel}>Р’СЃРµРіРѕ Р·Р°СЏРІРѕРє</div><div style={premiumMetricValue}>{applications.length}</div><div style={operationsSummaryMeta}>Р’СЃРµ Р·Р°РїСЂРѕСЃС‹ РЅР° Р±Р°РЅРєРѕРІСЃРєРёРµ РїСЂРѕРґСѓРєС‚С‹ Рё СЃРµСЂРІРёСЃС‹.</div></div><div style={premiumMetricCard}><div style={premiumMetricLabel}>Р’ СЂР°Р±РѕС‚Рµ</div><div style={premiumMetricValue}>{active}</div><div style={operationsSummaryMeta}>Р—Р°СЏРІРєРё, РєРѕС‚РѕСЂС‹Рµ Р±Р°РЅРє РµС‰Рµ СЂР°СЃСЃРјР°С‚СЂРёРІР°РµС‚.</div></div></div>
      <div style={menuCard}><div style={sectionHeader}><div><div style={screenSubtitle}>РЎС‚Р°С‚СѓСЃС‹ Р·Р°СЏРІРѕРє</div><div style={sectionLead}>РЎР»РµРґРёС‚Рµ Р·Р° СЂРµС€РµРЅРёСЏРјРё РїРѕ РєР°СЂС‚Р°Рј, СЃС‡РµС‚Р°Рј, РІРєР»Р°РґР°Рј Рё РєСЂРµРґРёС‚РЅС‹Рј РїСЂРѕРґСѓРєС‚Р°Рј.</div></div></div>{applications.length === 0 ? <div style={emptyBlock}>Р—Р°СЏРІРѕРє РїРѕРєР° РЅРµС‚</div> : <div style={operationsList}>{applications.map((item) => { const tone = applicationStatusTone(item.status); return <div key={item.id} style={applicationCard}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}><div style={{ minWidth: 0, flex: 1 }}><div style={menuCardTitle}>{repairMojibake(item.product_type || item.request_type || "Р‘Р°РЅРєРѕРІСЃРєРёР№ РїСЂРѕРґСѓРєС‚")}</div><div style={menuCardSubtitle}>{repairMojibake(item.details || "")}</div></div><div style={{ ...pill, ...tone }}>{repairMojibake(item.status || "РќР° СЂР°СЃСЃРјРѕС‚СЂРµРЅРёРё")}</div></div><div style={{ marginTop: 12, color: "#8ea8c6", fontSize: 13 }}>{repairMojibake(item.created_at || "")}</div></div>; })}</div>}</div>
    </ScreenLayout>
  );
}


function TransferScreen({ senderVkId, accounts, favorites, onTransferSuccess, onFavoriteSaved }) {
  const [recipientVkId, setRecipientVkId] = useState("");
  const [recipientPreview, setRecipientPreview] = useState(null);
  const [amount, setAmount] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [message, setMessage] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);
  const [fromAccountId, setFromAccountId] = useState("");
  const vkTemplates = (favorites || []).filter((item) => item.payment_type === "vk_transfer").slice(0, 4);
  const amountPresets = [1000, 5000, 10000, 25000];

  const resetPreview = () => setRecipientPreview(null);

  useEffect(() => {
    const draft = readTransferDraft();
    if (!draft) return;

    if (draft.recipientVkId) setRecipientVkId(String(draft.recipientVkId));
    if (draft.templateName) setTemplateName(String(draft.templateName));
    if (draft.amount) setAmount(String(draft.amount));
    if (draft.note) setMessage(repairMojibake(draft.note));

    clearTransferDraft();
  }, []);

  useEffect(() => {
    if (!fromAccountId && accounts?.length) {
      const primary = getPrimaryAccount(accounts);
      setFromAccountId(String(primary?.id || accounts[0].id));
    }
  }, [accounts, fromAccountId]);

  const loadRecipientPreview = async () => {
    const targetVkId = String(recipientVkId || "").trim();
    const requiredError = validateRequired(targetVkId, "VK ID РїРѕР»СѓС‡Р°С‚РµР»СЏ");
    if (requiredError) {
      setMessage(requiredError);
      resetPreview();
      return;
    }

    setPreviewLoading(true);
    setMessage("");
    try {
      const res = await apiFetch(`${API_BASE}/transfer/vk-id/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_vk_id: senderVkId,
          from_account_id: Number(fromAccountId),
          recipient_vk_id: targetVkId,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        resetPreview();
        return;
      }
      setRecipientPreview(data.recipient || null);
    } catch (error) {
      console.error(error);
      setMessage("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕРІРµСЂРёС‚СЊ РїРѕР»СѓС‡Р°С‚РµР»СЏ");
      resetPreview();
    } finally {
      setPreviewLoading(false);
    }
  };

  const sendTransfer = async () => {
    const targetVkId = String(recipientVkId || "").trim();
    const requiredError = validateRequired(targetVkId, "VK ID РїРѕР»СѓС‡Р°С‚РµР»СЏ");
    if (requiredError) {
      setMessage(requiredError);
      return;
    }

    const amountError = validateAmount(amount);
    if (amountError) {
      setMessage(amountError);
      return;
    }

    setTransferLoading(true);
    setMessage("");
    try {
      const res = await apiFetch(`${API_BASE}/transfer/vk-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_vk_id: senderVkId,
          from_account_id: Number(fromAccountId),
          recipient_vk_id: targetVkId,
          amount: Number(amount),
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage(`РџРµСЂРµРІРѕРґ РІС‹РїРѕР»РЅРµРЅ: ${data.amount} в‚Ѕ в†’ ${data.recipient?.full_name || targetVkId}`);
      setRecipientVkId("");
      setAmount("");
      setTemplateName("");
      clearTransferDraft();
      resetPreview();
      onTransferSuccess();
    } catch (error) {
      console.error(error);
      setMessage("РћС€РёР±РєР° РїРµСЂРµРІРѕРґР°");
    } finally {
      setTransferLoading(false);
    }
  };

  const saveFavorite = async () => {
    const targetVkId = String(recipientVkId || "").trim();
    const templateError = validateRequired(templateName, "РќР°Р·РІР°РЅРёРµ С€Р°Р±Р»РѕРЅР°");
    if (templateError) {
      setMessage(templateError);
      return;
    }
    const recipientError = validateRequired(targetVkId, "VK ID РїРѕР»СѓС‡Р°С‚РµР»СЏ");
    if (recipientError) {
      setMessage(recipientError);
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: senderVkId,
          template_name: templateName,
          payment_type: "vk_transfer",
          recipient_value: targetVkId,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("РЁР°Р±Р»РѕРЅ РїРµСЂРµРІРѕРґР° РїРѕ VK ID СЃРѕС…СЂР°РЅС‘РЅ");
      setTemplateName("");
      onFavoriteSaved();
    } catch (error) {
      console.error(error);
      setMessage("РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ С€Р°Р±Р»РѕРЅ");
    }
  };

  return (
    <ScreenLayout title="РџРµСЂРµРІРѕРґ РїРѕ VK ID">
      <div style={transferShell}>
        <div style={paymentsShowcaseCard}>
          <div style={paymentsShowcaseEyebrow}>РџРµСЂРµРІРѕРґС‹ РІРЅСѓС‚СЂРё VK Bank</div>
          <div style={paymentsShowcaseTitle}>РћС‚РїСЂР°РІР»СЏР№С‚Рµ РґРµРЅСЊРіРё РїРѕ VK ID Р±РµР· РЅРѕРјРµСЂР° РєР°СЂС‚С‹</div>
          <div style={paymentsShowcaseText}>РЎРЅР°С‡Р°Р»Р° РїСЂРѕРІРµСЂСЏРµРј РїРѕР»СѓС‡Р°С‚РµР»СЏ, РїРѕРєР°Р·С‹РІР°РµРј РёРјСЏ Рё СЃС‡С‘С‚ Р·Р°С‡РёСЃР»РµРЅРёСЏ, Р·Р°С‚РµРј РїСЂРѕРІРѕРґРёРј РїРµСЂРµРІРѕРґ РІ РѕРґРёРЅ С€Р°Рі.</div>
          <div style={paymentsShowcaseChips}>
            <div style={paymentsShowcaseChip}>Р‘С‹СЃС‚СЂС‹Р№ РїРµСЂРµРІРѕРґ</div>
            <div style={paymentsShowcaseChip}>РџСЂРѕРІРµСЂРєР° РїРѕР»СѓС‡Р°С‚РµР»СЏ</div>
            <div style={paymentsShowcaseChip}>РЁР°Р±Р»РѕРЅС‹ РґР»СЏ РїРѕРІС‚РѕСЂРѕРІ</div>
          </div>
        </div>

        <div style={premiumSectionBlock}>
          <div style={screenSubtitle}>РќРѕРІС‹Р№ РїРµСЂРµРІРѕРґ</div>
          <div style={sectionLead}>Р’РІРµРґРёС‚Рµ VK ID РїРѕР»СѓС‡Р°С‚РµР»СЏ Рё СЃРЅР°С‡Р°Р»Р° РїСЂРѕРІРµСЂСЊС‚Рµ, РєРѕРјСѓ СѓР№РґСѓС‚ РґРµРЅСЊРіРё.</div>

          {vkTemplates.length > 0 ? (
            <>
              <div style={inputLabel}>Р‘С‹СЃС‚СЂС‹Р№ Р·Р°РїСѓСЃРє РёР· С€Р°Р±Р»РѕРЅРѕРІ</div>
              <div style={premiumShortcutGrid}>
                {vkTemplates.map((item) => (
                  <div
                    key={item.id}
                    style={premiumShortcutCard}
                    onClick={() => {
                      setRecipientVkId(item.recipient_value);
                      setTemplateName(repairMojibake(item.template_name) || "");
                      setMessage("");
                      resetPreview();
                    }}
                  >
                    <div style={premiumShortcutIcon}>в…</div>
                    <div style={premiumShortcutTitle}>{repairMojibake(item.template_name)}</div>
                    <div style={premiumShortcutMeta}>VK ID: {item.recipient_value}</div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <div style={inputLabel}>VK ID РїРѕР»СѓС‡Р°С‚РµР»СЏ</div>
          <input
            style={input}
            value={recipientVkId}
            onChange={(e) => {
              setRecipientVkId(e.target.value.replace(/\s/g, ""));
              if (recipientPreview) resetPreview();
            }}
            placeholder="598896543"
          />

          <div style={inputLabel}>РЎС‡РµС‚ СЃРїРёСЃР°РЅРёСЏ</div>
          <select style={input} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
            {(accounts || []).map((acc) => (
              <option key={acc.id} value={acc.id}>
                {repairMojibake(acc.account_name)} В· {formatMoney(acc.balance)} в‚Ѕ
              </option>
            ))}
          </select>

          <div style={cardsActionRow}>
            <button style={compactButton} onClick={loadRecipientPreview} disabled={previewLoading}>
              {previewLoading ? "РџСЂРѕРІРµСЂСЏРµРј..." : "РџСЂРѕРІРµСЂРёС‚СЊ РїРѕР»СѓС‡Р°С‚РµР»СЏ"}
            </button>
          </div>

          {recipientPreview && (
            <div style={transferPreviewCard}>
              <div style={premiumNoticeKicker}>РџРѕР»СѓС‡Р°С‚РµР»СЊ РЅР°Р№РґРµРЅ</div>
              <div style={transferPreviewName}>{repairMojibake(recipientPreview.full_name)}</div>
              <div style={transferPreviewMeta}>VK ID: {recipientPreview.vk_id}</div>
              <div style={transferPreviewMeta}>РЎС‡С‘С‚ Р·Р°С‡РёСЃР»РµРЅРёСЏ: {repairMojibake(recipientPreview.account_name)}</div>
              {recipientPreview.phone_masked ? <div style={transferPreviewMeta}>РўРµР»РµС„РѕРЅ: {recipientPreview.phone_masked}</div> : null}
            </div>
          )}

          <div style={inputLabel}>РЎСѓРјРјР°</div>
          <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" type="number" />

          <div style={{ ...inputLabel, marginTop: "10px" }}>Р‘С‹СЃС‚СЂС‹Рµ СЃСѓРјРјС‹</div>
          <div style={premiumTagRow}>
            {amountPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                style={{ ...compactButton, minHeight: "40px", padding: "10px 12px" }}
                onClick={() => setAmount(String(preset))}
              >
                {preset.toLocaleString("ru-RU")} в‚Ѕ
              </button>
            ))}
          </div>

          <button style={primaryButton} onClick={sendTransfer} disabled={transferLoading}>
            {transferLoading ? "РћС‚РїСЂР°РІР»СЏРµРј..." : "РћС‚РїСЂР°РІРёС‚СЊ РїРµСЂРµРІРѕРґ"}
          </button>
        </div>

        <div style={premiumSectionBlock}>
          <div style={screenSubtitle}>РЎРѕС…СЂР°РЅРёС‚СЊ РєР°Рє С€Р°Р±Р»РѕРЅ</div>
          <div style={sectionLead}>РџРѕР»РµР·РЅРѕ РґР»СЏ С‡Р°СЃС‚С‹С… РїРµСЂРµРІРѕРґРѕРІ РєРѕР»Р»РµРіР°Рј, Р±Р»РёР·РєРёРј Рё СЃРІРѕРёРј РєРѕРЅС‚Р°РєС‚Р°Рј РІ VK.</div>

          <div style={inputLabel}>РќР°Р·РІР°РЅРёРµ С€Р°Р±Р»РѕРЅР°</div>
          <input style={input} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="РџРµСЂРµРІРѕРґ РєРѕР»Р»РµРіРµ" />

          <button style={secondaryButton} onClick={saveFavorite}>РЎРѕС…СЂР°РЅРёС‚СЊ РІ РёР·Р±СЂР°РЅРЅРѕРµ</button>

          <div style={helperNote}>
            РџРµСЂРµРІРѕРґС‹ РїРѕ РЅРѕРјРµСЂСѓ С‚РµР»РµС„РѕРЅР° Р»СѓС‡С€Рµ РґРѕР±Р°РІР»СЏС‚СЊ РїРѕР·Р¶Рµ, РєРѕРіРґР° РІ РїСЂРѕРґСѓРєС‚Рµ РїРѕСЏРІРёС‚СЃСЏ РѕР±СЏР·Р°С‚РµР»СЊРЅР°СЏ Рё РїРѕРґС‚РІРµСЂР¶РґС‘РЅРЅР°СЏ РїСЂРёРІСЏР·РєР° РЅРѕРјРµСЂР°.
          </div>

          {message && <div style={resultMessage}>{message}</div>}
        </div>
      </div>
    </ScreenLayout>
  );
}
function InternalTransferScreen({ vkId, accounts, onSuccess }) {
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const primaryAccount = getPrimaryAccount(accounts);

  useEffect(() => {
    if (accounts.length >= 2) {
      setFromAccountId(String(accounts[0].id));
      setToAccountId(String(accounts[1].id));
    } else if (accounts.length === 1) {
      setFromAccountId(String(accounts[0].id));
      setToAccountId(String(accounts[0].id));
    }
  }, [accounts]);

  const submitInternalTransfer = async () => {
    const va = validateAmount(amount);
    if (va) {
      setMessage(va);
      return;
    }
    if (fromAccountId === toAccountId) {
      setMessage("Р’С‹Р±РµСЂРёС‚Рµ СЂР°Р·РЅС‹Рµ СЃС‡РµС‚Р°");
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/transfer/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          from_account_id: Number(fromAccountId),
          to_account_id: Number(toAccountId),
          amount: Number(amount),
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("РџРµСЂРµРІРѕРґ РјРµР¶РґСѓ СЃС‡РµС‚Р°РјРё РІС‹РїРѕР»РЅРµРЅ");
      setAmount("");
      onSuccess();
    } catch (err) {
      console.error(err);
      setMessage("РћС€РёР±РєР° РїРµСЂРµРІРѕРґР°");
    }
  };

  return (
    <ScreenLayout title="РџРµСЂРµРІРѕРґ РјРµР¶РґСѓ СЃРІРѕРёРјРё СЃС‡РµС‚Р°РјРё">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>Р’РЅСѓС‚СЂРµРЅРЅРёР№ РїРµСЂРµРІРѕРґ</div>
        <div style={paymentsShowcaseTitle}>РџРµСЂРµРјРµС‰Р°Р№С‚Рµ РґРµРЅСЊРіРё РјРµР¶РґСѓ СЃРІРѕРёРјРё СЃС‡РµС‚Р°РјРё Р±РµР· РєРѕРјРёСЃСЃРёРё</div>
        <div style={paymentsShowcaseText}>
          РћСЃРЅРѕРІРЅС‹Рј РѕСЃС‚Р°РµС‚СЃСЏ СЃР°РјС‹Р№ РїРµСЂРІС‹Р№ СЃС‡РµС‚, Р° РЅРѕРІС‹Рµ СЃС‡РµС‚Р° РјРѕР¶РЅРѕ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РєР°Рє РЅР°РєРѕРїРёС‚РµР»СЊРЅС‹Рµ РёР»Рё С†РµР»РµРІС‹Рµ.
        </div>
      </div>
      <div style={formCard}>
        {accounts.length < 2 ? (
          <div style={emptyBlock}>Р”Р»СЏ РїРµСЂРµРІРѕРґР° РјРµР¶РґСѓ СЃРІРѕРёРјРё СЃС‡РµС‚Р°РјРё РЅСѓР¶РЅРѕ РјРёРЅРёРјСѓРј 2 СЃС‡РµС‚Р°.</div>
        ) : (
          <>
            <div style={inputLabel}>РЎС‡РµС‚ СЃРїРёСЃР°РЅРёСЏ</div>
            <select style={input} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {repairMojibake(acc.account_name)}
                  {acc.is_primary ? " В· РћСЃРЅРѕРІРЅРѕР№" : ""}
                  {" В· "}
                  {Number(acc.balance).toLocaleString("ru-RU")} в‚Ѕ
                </option>
              ))}
            </select>

            <div style={inputLabel}>РЎС‡РµС‚ Р·Р°С‡РёСЃР»РµРЅРёСЏ</div>
            <select style={input} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {repairMojibake(acc.account_name)}
                  {acc.is_primary ? " В· РћСЃРЅРѕРІРЅРѕР№" : ""}
                  {" В· "}
                  {Number(acc.balance).toLocaleString("ru-RU")} в‚Ѕ
                </option>
              ))}
            </select>

            <div style={inputLabel}>РЎСѓРјРјР°</div>
            <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" type="number" />

            <button style={primaryButton} onClick={submitInternalTransfer}>
              РџРµСЂРµРІРµСЃС‚Рё
            </button>
          </>
        )}

        {primaryAccount ? (
          <div style={{ ...messageBox, marginTop: 16, marginBottom: 0 }}>
            РћСЃРЅРѕРІРЅРѕР№ СЃС‡РµС‚: {repairMojibake(primaryAccount.account_name)} В· {formatMoney(primaryAccount.balance || 0)} в‚Ѕ
          </div>
        ) : null}
        {message && <div style={resultMessage}>{message}</div>}
      </div>
    </ScreenLayout>
  );
}

function InterbankTransferScreen({ vkId, accounts, onSuccess }) {
  const [fromAccountId, setFromAccountId] = useState("");
  const [bank, setBank] = useState("РЎР±РµСЂР±Р°РЅРє");
  const [accountNumber, setAccountNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (accounts.length > 0) setFromAccountId(String(accounts[0].id));
  }, [accounts]);

  const submitInterbankTransfer = async () => {
    const va = validateAmount(amount);
    if (va) {
      setMessage(va);
      return;
    }
    const vn = validateRequired(accountNumber, "РќРѕРјРµСЂ СЃС‡С‘С‚Р° РїРѕР»СѓС‡Р°С‚РµР»СЏ");
    if (vn) {
      setMessage(vn);
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/transfer/interbank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          from_account_id: Number(fromAccountId),
          bank_name: bank,
          recipient_account_number: accountNumber,
          amount: Number(amount),
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("РњРµР¶Р±Р°РЅРєРѕРІСЃРєРёР№ РїРµСЂРµРІРѕРґ РІС‹РїРѕР»РЅРµРЅ");
      setAccountNumber("");
      setAmount("");
      onSuccess();
    } catch (err) {
      console.error(err);
      setMessage("РћС€РёР±РєР° РјРµР¶Р±Р°РЅРєРѕРІСЃРєРѕРіРѕ РїРµСЂРµРІРѕРґР°");
    }
  };

  return (
    <ScreenLayout title="РњРµР¶Р±Р°РЅРєРѕРІСЃРєРёР№ РїРµСЂРµРІРѕРґ">
      <div style={formCard}>
        {accounts.length === 0 ? (
          <div style={emptyBlock}>РќРµС‚ РґРѕСЃС‚СѓРїРЅС‹С… СЃС‡РµС‚РѕРІ</div>
        ) : (
          <>
            <div style={inputLabel}>РЎС‡РµС‚ СЃРїРёСЃР°РЅРёСЏ</div>
            <select style={input} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {repairMojibake(acc.account_name)} В· {Number(acc.balance).toLocaleString("ru-RU")} в‚Ѕ
                </option>
              ))}
            </select>

            <div style={inputLabel}>Р‘Р°РЅРє РїРѕР»СѓС‡Р°С‚РµР»СЏ</div>
            <select style={input} value={bank} onChange={(e) => setBank(e.target.value)}>
              <option>РЎР±РµСЂР±Р°РЅРє</option>
              <option>Рў-Р‘Р°РЅРє</option>
              <option>Р’РўР‘</option>
              <option>РђР»СЊС„Р°-Р‘Р°РЅРє</option>
              <option>Р“Р°Р·РїСЂРѕРјР±Р°РЅРє</option>
              <option>Р РѕСЃСЃРµР»СЊС…РѕР·Р±Р°РЅРє</option>
            </select>

            <div style={inputLabel}>РќРѕРјРµСЂ СЃС‡РµС‚Р° РїРѕР»СѓС‡Р°С‚РµР»СЏ</div>
            <input style={input} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="40817810..." />

            <div style={inputLabel}>РЎСѓРјРјР°</div>
            <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="15000" type="number" />

            <button style={primaryButton} onClick={submitInterbankTransfer}>
              РћС‚РїСЂР°РІРёС‚СЊ
            </button>
          </>
        )}

        {message && <div style={resultMessage}>{message}</div>}
      </div>
    </ScreenLayout>
  );
}

function CreateAccountScreen({ vkId, onSuccess }) {
  const [accountName, setAccountName] = useState("");
  const [currency, setCurrency] = useState("RUB");
  const [message, setMessage] = useState("");

  const submitCreateAccount = async () => {
    if (!accountName) return setMessage("Р’РІРµРґРёС‚Рµ РЅР°Р·РІР°РЅРёРµ СЃС‡С‘С‚Р°");
    try {
      const res = await apiFetch(`${API_BASE}/accounts/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vk_id: String(vkId), account_name: accountName, currency }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setMessage("РЎС‡С‘С‚ РЅРµ СЃРѕР·РґР°РЅ");
      setMessage("РЎС‡С‘С‚ СѓСЃРїРµС€РЅРѕ РѕС‚РєСЂС‹С‚");
      onSuccess();
    } catch {
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  return (
    <ScreenLayout title="РћС‚РєСЂС‹С‚СЊ СЃС‡С‘С‚">
      <div style={paymentsShowcaseCard}><div style={paymentsShowcaseEyebrow}>РќРѕРІС‹Р№ СЃС‡С‘С‚</div><div style={paymentsShowcaseTitle}>РћС‚РєСЂРѕР№С‚Рµ РґРѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Р№ СЃС‡С‘С‚</div></div>
      <div style={menuCard}>
        <div style={inputLabel}>РќР°Р·РІР°РЅРёРµ СЃС‡С‘С‚Р°</div>
        <input style={input} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="РќР°РєРѕРїРёС‚РµР»СЊРЅС‹Р№ СЃС‡С‘С‚" />
        <div style={inputLabel}>Р’Р°Р»СЋС‚Р°</div>
        <select style={input} value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="RUB">RUB</option><option value="USD">USD</option><option value="EUR">EUR</option></select>
        {message ? <div style={messageBox}>{message}</div> : null}
        <button style={primaryButton} onClick={submitCreateAccount}>РћС‚РєСЂС‹С‚СЊ СЃС‡С‘С‚</button>
      </div>
    </ScreenLayout>
  );
}


function TopUpScreen({ vkId }) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("РЎ РєР°СЂС‚С‹ РґСЂСѓРіРѕРіРѕ Р±Р°РЅРєР°");
  const [message, setMessage] = useState("");
  const amountPresets = [1000, 5000, 10000, 25000];

  const submitTopUp = async () => {
    const amountError = validateAmount(amount);
    if (amountError) {
      setMessage(amountError);
      return;
    }
    if (!source) {
      setMessage("Р’С‹Р±РµСЂРёС‚Рµ РёСЃС‚РѕС‡РЅРёРє РїРѕРїРѕР»РЅРµРЅРёСЏ");
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vk_id: vkId, request_type: "РџРѕРїРѕР»РЅРµРЅРёРµ СЃС‡РµС‚Р°", details: `РСЃС‚РѕС‡РЅРёРє: ${source}; РЎСѓРјРјР°: ${amount} в‚Ѕ` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС„РѕСЂРјРёС‚СЊ РїРѕРїРѕР»РЅРµРЅРёРµ"));
        return;
      }
      setMessage("Р—Р°РїСЂРѕСЃ РЅР° РїРѕРїРѕР»РЅРµРЅРёРµ РѕС‚РїСЂР°РІР»РµРЅ");
      setAmount("");
    } catch (err) {
      console.error(err);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  return (
    <ScreenLayout title="РџРѕРїРѕР»РЅРёС‚СЊ СЃС‡РµС‚">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>РџРѕРїРѕР»РЅРµРЅРёРµ</div>
        <div style={paymentsShowcaseTitle}>Р‘С‹СЃС‚СЂРѕРµ РїРѕРїРѕР»РЅРµРЅРёРµ СЃС‡РµС‚Р° Р±РµР· РІРёР·РёС‚Р° РІ РѕС„РёСЃ</div>
        <div style={paymentsShowcaseText}>Р’С‹Р±РµСЂРёС‚Рµ РёСЃС‚РѕС‡РЅРёРє СЃСЂРµРґСЃС‚РІ, СѓРєР°Р¶РёС‚Рµ СЃСѓРјРјСѓ Рё РѕС‚РїСЂР°РІСЊС‚Рµ Р·Р°РїСЂРѕСЃ РЅР° РїРѕРїРѕР»РЅРµРЅРёРµ РїСЂСЏРјРѕ РёР· РјРёРЅРё-РїСЂРёР»РѕР¶РµРЅРёСЏ.</div>
      </div>
      <div style={formCard}>
        <div style={inputLabel}>РСЃС‚РѕС‡РЅРёРє РїРѕРїРѕР»РЅРµРЅРёСЏ</div>
        <select style={input} value={source} onChange={(e) => setSource(e.target.value)}>
          <option>РЎ РєР°СЂС‚С‹ РґСЂСѓРіРѕРіРѕ Р±Р°РЅРєР°</option>
          <option>РЎ РЅР°Р»РёС‡РЅС‹С… С‡РµСЂРµР· РѕС„РёСЃ</option>
          <option>Р’РЅСѓС‚СЂРµРЅРЅРёР№ РїРµСЂРµРІРѕРґ</option>
          <option>РЎ РЅР°РєРѕРїРёС‚РµР»СЊРЅРѕРіРѕ СЃС‡РµС‚Р°</option>
        </select>
        <div style={inputLabel}>РЎСѓРјРјР°</div>
        <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" type="number" />
        <div style={{ ...inputLabel, marginTop: "10px" }}>Р‘С‹СЃС‚СЂС‹Рµ СЃСѓРјРјС‹</div>
        <div style={premiumTagRow}>{amountPresets.map((preset) => <button key={preset} type="button" style={{ ...compactButton, minHeight: "40px", padding: "10px 12px" }} onClick={() => setAmount(String(preset))}>{preset.toLocaleString("ru-RU")} в‚Ѕ</button>)}</div>
        <button style={primaryButton} onClick={submitTopUp}>РћС‚РїСЂР°РІРёС‚СЊ Р·Р°РїСЂРѕСЃ РЅР° РїРѕРїРѕР»РЅРµРЅРёРµ</button>
        {message && <div style={resultMessage}>{repairMojibake(message)}</div>}
      </div>
    </ScreenLayout>
  );
}


function PayScreen({ vkId, onFavoriteSaved }) {
  const [serviceType, setServiceType] = useState("РњРѕР±РёР»СЊРЅР°СЏ СЃРІСЏР·СЊ");
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [message, setMessage] = useState("");
  const amountPresets = [300, 700, 1500, 3000];

  const submitPayment = async () => {
    const amountError = validateAmount(amount);
    if (amountError) return setMessage(amountError);
    if (!serviceType || !provider.trim()) return setMessage("РЈРєР°Р¶РёС‚Рµ РєР°С‚РµРіРѕСЂРёСЋ Рё РїРѕР»СѓС‡Р°С‚РµР»СЏ");
    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vk_id: vkId, request_type: "РћРїР»Р°С‚Р° СѓСЃР»СѓРі", details: `РљР°С‚РµРіРѕСЂРёСЏ: ${serviceType}; РџРѕР»СѓС‡Р°С‚РµР»СЊ: ${provider}; РЎСѓРјРјР°: ${amount} в‚Ѕ` }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕРІРµСЃС‚Рё РїР»Р°С‚РµР¶"));
      setMessage("РџР»Р°С‚РµР¶ РѕС‚РїСЂР°РІР»РµРЅ РЅР° РѕР±СЂР°Р±РѕС‚РєСѓ");
      setProvider("");
      setAmount("");
    } catch (err) {
      console.error(err);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  const saveFavorite = async () => {
    if (!templateName.trim() || !provider.trim()) return setMessage("РЈРєР°Р¶РёС‚Рµ РЅР°Р·РІР°РЅРёРµ С€Р°Р±Р»РѕРЅР° Рё РїРѕР»СѓС‡Р°С‚РµР»СЏ");
    try {
      const res = await apiFetch(`${API_BASE}/favorites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vk_id: vkId, template_name: templateName, payment_type: "service_payment", recipient_value: provider, provider_name: provider }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ С€Р°Р±Р»РѕРЅ"));
      setMessage("РЁР°Р±Р»РѕРЅ СЃРѕС…СЂР°РЅРµРЅ");
      setTemplateName("");
      onFavoriteSaved();
    } catch (err) {
      console.error(err);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  return (
    <ScreenLayout title="РћРїР»Р°С‚Р° СѓСЃР»СѓРі">
      <div style={paymentsShowcaseCard}><div style={paymentsShowcaseEyebrow}>РџР»Р°С‚РµР¶Рё</div><div style={paymentsShowcaseTitle}>РћРїР»Р°С‡РёРІР°Р№С‚Рµ СѓСЃР»СѓРіРё, СЃРІСЏР·СЊ Рё РїРѕРґРїРёСЃРєРё РёР· РѕРґРЅРѕРіРѕ СЂР°Р·РґРµР»Р°</div><div style={paymentsShowcaseText}>РЎРѕР·РґР°РІР°Р№С‚Рµ Р±С‹СЃС‚СЂС‹Рµ СЃРµСЂРІРёСЃРЅС‹Рµ РїР»Р°С‚РµР¶Рё Рё СЃРѕС…СЂР°РЅСЏР№С‚Рµ С€Р°Р±Р»РѕРЅС‹ РґР»СЏ СЂРµРіСѓР»СЏСЂРЅС‹С… РѕРїР»Р°С‚.</div></div>
      <div style={formCard}>
        <div style={inputLabel}>РљР°С‚РµРіРѕСЂРёСЏ</div>
        <select style={input} value={serviceType} onChange={(e) => setServiceType(e.target.value)}><option>РњРѕР±РёР»СЊРЅР°СЏ СЃРІСЏР·СЊ</option><option>РРЅС‚РµСЂРЅРµС‚</option><option>Р–РљРҐ</option><option>РџРѕРґРїРёСЃРєРё</option><option>РћР±СЂР°Р·РѕРІР°РЅРёРµ</option><option>РЁС‚СЂР°С„С‹</option></select>

        <div style={inputLabel}>РџРѕСЃС‚Р°РІС‰РёРє РёР»Рё РЅРѕРјРµСЂ</div>
        <input style={input} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="РќР°РїСЂРёРјРµСЂ: РњРўРЎ / Р РѕСЃС‚РµР»РµРєРѕРј / Р»РёС†РµРІРѕР№ СЃС‡РµС‚" />
        <div style={inputLabel}>РЎСѓРјРјР°</div>
        <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1200" type="number" />
        <div style={{ ...inputLabel, marginTop: "10px" }}>Р‘С‹СЃС‚СЂС‹Рµ СЃСѓРјРјС‹</div>
        <div style={premiumTagRow}>{amountPresets.map((preset) => <button key={preset} type="button" style={{ ...compactButton, minHeight: "40px", padding: "10px 12px" }} onClick={() => setAmount(String(preset))}>{preset.toLocaleString("ru-RU")} в‚Ѕ</button>)}</div>
        <button style={primaryButton} onClick={submitPayment}>РћС‚РїСЂР°РІРёС‚СЊ РїР»Р°С‚РµР¶</button>
        <div style={inputLabel}>РќР°Р·РІР°РЅРёРµ С€Р°Р±Р»РѕРЅР°</div>
        <input style={input} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="РќР°РїСЂРёРјРµСЂ: Р”РѕРјР°С€РЅРёР№ РёРЅС‚РµСЂРЅРµС‚" />
        <button style={secondaryButton} onClick={saveFavorite}>РЎРѕС…СЂР°РЅРёС‚СЊ РІ РёР·Р±СЂР°РЅРЅРѕРµ</button>
        {message && <div style={resultMessage}>{repairMojibake(message)}</div>}
      </div>
    </ScreenLayout>
  );
}



function SecurityScreen({ vkId, userData, cards, onActionDone, onRefresh, setActiveTab }) {
  const [message, setMessage] = useState("");
  const [securityData, setSecurityData] = useState(null);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const mainCard = getPrimaryCard(cards);
  const [mainCardBlocked, setMainCardBlocked] = useState(
    String(repairMojibake(mainCard?.status || "")).toLowerCase().includes("????"),
  );

  useEffect(() => {
    setMainCardBlocked(String(repairMojibake(mainCard?.status || "")).toLowerCase().includes("????"));
  }, [mainCard?.status]);

  const loadSecurity = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/users/${vkId}/security`);
      const data = await res.json().catch(() => ({}));
      setSecurityData(data && !data.error ? data : null);
    } catch (err) {
      console.error(err);
      setSecurityData(null);
    }
  };

  useEffect(() => {
    loadSecurity();
  }, [vkId]);

  const createSecurityRequest = async (type, details) => {
    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          request_type: type,
          details,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "?? ??????? ????????? ??????"));
        return;
      }
      setMessage("?????? ?????????");
      onRefresh();
    } catch (err) {
      console.error(err);
      setMessage("?????? ???????? ???????");
    }
  };

  const blockMainCard = async () => {
    if (!mainCard) {
      setMessage("??? ????? ??? ??????????");
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/cards/${mainCard.id}/block`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "?? ??????? ????????????? ?????"));
        return;
      }
      setMainCardBlocked(true);
      setMessage("????? ?????????????");
      onActionDone();
      loadSecurity();
    } catch (err) {
      console.error(err);
      setMessage("?????? ?????????? ?????");
    }
  };

  const requestMainCardUnblock = async () => {
    if (!mainCard) {
      setMessage("??? ????? ??? ?????????????");
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/cards/${mainCard.id}/request-unblock`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "?? ??????? ????????? ?????? ?? ?????????????"));
        return;
      }
      setMainCardBlocked(true);
      setMessage("?????? ?? ????????????? ?????????");
      onActionDone();
    } catch (err) {
      console.error(err);
      setMessage("?????? ???????? ???????");
    }
  };

  const changePin = async () => {
    const currentError = validatePin(currentPin);
    const nextError = validatePin(newPin);
    if (currentError || nextError) {
      setMessage(currentError || nextError);
      return;
    }
    if (newPin !== newPinConfirm) {
      setMessage("????? PIN ? ????????????? ?? ?????????");
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/users/${vkId}/pin/change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_pin: currentPin,
          new_pin: newPin,
          new_pin_confirm: newPinConfirm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "?? ??????? ???????? PIN"));
        return;
      }
      setCurrentPin("");
      setNewPin("");
      setNewPinConfirm("");
      setMessage("PIN ??????? ????????");
      onRefresh();
      loadSecurity();
    } catch (err) {
      console.error(err);
      setMessage("??????? ??????");
    }
  };

  return (
    <ScreenLayout title="????????????">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>PIN-???</div>
          <div style={premiumMetricValue}>{securityData?.pin_set || userData?.pin_set ? "????????" : "?? ??????????"}</div>
          <div style={operationsSummaryMeta}>???????????? ??? ????? ? ?????????? ????? ??????????.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>???????????</div>
          <div style={premiumMetricValue}>{securityData?.notifications_enabled ? "????????" : "?????????"}</div>
          <div style={operationsSummaryMeta}>?????????? ? ????????? ??????? ?? ?????? ?????.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>??????????? ???????</div>
          <div style={premiumMetricValue}>{securityData?.phone_masked || "?? ??????"}</div>
          <div style={operationsSummaryMeta}>??????? ????? ???????? ? ???????.</div>
        </div>
      </div>

      <div style={menuCard}>
        <div style={screenSubtitle}>?????????? PIN</div>
        <div style={sectionLead}>??????? PIN ??? ????? ? ????-?????????? ? ????????????? ?????????? ????????.</div>
        <div style={inputLabel}>??????? PIN</div>
        <input style={input} type="password" inputMode="numeric" value={currentPin} onChange={(e) => setCurrentPin(sanitizeDigitsOnly(e.target.value))} placeholder="??????? PIN" />
        <div style={inputLabel}>????? PIN</div>
        <input style={input} type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(sanitizeDigitsOnly(e.target.value))} placeholder="????? PIN" />
        <div style={inputLabel}>??????????? ????? PIN</div>
        <input style={input} type="password" inputMode="numeric" value={newPinConfirm} onChange={(e) => setNewPinConfirm(sanitizeDigitsOnly(e.target.value))} placeholder="????????? ????? PIN" />
        <button style={primaryButton} onClick={changePin}>???????? PIN</button>
      </div>

      <div style={premiumPanelGrid}>
        <MenuCard
          title={mainCardBlocked ? "?????????????? ?????" : "????????????? ?????"}
          subtitle={mainCard ? repairMojibake(mainCard.card_number_mask) : "????? ?? ???????"}
          onClick={mainCardBlocked ? requestMainCardUnblock : blockMainCard}
        />
        <MenuCard
          title="?????????????? ????????"
          subtitle="???????? ? ?????????????? ??????????"
          onClick={() => createSecurityRequest("?????????????? ????????", "???????????? ??????? ? ?????????????? ????????")}
        />
        <MenuCard
          title="?????? ?? ????????????"
          subtitle="???????????? ?? ?????? ????????"
          onClick={() => setActiveTab("safetyTips")}
        />
        <MenuCard
          title="???????"
          subtitle="???????, ???????? ? ?????? ??????"
          onClick={() => setActiveTab("profile")}
        />
      </div>

      <div style={menuCard}>
        <div style={screenSubtitle}>??????? ?????? ? ?????????</div>
        <div style={sectionLead}>????????? ????? ? VK Mini App ? ????????????? ????? PIN.</div>
        {!securityData?.login_history?.length ? (
          <div style={emptyBlock}>??????? ?????? ???? ?????.</div>
        ) : (
          <div style={operationsList}>
            {securityData.login_history.map((item) => (
              <div key={item.id} style={premiumOperationRow}>
                <div style={operationIcon}>??</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={premiumOperationTitle}>{repairMojibake(item.device_name || "VK Mini App")}</div>
                  <div style={operationMeta}>
                    {repairMojibake(item.platform || "??????????")} ? {repairMojibake(item.source || "????")} ? {repairMojibake(item.created_at || "")}
                  </div>
                </div>
                <div style={premiumShortcutMeta}>{repairMojibake(item.ip_address || "IP ?????")}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <div style={resultMessage}>{message}</div>}
    </ScreenLayout>
  );
}

function CallBankScreen() {
  return (
    <ScreenLayout title="РџРѕР·РІРѕРЅРёС‚СЊ РІ Р±Р°РЅРє">
      <div style={formCard}>
        <div style={menuCardTitle}>РљРѕРЅС‚Р°РєС‚РЅС‹Р№ С†РµРЅС‚СЂ</div>
        <div style={menuCardSubtitle}>+7 (800) 555-35-35</div>
        <div style={{ marginTop: "12px", color: "#aab9cc", lineHeight: "1.5" }}>
          Р­С‚РѕС‚ РЅРѕРјРµСЂ РјРѕР¶РЅРѕ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РґР»СЏ РєРѕРЅСЃСѓР»СЊС‚Р°С†РёРё, Р±Р»РѕРєРёСЂРѕРІРєРё РєР°СЂС‚С‹ Рё СЂРµС€РµРЅРёСЏ СЃРїРѕСЂРЅС‹С… РѕРїРµСЂР°С†РёР№.
        </div>

        <a href="tel:+78005553535" style={linkButton}>
          РџРѕР·РІРѕРЅРёС‚СЊ
        </a>
      </div>
    </ScreenLayout>
  );
}

function FaqScreen() {
  return (
    <ScreenLayout title="Р§Р°СЃС‚С‹Рµ РІРѕРїСЂРѕСЃС‹">
      <MenuCard title="рџ’і РљР°Рє Р·Р°Р±Р»РѕРєРёСЂРѕРІР°С‚СЊ РєР°СЂС‚Сѓ?" subtitle="РџРµСЂРµР№РґРёС‚Рµ РІ СЂР°Р·РґРµР» Р‘РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ" />
      <MenuCard title="рџ’ё РљР°Рє СЃРґРµР»Р°С‚СЊ РїРµСЂРµРІРѕРґ?" subtitle="РћС‚РєСЂРѕР№С‚Рµ РџР»Р°С‚РµР¶Рё в†’ РџРµСЂРµРІРѕРґ РїРѕ VK ID" />
      <MenuCard title="рџ“„ РљР°Рє РїРѕРґР°С‚СЊ Р·Р°СЏРІРєСѓ?" subtitle="Р“Р»Р°РІРЅР°СЏ в†’ Р—Р°СЏРІРєР° РёР»Рё Р•С‰Рµ в†’ РџРѕРґР°С‚СЊ Р·Р°СЏРІРєСѓ" />
      <MenuCard title="рџ’¬ РљР°Рє СЃРІСЏР·Р°С‚СЊСЃСЏ СЃ РїРѕРґРґРµСЂР¶РєРѕР№?" subtitle="РћС‚РєСЂРѕР№С‚Рµ РћРЅР»Р°Р№РЅ-С‡Р°С‚ РёР»Рё РџРѕР·РІРѕРЅРёС‚СЊ РІ Р±Р°РЅРє" />
    </ScreenLayout>
  );
}

function ProblemReportScreen({ vkId }) {
  const [problemText, setProblemText] = useState("");
  const [message, setMessage] = useState("");
  const submitProblem = async () => {
    if (!problemText.trim()) return setMessage("РћРїРёС€РёС‚Рµ РїСЂРѕР±Р»РµРјСѓ");
    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vk_id: vkId, request_type: "РЎРѕРѕР±С‰РёС‚СЊ Рѕ РїСЂРѕР±Р»РµРјРµ", details: problemText }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РѕР±СЂР°С‰РµРЅРёРµ"));
      setMessage("РЎРѕРѕР±С‰РµРЅРёРµ Рѕ РїСЂРѕР±Р»РµРјРµ РѕС‚РїСЂР°РІР»РµРЅРѕ");
      setProblemText("");
    } catch (err) {
      console.error(err);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };
  return (
    <ScreenLayout title="РЎРѕРѕР±С‰РёС‚СЊ Рѕ РїСЂРѕР±Р»РµРјРµ">
      <div style={paymentsShowcaseCard}><div style={paymentsShowcaseEyebrow}>РЎРµСЂРІРёСЃ</div><div style={paymentsShowcaseTitle}>Р Р°СЃСЃРєР°Р¶РёС‚Рµ Рѕ РїСЂРѕР±Р»РµРјРµ, Рё Р±Р°РЅРє РІРѕР·СЊРјРµС‚ РµРµ РІ СЂР°Р±РѕС‚Сѓ</div><div style={paymentsShowcaseText}>РћРїРёС€РёС‚Рµ СЃРёС‚СѓР°С†РёСЋ РєР°Рє РјРѕР¶РЅРѕ РїРѕРґСЂРѕР±РЅРµРµ: С‡С‚Рѕ РїСЂРѕРёР·РѕС€Р»Рѕ, РіРґРµ РІРѕР·РЅРёРєР»Р° РѕС€РёР±РєР° Рё С‡С‚Рѕ РІС‹ РѕР¶РёРґР°Р»Рё СѓРІРёРґРµС‚СЊ.</div></div>
      <div style={formCard}><div style={inputLabel}>РћРїРёСЃР°РЅРёРµ РїСЂРѕР±Р»РµРјС‹</div><textarea style={textarea} value={problemText} onChange={(e) => setProblemText(e.target.value)} placeholder="РќР°РїСЂРёРјРµСЂ: РЅРµ РїСЂРѕС…РѕРґРёС‚ РїРµСЂРµРІРѕРґ, РЅРµ РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ РєР°СЂС‚Р°, РѕС€РёР±РєР° РїСЂРё РѕРїР»Р°С‚Рµ" /><button style={primaryButton} onClick={submitProblem}>РћС‚РїСЂР°РІРёС‚СЊ Р·Р°РїСЂРѕСЃ</button>{message && <div style={resultMessage}>{repairMojibake(message)}</div>}</div>
    </ScreenLayout>
  );
}


function ServiceRequestsScreen({ vkId }) {
  const [requests, setRequests] = useState([]);
  useEffect(() => {
    apiFetch(`${API_BASE}/users/${vkId}/service-requests`).then((res) => res.json()).then((data) => setRequests(Array.isArray(data) ? data : [])).catch((err) => console.error("РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё СЃРµСЂРІРёСЃРЅС‹С… Р·Р°РїСЂРѕСЃРѕРІ:", err));
  }, [vkId]);
  const openRequests = requests.filter((item) => !repairMojibake(item.status || "").toLowerCase().includes("РІС‹РїРѕР»РЅ")).length;
  return (
    <ScreenLayout title="РЎРµСЂРІРёСЃРЅС‹Рµ Р·Р°РїСЂРѕСЃС‹">
      <div style={premiumMetricsGrid}><div style={premiumMetricCard}><div style={premiumMetricLabel}>Р’СЃРµРіРѕ Р·Р°РїСЂРѕСЃРѕРІ</div><div style={premiumMetricValue}>{requests.length}</div><div style={operationsSummaryMeta}>Р—РґРµСЃСЊ СЃРѕР±СЂР°РЅС‹ РѕР±СЂР°С‰РµРЅРёСЏ РїРѕ СЃРµСЂРІРёСЃР°Рј, РїР»Р°С‚РµР¶Р°Рј Рё РїСЂРѕР±Р»РµРјР°Рј.</div></div><div style={premiumMetricCard}><div style={premiumMetricLabel}>РђРєС‚РёРІРЅС‹Рµ</div><div style={premiumMetricValue}>{openRequests}</div><div style={operationsSummaryMeta}>Р—Р°РїСЂРѕСЃС‹, РїРѕ РєРѕС‚РѕСЂС‹Рј Р±Р°РЅРє РµС‰Рµ РЅРµ Р·Р°РєСЂС‹Р» РѕР±СЂР°Р±РѕС‚РєСѓ.</div></div></div>
      {requests.length === 0 ? <div style={emptyBlock}>РЎРµСЂРІРёСЃРЅС‹С… Р·Р°РїСЂРѕСЃРѕРІ РїРѕРєР° РЅРµС‚</div> : <div style={{ display: "grid", gap: "14px" }}>{requests.map((item) => { const tone = serviceRequestStatusTone(item.status); return <div key={item.id} style={applicationCard}><div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 700, color: "#eef5ff", marginBottom: "8px" }}>{repairMojibake(item.request_type || "РЎРµСЂРІРёСЃРЅС‹Р№ Р·Р°РїСЂРѕСЃ")}</div><div style={{ color: "#9fb3c8", lineHeight: 1.6 }}>{repairMojibake(item.details || "")}</div></div><div style={{ ...pill, ...tone }}>{repairMojibake(item.status || "РќР° СЂР°СЃСЃРјРѕС‚СЂРµРЅРёРё")}</div></div><div style={{ marginTop: "12px", fontSize: "13px", color: "#8da8c4" }}>{repairMojibake(item.created_at || "")}</div></div>; })}</div>}
    </ScreenLayout>
  );
}

function ChatScreenSafe({ vkId }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const quickTopics = [
    "РљР°Рє РїРѕРїРѕР»РЅРёС‚СЊ Р±Р°Р»Р°РЅСЃ?",
    "РљР°Рє РїРµСЂРµРІРµСЃС‚Рё РїРѕ VK ID?",
    "РљР°Рє РёР·РјРµРЅРёС‚СЊ PIN-РєРѕРґ?",
    "РќСѓР¶РЅРѕ СЂР°Р·Р±Р»РѕРєРёСЂРѕРІР°С‚СЊ РєР°СЂС‚Сѓ",
  ];

  const loadMessages = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/support/messages/${vkId}`);
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setMessages([]);
    }
  };

  useEffect(() => {
    loadMessages();
  }, [vkId]);

  const sendMessage = async () => {
    const validationError = validateMessage(text);
    if (validationError) {
      setMessage(validationError);
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/support/ai-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vk_id: String(vkId), message: text.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ"));
        return;
      }
      setText("");
      setMessage(
        data.service_request
          ? `Р”РёР°Р»РѕРі РїРµСЂРµРґР°РЅ РѕРїРµСЂР°С‚РѕСЂСѓ: ${repairMojibake(data.service_request.request_type || "РѕР±СЂР°С‰РµРЅРёРµ")}`
          : ""
      );
      await loadMessages();
    } catch (error) {
      console.error(error);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  const clearChat = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/support/messages/${vkId}/clear`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‡РёСЃС‚РёС‚СЊ С‡Р°С‚"));
        return;
      }
      setMessages([]);
      setMessage("Р§Р°С‚ РѕС‡РёС‰РµРЅ");
    } catch (error) {
      console.error(error);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  return (
    <ScreenLayout title="Р§Р°С‚ РїРѕРґРґРµСЂР¶РєРё">
      <div style={menuCard}>
        <div style={sectionHeader}>
          <div>
            <div style={screenSubtitle}>Р‘С‹СЃС‚СЂС‹Рµ С‚РµРјС‹</div>
            <div style={sectionLead}>Р’С‹Р±РµСЂРёС‚Рµ РіРѕС‚РѕРІС‹Р№ РІРѕРїСЂРѕСЃ РёР»Рё РЅР°РїРёС€РёС‚Рµ СЃРІРѕР№.</div>
          </div>
          <button style={miniButton} onClick={clearChat}>РћС‡РёСЃС‚РёС‚СЊ С‡Р°С‚</button>
        </div>
        <div style={premiumTagRow}>
          {quickTopics.map((item) => (
            <button key={item} type="button" style={compactButton} onClick={() => setText(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>

      <div style={menuCard}>
        <div style={screenSubtitle}>Р”РёР°Р»РѕРі</div>
        <div style={sectionLead}>РСЃС‚РѕСЂРёСЏ СЃРѕРѕР±С‰РµРЅРёР№ СЃ AI-РїРѕРјРѕС‰РЅРёРєРѕРј Рё РѕРїРµСЂР°С‚РѕСЂР°РјРё Р±Р°РЅРєР°.</div>
        {messages.length === 0 ? (
          <div style={emptyBlock}>Р§Р°С‚ РїРѕРєР° РїСѓСЃС‚. РќР°С‡РЅРёС‚Рµ РґРёР°Р»РѕРі РїРµСЂРІС‹Рј.</div>
        ) : (
          <div style={operationsList}>
            {messages.map((item) => {
              const senderLabel =
                repairMojibake(item.sender_label || "") ||
                (item.sender_type === "user"
                  ? "Р’С‹"
                  : item.sender_type === "operator"
                    ? "РћРїРµСЂР°С‚РѕСЂ"
                    : "AI-РїРѕРјРѕС‰РЅРёРє");

              return (
                <div key={item.id} style={menuCard}>
                  <div style={screenSubtitle}>{senderLabel}</div>
                  <div style={{ color: "#eaf1ff", marginTop: 8, lineHeight: 1.6 }}>
                    {repairMojibake(item.text || item.message || "")}
                  </div>
                  <div style={{ color: "#8ca0ba", fontSize: 13, marginTop: 8 }}>
                    {repairMojibake(item.created_at || "")}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={menuCard}>
        <div style={screenSubtitle}>РќРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ</div>
        <div style={sectionLead}>РћРїРёС€РёС‚Рµ РїСЂРѕР±Р»РµРјСѓ РёР»Рё Р·Р°РґР°Р№С‚Рµ РІРѕРїСЂРѕСЃ РїРѕ РїРµСЂРµРІРѕРґР°Рј, РєР°СЂС‚Р°Рј Рё РїСЂРѕРґСѓРєС‚Р°Рј.</div>
        <textarea
          style={{ ...textarea, minHeight: 140 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="РќР°РїСЂРёРјРµСЂ: РЅРµ РїСЂРѕС…РѕРґРёС‚ РїРµСЂРµРІРѕРґ РїРѕ VK ID"
        />
        {message ? <div style={messageBox}>{message}</div> : null}
        <button style={primaryButton} onClick={sendMessage}>РћС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ</button>
      </div>
    </ScreenLayout>
  );
}

function ApplicationScreenSafe({ vkId }) {
  const productConfigs = {
    "Р”РµР±РµС‚РѕРІР°СЏ РєР°СЂС‚Р°": {
      subtitle: "РљР°СЂС‚Р° РґР»СЏ РµР¶РµРґРЅРµРІРЅС‹С… РїРѕРєСѓРїРѕРє, РїРµСЂРµРІРѕРґРѕРІ Рё РѕРЅР»Р°Р№РЅ-РѕРїР»Р°С‚С‹.",
      fields: [
        { key: "fullName", label: "РРјСЏ Рё С„Р°РјРёР»РёСЏ", placeholder: "Р’Р°С€Рµ РёРјСЏ Рё С„Р°РјРёР»РёСЏ" },
        { key: "phone", label: "РўРµР»РµС„РѕРЅ", placeholder: "+79990000000" },
        { key: "deliveryCity", label: "Р“РѕСЂРѕРґ РґРѕСЃС‚Р°РІРєРё", placeholder: "РљР°Р»РёРЅРёРЅРіСЂР°Рґ" },
      ],
    },
    "РљСЂРµРґРёС‚РЅР°СЏ РєР°СЂС‚Р°": {
      subtitle: "РљР°СЂС‚Р° СЃ РєСЂРµРґРёС‚РЅС‹Рј Р»РёРјРёС‚РѕРј Рё Р±Р°Р·РѕРІРѕР№ РѕС†РµРЅРєРѕР№ РґРѕС…РѕРґР°.",
      fields: [
        { key: "fullName", label: "РРјСЏ Рё С„Р°РјРёР»РёСЏ", placeholder: "Р’Р°С€Рµ РёРјСЏ Рё С„Р°РјРёР»РёСЏ" },
        { key: "phone", label: "РўРµР»РµС„РѕРЅ", placeholder: "+79990000000" },
        { key: "income", label: "Р•Р¶РµРјРµСЃСЏС‡РЅС‹Р№ РґРѕС…РѕРґ", placeholder: "120000" },
        { key: "limit", label: "Р–РµР»Р°РµРјС‹Р№ Р»РёРјРёС‚", placeholder: "300000" },
      ],
    },
    "Р’РєР»Р°Рґ": {
      subtitle: "РћС„РѕСЂРјР»РµРЅРёРµ РІРєР»Р°РґР° СЃ РІС‹Р±РѕСЂРѕРј СЃСѓРјРјС‹ Рё СЃСЂРѕРєР°.",
      fields: [
        { key: "fullName", label: "РРјСЏ Рё С„Р°РјРёР»РёСЏ", placeholder: "Р’Р°С€Рµ РёРјСЏ Рё С„Р°РјРёР»РёСЏ" },
        { key: "phone", label: "РўРµР»РµС„РѕРЅ", placeholder: "+79990000000" },
        { key: "amount", label: "РЎСѓРјРјР° РІРєР»Р°РґР°", placeholder: "500000" },
        { key: "term", label: "РЎСЂРѕРє", placeholder: "12 РјРµСЃСЏС†РµРІ" },
      ],
    },
    "РќР°РєРѕРїРёС‚РµР»СЊРЅС‹Р№ СЃС‡РµС‚": {
      subtitle: "Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Р№ СЃС‡РµС‚ РґР»СЏ С…СЂР°РЅРµРЅРёСЏ Рё РЅР°РєРѕРїР»РµРЅРёСЏ СЃСЂРµРґСЃС‚РІ.",
      fields: [
        { key: "fullName", label: "РРјСЏ Рё С„Р°РјРёР»РёСЏ", placeholder: "Р’Р°С€Рµ РёРјСЏ Рё С„Р°РјРёР»РёСЏ" },
        { key: "phone", label: "РўРµР»РµС„РѕРЅ", placeholder: "+79990000000" },
        { key: "amount", label: "РџР»Р°РЅРёСЂСѓРµРјР°СЏ СЃСѓРјРјР°", placeholder: "150000" },
      ],
    },
    "РљСЂРµРґРёС‚": {
      subtitle: "РџРѕРґР°С‡Р° Р·Р°СЏРІРєРё РЅР° РєСЂРµРґРёС‚ СЃ Р±Р°Р·РѕРІРѕР№ РѕС†РµРЅРєРѕР№ РїР°СЂР°РјРµС‚СЂРѕРІ.",
      fields: [
        { key: "fullName", label: "РРјСЏ Рё С„Р°РјРёР»РёСЏ", placeholder: "Р’Р°С€Рµ РёРјСЏ Рё С„Р°РјРёР»РёСЏ" },
        { key: "phone", label: "РўРµР»РµС„РѕРЅ", placeholder: "+79990000000" },
        { key: "income", label: "Р•Р¶РµРјРµСЃСЏС‡РЅС‹Р№ РґРѕС…РѕРґ", placeholder: "120000" },
        { key: "amount", label: "РЎСѓРјРјР° РєСЂРµРґРёС‚Р°", placeholder: "700000" },
        { key: "term", label: "РЎСЂРѕРє РєСЂРµРґРёС‚Р°", placeholder: "36 РјРµСЃСЏС†РµРІ" },
      ],
    },
  };

  const [productType, setProductType] = useState("Р”РµР±РµС‚РѕРІР°СЏ РєР°СЂС‚Р°");
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    deliveryCity: "",
    income: "",
    limit: "",
    amount: "",
    term: "",
  });
  const [message, setMessage] = useState("");
  const config = productConfigs[productType];

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const sendApplication = async () => {
    const normalizedPhone = normalizeRussianPhone(form.phone);
    if (!form.fullName.trim() || !form.phone.trim()) {
      setMessage("Р—Р°РїРѕР»РЅРёС‚Рµ РёРјСЏ Рё С‚РµР»РµС„РѕРЅ");
      return;
    }
    if (!isValidRussianPhone(normalizedPhone)) {
      setMessage("РЈРєР°Р¶РёС‚Рµ С‚РµР»РµС„РѕРЅ РІ С„РѕСЂРјР°С‚Рµ +7XXXXXXXXXX");
      return;
    }

    const details = config.fields
      .map((field) => `${field.label}: ${form[field.key] || "РЅРµ СѓРєР°Р·Р°РЅРѕ"}`)
      .join("; ");

    try {
      const res = await apiFetch(`${API_BASE}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: String(vkId),
          product_type: productType,
          details,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ Р·Р°СЏРІРєСѓ"));
        return;
      }
      setMessage("Р—Р°СЏРІРєР° РѕС‚РїСЂР°РІР»РµРЅР° РІ Р±Р°РЅРє");
    } catch (error) {
      console.error(error);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  return (
    <ScreenLayout title="РќРѕРІС‹Р№ РїСЂРѕРґСѓРєС‚">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>Р—Р°СЏРІРєР°</div>
        <div style={paymentsShowcaseTitle}>{productType}</div>
        <div style={paymentsShowcaseText}>{config.subtitle}</div>
      </div>
      <div style={premiumTagRow}>
        {Object.keys(productConfigs).map((name) => (
          <button
            key={name}
            type="button"
            style={{
              ...compactButton,
              background: productType === name ? "#2d5f96" : compactButton.background,
              borderColor: productType === name ? "#5f9fe4" : compactButton.border,
            }}
            onClick={() => setProductType(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div style={menuCard}>
        {config.fields.map((field) => (
          <div key={field.key}>
            <div style={inputLabel}>{field.label}</div>
            <input
              style={input}
              value={form[field.key] || ""}
              onChange={(e) => updateField(field.key, e.target.value)}
              placeholder={field.placeholder}
            />
          </div>
        ))}
        {message ? <div style={messageBox}>{message}</div> : null}
        <button style={primaryButton} onClick={sendApplication}>РћС‚РїСЂР°РІРёС‚СЊ Р·Р°СЏРІРєСѓ</button>
      </div>
    </ScreenLayout>
  );
}

function ApplicationsListScreenSafe({ vkId }) {
  const [applications, setApplications] = useState([]);

  useEffect(() => {
    apiFetch(`${API_BASE}/users/${vkId}/applications`)
      .then((res) => res.json())
      .then((data) => setApplications(Array.isArray(data) ? data : []))
      .catch((error) => {
        console.error(error);
        setApplications([]);
      });
  }, [vkId]);

  const activeCount = applications.filter((item) => {
    const status = repairMojibake(item.status || "").toLowerCase();
    return !status.includes("РѕРґРѕР±СЂРµРЅ") && !status.includes("РѕС‚РєР»РѕРЅ");
  }).length;

  return (
    <ScreenLayout title="РњРѕРё Р·Р°СЏРІРєРё">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Р’СЃРµРіРѕ Р·Р°СЏРІРѕРє</div>
          <div style={premiumMetricValue}>{applications.length}</div>
          <div style={operationsSummaryMeta}>Р’СЃРµ Р·Р°РїСЂРѕСЃС‹ РЅР° Р±Р°РЅРєРѕРІСЃРєРёРµ РїСЂРѕРґСѓРєС‚С‹ Рё СѓСЃР»СѓРіРё.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Р’ СЂР°Р±РѕС‚Рµ</div>
          <div style={premiumMetricValue}>{activeCount}</div>
          <div style={operationsSummaryMeta}>Р—Р°СЏРІРєРё, РїРѕ РєРѕС‚РѕСЂС‹Рј Р±Р°РЅРє РµС‰Рµ РїСЂРёРЅРёРјР°РµС‚ СЂРµС€РµРЅРёРµ.</div>
        </div>
      </div>

      <div style={menuCard}>
        <div style={screenSubtitle}>РЎС‚Р°С‚СѓСЃС‹ Р·Р°СЏРІРѕРє</div>
        <div style={sectionLead}>Р—РґРµСЃСЊ СЃРѕР±СЂР°РЅС‹ РІР°С€Рё Р·Р°СЏРІРєРё РЅР° РїСЂРѕРґСѓРєС‚С‹ Рё СЃРµСЂРІРёСЃС‹ Р±Р°РЅРєР°.</div>
        {applications.length === 0 ? (
          <div style={emptyBlock}>Р—Р°СЏРІРѕРє РїРѕРєР° РЅРµС‚</div>
        ) : (
          <div style={operationsList}>
            {applications.map((item) => {
              const tone = applicationStatusTone(item.status);
              return (
                <div key={item.id} style={applicationCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={menuCardTitle}>
                        {repairMojibake(item.product_type || "Р‘Р°РЅРєРѕРІСЃРєРёР№ РїСЂРѕРґСѓРєС‚")}
                      </div>
                      <div style={menuCardSubtitle}>{repairMojibake(item.details || "")}</div>
                    </div>
                    <div style={{ ...pill, ...tone }}>
                      {repairMojibake(item.status || "РќР° СЂР°СЃСЃРјРѕС‚СЂРµРЅРёРё")}
                    </div>
                  </div>
                  <div style={{ marginTop: 12, color: "#8ea8c6", fontSize: 13 }}>
                    {repairMojibake(item.created_at || "")}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ScreenLayout>
  );
}

function TopUpScreenSafe({ vkId, accounts, onSuccess }) {
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("РЎ РєР°СЂС‚С‹ РґСЂСѓРіРѕРіРѕ Р±Р°РЅРєР°");
  const [message, setMessage] = useState("");
  const amountPresets = [1000, 5000, 10000, 25000];

  useEffect(() => {
    if (!accountId && accounts?.length) {
      const primary = getPrimaryAccount(accounts);
      setAccountId(String(primary?.id || accounts[0].id));
    }
  }, [accounts, accountId]);

  const submitTopUp = async () => {
    const amountError = validateAmount(amount);
    if (amountError) {
      setMessage(amountError);
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          account_id: Number(accountId),
          source,
          amount: Number(amount),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС„РѕСЂРјРёС‚СЊ РїРѕРїРѕР»РЅРµРЅРёРµ"));
        return;
      }
      setMessage("РЎС‡РµС‚ РїРѕРїРѕР»РЅРµРЅ");
      setAmount("");
      onSuccess?.();
    } catch (error) {
      console.error(error);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  return (
    <ScreenLayout title="РџРѕРїРѕР»РЅРёС‚СЊ СЃС‡РµС‚">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>РџРѕРїРѕР»РЅРµРЅРёРµ</div>
        <div style={paymentsShowcaseTitle}>Р‘С‹СЃС‚СЂРѕРµ РїРѕРїРѕР»РЅРµРЅРёРµ СЃС‡РµС‚Р°</div>
        <div style={paymentsShowcaseText}>Р’С‹Р±РµСЂРёС‚Рµ РёСЃС‚РѕС‡РЅРёРє СЃСЂРµРґСЃС‚РІ Рё СЃСѓРјРјСѓ РїРѕРїРѕР»РЅРµРЅРёСЏ.</div>
      </div>
      <div style={formCard}>
        <div style={inputLabel}>РЎС‡РµС‚ Р·Р°С‡РёСЃР»РµРЅРёСЏ</div>
        <select style={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {(accounts || []).map((acc) => (
            <option key={acc.id} value={acc.id}>
              {repairMojibake(acc.account_name)} В· {formatMoney(acc.balance)} в‚Ѕ
            </option>
          ))}
        </select>
        <div style={inputLabel}>РСЃС‚РѕС‡РЅРёРє РїРѕРїРѕР»РЅРµРЅРёСЏ</div>
        <select style={input} value={source} onChange={(e) => setSource(e.target.value)}>
          <option>РЎ РєР°СЂС‚С‹ РґСЂСѓРіРѕРіРѕ Р±Р°РЅРєР°</option>
          <option>РќР°Р»РёС‡РЅС‹РјРё С‡РµСЂРµР· РѕС„РёСЃ</option>
          <option>Р’РЅСѓС‚СЂРµРЅРЅРёР№ РїРµСЂРµРІРѕРґ</option>
          <option>РЎ РЅР°РєРѕРїРёС‚РµР»СЊРЅРѕРіРѕ СЃС‡РµС‚Р°</option>
        </select>
        <div style={inputLabel}>РЎСѓРјРјР°</div>
        <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" type="number" />
        <div style={{ ...inputLabel, marginTop: "10px" }}>Р‘С‹СЃС‚СЂС‹Рµ СЃСѓРјРјС‹</div>
        <div style={premiumTagRow}>
          {amountPresets.map((preset) => (
            <button key={preset} type="button" style={{ ...compactButton, minHeight: "40px", padding: "10px 12px" }} onClick={() => setAmount(String(preset))}>
              {preset.toLocaleString("ru-RU")} в‚Ѕ
            </button>
          ))}
        </div>
        {message ? <div style={messageBox}>{message}</div> : null}
        <button style={primaryButton} onClick={submitTopUp}>РџРѕРїРѕР»РЅРёС‚СЊ СЃС‡РµС‚</button>
      </div>
    </ScreenLayout>
  );
}

function PayScreenSafe({ vkId, accounts, onSuccess, onFavoriteSaved }) {
  const [fromAccountId, setFromAccountId] = useState("");
  const [serviceType, setServiceType] = useState("РњРѕР±РёР»СЊРЅР°СЏ СЃРІСЏР·СЊ");
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!fromAccountId && accounts?.length) {
      const primary = getPrimaryAccount(accounts);
      setFromAccountId(String(primary?.id || accounts[0].id));
    }
  }, [accounts, fromAccountId]);

  const submitPayment = async () => {
    const amountError = validateAmount(amount);
    if (amountError) {
      setMessage(amountError);
      return;
    }
    if (!provider.trim()) {
      setMessage("РЈРєР°Р¶РёС‚Рµ РїРѕСЃС‚Р°РІС‰РёРєР° РёР»Рё РЅРѕРјРµСЂ");
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/service-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          from_account_id: Number(fromAccountId),
          service_type: serviceType,
          provider,
          amount: Number(amount),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РїР»Р°С‚РµР¶"));
        return;
      }
      setMessage("РџР»Р°С‚РµР¶ РІС‹РїРѕР»РЅРµРЅ");
      setAmount("");
      setProvider("");
      onSuccess?.();
    } catch (error) {
      console.error(error);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  const saveFavorite = async () => {
    if (!templateName.trim() || !provider.trim()) {
      setMessage("РЈРєР°Р¶РёС‚Рµ РЅР°Р·РІР°РЅРёРµ С€Р°Р±Р»РѕРЅР° Рё РїРѕСЃС‚Р°РІС‰РёРєР°");
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          template_name: templateName,
          payment_type: "service_payment",
          recipient_value: provider,
          provider_name: provider,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ С€Р°Р±Р»РѕРЅ"));
        return;
      }
      setMessage("РЁР°Р±Р»РѕРЅ СЃРѕС…СЂР°РЅРµРЅ");
      setTemplateName("");
      onFavoriteSaved();
    } catch (error) {
      console.error(error);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  return (
    <ScreenLayout title="РћРїР»Р°С‚Р° СѓСЃР»СѓРі">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>РџР»Р°С‚РµР¶Рё</div>
        <div style={paymentsShowcaseTitle}>РћРїР»Р°С‡РёРІР°Р№С‚Рµ СѓСЃР»СѓРіРё РёР· РјРёРЅРё-РїСЂРёР»РѕР¶РµРЅРёСЏ</div>
        <div style={paymentsShowcaseText}>РџРѕРґРіРѕС‚РѕРІСЊС‚Рµ РїР»Р°С‚РµР¶ Рё СЃРѕС…СЂР°РЅРёС‚Рµ С€Р°Р±Р»РѕРЅ РґР»СЏ РїРѕРІС‚РѕСЂРѕРІ.</div>
      </div>
      <div style={formCard}>
        <div style={inputLabel}>РЎС‡РµС‚ СЃРїРёСЃР°РЅРёСЏ</div>
        <select style={input} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
          {(accounts || []).map((acc) => (
            <option key={acc.id} value={acc.id}>
              {repairMojibake(acc.account_name)} В· {formatMoney(acc.balance)} в‚Ѕ
            </option>
          ))}
        </select>
        <div style={inputLabel}>РљР°С‚РµРіРѕСЂРёСЏ</div>
        <select style={input} value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
          <option>РњРѕР±РёР»СЊРЅР°СЏ СЃРІСЏР·СЊ</option>
          <option>РРЅС‚РµСЂРЅРµС‚</option>
          <option>Р–РљРҐ</option>
          <option>РџРѕРґРїРёСЃРєРё</option>
          <option>РћР±СЂР°Р·РѕРІР°РЅРёРµ</option>
          <option>РЁС‚СЂР°С„С‹</option>
        </select>
        <div style={inputLabel}>РџРѕСЃС‚Р°РІС‰РёРє РёР»Рё РЅРѕРјРµСЂ</div>
        <input style={input} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="РќР°РїСЂРёРјРµСЂ: РњРўРЎ РёР»Рё РЅРѕРјРµСЂ РґРѕРіРѕРІРѕСЂР°" />
        <div style={inputLabel}>РЎСѓРјРјР°</div>
        <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1200" type="number" />
        <div style={inputLabel}>РќР°Р·РІР°РЅРёРµ С€Р°Р±Р»РѕРЅР°</div>
        <input style={input} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="РќР°РїСЂРёРјРµСЂ: Р”РѕРјР°С€РЅРёР№ РёРЅС‚РµСЂРЅРµС‚" />
        {message ? <div style={messageBox}>{message}</div> : null}
        <div style={detailActionBar}>
          <button style={primaryButton} onClick={submitPayment}>РћС‚РїСЂР°РІРёС‚СЊ РїР»Р°С‚РµР¶</button>
          <button style={secondaryButton} onClick={saveFavorite}>РЎРѕС…СЂР°РЅРёС‚СЊ С€Р°Р±Р»РѕРЅ</button>
        </div>
      </div>
    </ScreenLayout>
  );
}

function ProblemReportScreenSafe({ vkId }) {
  const [problemText, setProblemText] = useState("");
  const [message, setMessage] = useState("");

  const submitProblem = async () => {
    if (!problemText.trim()) {
      setMessage("РћРїРёС€РёС‚Рµ РїСЂРѕР±Р»РµРјСѓ");
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          request_type: "РЎРѕРѕР±С‰РёС‚СЊ Рѕ РїСЂРѕР±Р»РµРјРµ",
          details: problemText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РѕР±СЂР°С‰РµРЅРёРµ"));
        return;
      }
      setMessage("РЎРѕРѕР±С‰РµРЅРёРµ Рѕ РїСЂРѕР±Р»РµРјРµ РѕС‚РїСЂР°РІР»РµРЅРѕ");
      setProblemText("");
    } catch (error) {
      console.error(error);
      setMessage("РЎРµС‚РµРІР°СЏ РѕС€РёР±РєР°");
    }
  };

  return (
    <ScreenLayout title="РЎРѕРѕР±С‰РёС‚СЊ Рѕ РїСЂРѕР±Р»РµРјРµ">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>РЎРµСЂРІРёСЃ</div>
        <div style={paymentsShowcaseTitle}>Р Р°СЃСЃРєР°Р¶РёС‚Рµ Рѕ РїСЂРѕР±Р»РµРјРµ, Рё Р±Р°РЅРє РІРѕР·СЊРјРµС‚ РµРµ РІ СЂР°Р±РѕС‚Сѓ</div>
        <div style={paymentsShowcaseText}>РћРїРёС€РёС‚Рµ, С‡С‚Рѕ РёРјРµРЅРЅРѕ РїСЂРѕРёР·РѕС€Р»Рѕ Рё РєР°РєРѕР№ СЂРµР·СѓР»СЊС‚Р°С‚ РІС‹ РѕР¶РёРґР°Р»Рё.</div>
      </div>
      <div style={formCard}>
        <div style={inputLabel}>РћРїРёСЃР°РЅРёРµ РїСЂРѕР±Р»РµРјС‹</div>
        <textarea
          style={textarea}
          value={problemText}
          onChange={(e) => setProblemText(e.target.value)}
          placeholder="РќР°РїСЂРёРјРµСЂ: РЅРµ РїСЂРѕС…РѕРґРёС‚ РїРµСЂРµРІРѕРґ РёР»Рё РЅРµ РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ РєР°СЂС‚Р°"
        />
        {message ? <div style={messageBox}>{message}</div> : null}
        <button style={primaryButton} onClick={submitProblem}>РћС‚РїСЂР°РІРёС‚СЊ Р·Р°РїСЂРѕСЃ</button>
      </div>
    </ScreenLayout>
  );
}

function ServiceRequestsScreenSafe({ vkId }) {
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    apiFetch(`${API_BASE}/users/${vkId}/service-requests`)
      .then((res) => res.json())
      .then((data) => setRequests(Array.isArray(data) ? data : []))
      .catch((error) => {
        console.error(error);
        setRequests([]);
      });
  }, [vkId]);

  const activeCount = requests.filter(
    (item) => !repairMojibake(item.status || "").toLowerCase().includes("РІС‹РїРѕР»РЅ")
  ).length;

  return (
    <ScreenLayout title="РЎРµСЂРІРёСЃРЅС‹Рµ Р·Р°РїСЂРѕСЃС‹">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Р’СЃРµРіРѕ Р·Р°РїСЂРѕСЃРѕРІ</div>
          <div style={premiumMetricValue}>{requests.length}</div>
          <div style={operationsSummaryMeta}>РћР±СЂР°С‰РµРЅРёСЏ РїРѕ СЃРµСЂРІРёСЃР°Рј, РѕРїР»Р°С‚Р°Рј Рё СЃРїРѕСЂРЅС‹Рј СЃРёС‚СѓР°С†РёСЏРј.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>РђРєС‚РёРІРЅС‹Рµ</div>
          <div style={premiumMetricValue}>{activeCount}</div>
          <div style={operationsSummaryMeta}>Р—Р°РїСЂРѕСЃС‹, РєРѕС‚РѕСЂС‹Рµ Р±Р°РЅРє РµС‰Рµ РЅРµ Р·Р°РєСЂС‹Р».</div>
        </div>
      </div>

      {requests.length === 0 ? (
        <div style={emptyBlock}>РЎРµСЂРІРёСЃРЅС‹С… Р·Р°РїСЂРѕСЃРѕРІ РїРѕРєР° РЅРµС‚</div>
      ) : (
        <div style={{ display: "grid", gap: "14px" }}>
          {requests.map((item) => {
            const tone = serviceRequestStatusTone(item.status);
            return (
              <div key={item.id} style={applicationCard}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "#eef5ff", marginBottom: "8px" }}>
                      {repairMojibake(item.request_type || "РЎРµСЂРІРёСЃРЅС‹Р№ Р·Р°РїСЂРѕСЃ")}
                    </div>
                    <div style={{ color: "#9fb3c8", lineHeight: 1.6 }}>
                      {repairMojibake(item.details || "")}
                    </div>
                  </div>
                  <div style={{ ...pill, ...tone }}>
                    {repairMojibake(item.status || "РќР° СЂР°СЃСЃРјРѕС‚СЂРµРЅРёРё")}
                  </div>
                </div>
                <div style={{ marginTop: "12px", fontSize: "13px", color: "#8da8c4" }}>
                  {repairMojibake(item.created_at || "")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ScreenLayout>
  );
}


function ScreenLayout({ title, children }) {
  return (
    <div style={screenLayout}>
      <div style={screenTitle}>{title}</div>
      <div style={screenContent}>{children}</div>
    </div>
  );
}

function MenuCard({ title, subtitle, onClick }) {
  return (
    <div style={menuCard} onClick={onClick}>
      <div style={menuCardTitle}>{title}</div>
      <div style={menuCardSubtitle}>{subtitle}</div>
    </div>
  );
}

function ActionButton({ icon, text, onClick }) {
  return (
    <div style={actionItem} onClick={onClick}>
      <div style={actionIcon}>{icon}</div>
      <div style={actionText}>
        {text.split("\n").map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick }) {
  return (
    <div style={navItem} onClick={onClick}>
      <div style={{ ...navIcon, color: active ? "#7ab8ff" : "#7e8794" }}>{icon}</div>
      <div style={{ ...navLabel, color: active ? "#7ab8ff" : "#7e8794" }}>{label}</div>
    </div>
  );
}

const page = {
  background:
    "radial-gradient(circle at top, rgba(83, 160, 255, 0.16), transparent 24%), #0b1220",
  color: "#eef4ff",
  minHeight: "100dvh",
  fontFamily: "'Segoe UI', 'Trebuchet MS', Arial, sans-serif",
  padding:
    "clamp(14px, 3vw, 32px) clamp(14px, 4vw, 36px) calc(92px + env(safe-area-inset-bottom, 0px))",
  boxSizing: "border-box",
  width: "100%",
  maxWidth: "1120px",
  margin: "0 auto",
  overflowX: "clip",
};

const loading = {
  background:
    "radial-gradient(circle at top, rgba(83, 160, 255, 0.16), transparent 24%), #0b1220",
  color: "#eef4ff",
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "'Segoe UI', 'Trebuchet MS', Arial, sans-serif",
  padding: "16px",
  textAlign: "center",
  boxSizing: "border-box",
};

const onboardingBanner = {
  background: "linear-gradient(135deg, #23476c, #3c74a8)",
  color: "#fff",
  borderRadius: "20px",
  padding: "16px 18px",
  marginBottom: "18px",
  cursor: "pointer",
  textAlign: "center",
  boxShadow: "0 16px 36px rgba(11, 18, 32, 0.28)",
};

const topBadge = {
  width: "fit-content",
  margin: "0 auto 22px",
  background: "rgba(22, 50, 79, 0.86)",
  color: "#d9ecff",
  fontWeight: "700",
  borderRadius: "999px",
  padding: "10px 18px",
  fontSize: "13px",
  letterSpacing: "0.08em",
  border: "1px solid #23476d",
};

const header = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  marginBottom: "18px",
};

const headerActionsWrap = {
  display: "flex",
  gap: "8px",
};

const headerIdentity = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  minWidth: 0,
  flex: 1,
};

const headerEyebrow = {
  color: "#89a8c8",
  fontSize: "12px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  marginBottom: "6px",
};

const badgeDot = {
  position: "absolute",
  top: "-6px",
  right: "-6px",
  minWidth: "18px",
  height: "18px",
  borderRadius: "50%",
  background: "#ff5d5d",
  color: "#fff",
  fontSize: "11px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 4px",
};

const avatar = {
  width: "60px",
  height: "60px",
  borderRadius: "50%",
  background: "linear-gradient(135deg, #27476b, #3d6797)",
  border: "1px solid #5d8fc8",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "26px",
  color: "#ffffff",
  flexShrink: 0,
};

const userName = {
  fontSize: "clamp(22px, 4vw, 30px)",
  fontWeight: "700",
};

const userTag = {
  marginTop: "4px",
  display: "inline-block",
  background: "#162334",
  color: "#9fc8f5",
  borderRadius: "999px",
  padding: "4px 10px",
  fontSize: "12px",
  border: "1px solid #233850",
};

const headerAction = {
  width: "44px",
  height: "44px",
  borderRadius: "50%",
  background: "#152235",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "20px",
  border: "1px solid #22364f",
  flexShrink: 0,
  position: "relative",
  cursor: "pointer",
};

const search = {
  background: "rgba(18, 29, 44, 0.88)",
  color: "#8191a6",
  borderRadius: "18px",
  padding: "15px 16px",
  fontSize: "15px",
  marginBottom: "18px",
  border: "1px solid #1e2f45",
  cursor: "pointer",
  backdropFilter: "blur(10px)",
};

const storiesRow = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "12px",
  marginBottom: "22px",
};

const storyCard = {
  minWidth: "0",
  background: "linear-gradient(135deg, #18304d, #26486f)",
  borderRadius: "24px",
  padding: "20px 16px",
  fontSize: "14px",
  lineHeight: "1.3",
  border: "1px solid #355c88",
  boxSizing: "border-box",
  color: "#eaf3ff",
  cursor: "pointer",
  boxShadow: "0 14px 30px rgba(8, 15, 27, 0.22)",
};

const grid2 = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "16px",
  marginBottom: "22px",
};

const infoCard = {
  background: "rgba(18, 29, 44, 0.9)",
  borderRadius: "24px",
  padding: "20px",
  minHeight: "150px",
  boxSizing: "border-box",
  cursor: "pointer",
  border: "1px solid #1f3248",
  boxShadow: "0 18px 34px rgba(8, 15, 27, 0.2)",
};

const cardTitle = {
  fontSize: "clamp(18px, 3vw, 22px)",
  fontWeight: "700",
  marginBottom: "10px",
};

const cardText = {
  color: "#a1b1c6",
  fontSize: "14px",
};

const bigText = {
  fontSize: "clamp(18px, 3vw, 24px)",
  marginTop: "6px",
};

const progressWrap = {
  marginTop: "22px",
  width: "100%",
  height: "16px",
  borderRadius: "999px",
  overflow: "hidden",
  display: "flex",
  background: "#203046",
};

const progressPart = {
  height: "100%",
};

const miniLegend = {
  display: "flex",
  justifyContent: "space-between",
  marginTop: "10px",
  fontSize: "11px",
  color: "#9db5d1",
  gap: "8px",
};

const analyticsCard = {
  background: "rgba(18, 29, 44, 0.9)",
  borderRadius: "20px",
  padding: "20px",
  border: "1px solid #1f3248",
};

const analyticsTotalLabel = {
  color: "#aab9cc",
  fontSize: "14px",
};

const analyticsTotalValue = {
  fontSize: "clamp(28px, 4vw, 36px)",
  fontWeight: "700",
  marginTop: "8px",
};

const analyticsItem = {
  background: "#121d2c",
  borderRadius: "18px",
  padding: "16px",
  border: "1px solid #1f3248",
};

const analyticsRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: "15px",
};

const analyticsBarWrap = {
  marginTop: "10px",
  height: "10px",
  background: "#203046",
  borderRadius: "999px",
  overflow: "hidden",
};

const analyticsBar = {
  height: "100%",
  background: "#5fb0ff",
  borderRadius: "999px",
};

const actionsRow = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
  gap: "12px",
  marginBottom: "22px",
};

const actionItem = {
  textAlign: "center",
  cursor: "pointer",
};

const actionIcon = {
  background: "rgba(18, 29, 44, 0.9)",
  borderRadius: "18px",
  height: "70px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "24px",
  marginBottom: "10px",
  border: "1px solid #1f3248",
};

const actionText = {
  fontSize: "12px",
  color: "#d9e8fa",
  lineHeight: "1.25",
};

const accountCard = {
  background: "linear-gradient(135deg, #15263c, #1a3252)",
  borderRadius: "26px",
  padding: "20px",
  marginBottom: "20px",
  cursor: "pointer",
  border: "1px solid #28476d",
  boxShadow: "0 18px 36px rgba(8, 15, 27, 0.28)",
};

const accountTop = {
  display: "flex",
  alignItems: "flex-start",
  gap: "12px",
  flexWrap: "wrap",
};

const moneyIcon = {
  width: "48px",
  height: "48px",
  borderRadius: "50%",
  background: "#2d5b92",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "24px",
  flexShrink: 0,
};

const accountBalance = {
  fontSize: "clamp(20px, 3vw, 28px)",
  fontWeight: "700",
};

const accountName = {
  color: "#c3d5eb",
  marginTop: "4px",
};

const cashbackBadge = {
  marginLeft: "auto",
  background: "#23364d",
  color: "#d8ecff",
  borderRadius: "999px",
  padding: "6px 10px",
  fontSize: "14px",
  border: "1px solid #345271",
};

const sectionHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
};

const miniButton = {
  background: "#1b2f45",
  color: "#dcecff",
  border: "1px solid #315272",
  borderRadius: "12px",
  padding: "8px 10px",
  fontSize: "12px",
  cursor: "pointer",
};

const banner = {
  background: "linear-gradient(135deg, #254467, #315d8e)",
  color: "#f0f7ff",
  borderRadius: "24px",
  padding: "20px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "22px",
  cursor: "pointer",
  border: "1px solid #406fa6",
  gap: "14px",
  flexWrap: "wrap",
};

const bannerTitle = {
  fontSize: "18px",
  fontWeight: "700",
};

const bannerText = {
  fontSize: "14px",
  marginTop: "6px",
  color: "#d6e8fb",
};

const bannerIcon = {
  fontSize: "34px",
};

const bottomNav = {
  position: "fixed",
  left: "50%",
  bottom: "max(4px, env(safe-area-inset-bottom, 0px))",
  background: "rgba(14, 22, 34, 0.96)",
  borderTop: "1px solid #22354c",
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  padding: "10px 10px max(14px, env(safe-area-inset-bottom, 0px))",
  backdropFilter: "blur(10px)",
  width: "min(calc(100% - 12px), 1120px)",
  transform: "translateX(-50%)",
  boxSizing: "border-box",
  borderTopLeftRadius: "18px",
  borderTopRightRadius: "18px",
  boxShadow: "0 -12px 32px rgba(7, 13, 22, 0.35)",
};

const screenLayout = {
  paddingBottom: "116px",
  maxWidth: "880px",
  margin: "0 auto",
  width: "100%",
  minWidth: 0,
};

const navItem = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "4px",
  cursor: "pointer",
  borderRadius: "14px",
  padding: "8px 6px",
};

const navIcon = {
  fontSize: "20px",
  lineHeight: 1,
};

const navLabel = {
  fontSize: "11px",
  fontWeight: "600",
};

const screenTitle = {
  fontSize: "clamp(22px, 5.5vw, 28px)",
  fontWeight: "700",
  marginBottom: "18px",
};

const screenSubtitle = {
  fontSize: "clamp(18px, 3vw, 24px)",
  fontWeight: "700",
  marginTop: "6px",
  marginBottom: "4px",
};

const screenContent = {
  display: "grid",
  gap: "16px",
};

const menuCard = {
  background:
    "linear-gradient(180deg, rgba(20, 32, 48, 0.96) 0%, rgba(17, 27, 41, 0.96) 100%)",
  borderRadius: "22px",
  padding: "20px",
  cursor: "pointer",
  border: "1px solid #1f3248",
  boxShadow: "0 16px 30px rgba(8, 15, 27, 0.18)",
};

const menuCardTitle = {
  fontSize: "clamp(17px, 2.6vw, 21px)",
  fontWeight: "700",
  marginBottom: "8px",
};

const menuCardSubtitle = {
  color: "#aab9cc",
  fontSize: "14px",
  lineHeight: "1.55",
};

const premiumPanelGrid = {
  display: "grid",
  gap: "16px",
};

const premiumMetricsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
};

const premiumTemplatesGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
};

const operationsList = {
  display: "grid",
  gap: "12px",
};

const accountCardsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "16px",
};

const detailsInfoGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "14px",
};

const detailActionBar = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  marginTop: "14px",
};

const paymentsShowcaseChipRow = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  marginTop: "18px",
};

const messageBox = {
  background: "rgba(60, 109, 167, 0.18)",
  color: "#dcecff",
  border: "1px solid #315272",
  borderRadius: "16px",
  padding: "14px 16px",
  marginBottom: "14px",
};

const pill = {
  background: "rgba(38, 72, 112, 0.75)",
  color: "#dbeafe",
  border: "1px solid #315272",
  borderRadius: "999px",
  padding: "10px 14px",
  fontSize: "13px",
  whiteSpace: "nowrap",
};

const cardLogo = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "56px",
  height: "32px",
  borderRadius: "12px",
  background: "rgba(66, 129, 203, 0.18)",
  border: "1px solid #315272",
  color: "#eff6ff",
  fontSize: "12px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const accountCardLabel = {
  color: "#9db4d1",
  fontSize: "13px",
  marginTop: "12px",
};

const accountCardNumber = {
  color: "#f3f7ff",
  fontSize: "27px",
  fontWeight: "800",
  marginTop: "10px",
  letterSpacing: "0.02em",
  wordBreak: "break-word",
};

const accountCardMeta = {
  color: "#8ea8c6",
  fontSize: "13px",
  lineHeight: "1.5",
};

const accountCardAmount = {
  color: "#f8fafc",
  fontSize: "22px",
  fontWeight: "800",
  marginTop: "14px",
};

const operationIcon = {
  width: "44px",
  height: "44px",
  borderRadius: "14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(41, 69, 104, 0.85)",
  color: "#e5eefc",
  fontWeight: "800",
  flexShrink: 0,
};

const operationMeta = {
  color: "#8ea8c6",
  fontSize: "13px",
  lineHeight: "1.5",
  marginTop: "4px",
};

const premiumOperationAmount = {
  color: "#f3f7ff",
  fontSize: "20px",
  fontWeight: "800",
  textAlign: "right",
  whiteSpace: "nowrap",
};

const operationItem = {
  background: "rgba(18, 29, 44, 0.9)",
  borderRadius: "18px",
  padding: "16px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
  border: "1px solid #1f3248",
};

const operationTitle = {
  fontSize: "16px",
  fontWeight: "700",
};

const operationDate = {
  fontSize: "13px",
  color: "#8695aa",
  marginTop: "4px",
};

const incomeAmount = {
  color: "#67d18f",
  fontWeight: "700",
};

const expenseAmount = {
  color: "#ff8a8a",
  fontWeight: "700",
};

const chatBubbleBot = {
  background: "rgba(18, 29, 44, 0.94)",
  padding: "14px 16px",
  borderRadius: "18px 18px 18px 8px",
  width: "fit-content",
  maxWidth: "80%",
  border: "1px solid #1f3248",
  boxShadow: "0 10px 22px rgba(8, 15, 27, 0.16)",
};

const chatBubbleUser = {
  background: "linear-gradient(135deg, #2a5f96, #417fbe)",
  padding: "14px 16px",
  borderRadius: "18px 18px 8px 18px",
  width: "fit-content",
  maxWidth: "80%",
  marginLeft: "auto",
  boxShadow: "0 10px 22px rgba(18, 57, 98, 0.26)",
};

const chatContainer = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  marginBottom: "70px",
};

const chatInputRow = {
  position: "fixed",
  bottom: "max(76px, calc(70px + env(safe-area-inset-bottom, 0px)))",
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(calc(100% - 12px), 1120px)",
  padding: "10px",
  background: "#0b1220",
  display: "flex",
  gap: "10px",
};

const chatInputField = {
  flex: 1,
  padding: "14px 16px",
  borderRadius: "16px",
  border: "1px solid #2b3f57",
  background: "rgba(18, 29, 44, 0.94)",
  color: "#fff",
};

const chatSendButton = {
  width: "50px",
  borderRadius: "16px",
  border: "none",
  background: "linear-gradient(135deg, #2a5f96, #417fbe)",
  color: "#fff",
  fontSize: "18px",
};

const emptyBlock = {
  background: "rgba(18, 29, 44, 0.9)",
  borderRadius: "18px",
  padding: "18px",
  color: "#a8b7ca",
  border: "1px solid #1f3248",
};

const applicationCard = {
  background: "rgba(18, 29, 44, 0.9)",
  borderRadius: "18px",
  padding: "16px",
  border: "1px solid #1f3248",
};

const premiumHomeLayout = {
  display: "grid",
  gap: "18px",
  marginBottom: "24px",
};

const premiumMainColumn = { display: "grid", gap: "18px" };
const premiumAsideColumn = { display: "grid", gap: "18px" };
const premiumHeroCard = { position: "relative", overflow: "hidden", background: "linear-gradient(135deg, rgba(20, 34, 56, 0.98) 0%, rgba(10, 22, 39, 0.98) 60%, rgba(22, 53, 84, 0.98) 100%)", border: "1px solid rgba(94, 142, 198, 0.34)", borderRadius: "32px", padding: "clamp(20px, 3vw, 30px)", boxShadow: "0 28px 56px rgba(3, 9, 18, 0.36)" };
const premiumHeroGlow = { position: "absolute", inset: "auto -18% -35% auto", width: "360px", height: "360px", background: "radial-gradient(circle, rgba(102, 180, 255, 0.28), transparent 66%)", pointerEvents: "none" };
const premiumHeroTop = { position: "relative", display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" };
const premiumKicker = { fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#90baf0", marginBottom: "10px" };
const premiumBalance = { fontSize: "clamp(34px, 6vw, 54px)", lineHeight: 1, fontWeight: "800", letterSpacing: "-0.04em", color: "#f5f9ff" };
const premiumHeroSub = { marginTop: "10px", color: "#bfd4eb", fontSize: "15px" };
const premiumHeroBadge = { background: "rgba(16, 28, 44, 0.76)", border: "1px solid rgba(112, 159, 214, 0.36)", color: "#dff0ff", borderRadius: "999px", padding: "10px 14px", fontSize: "13px", fontWeight: "700" };
const premiumHeroMetrics = { position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", gap: "12px", marginTop: "22px" };
const premiumMetricCard = { background: "rgba(255, 255, 255, 0.04)", borderRadius: "20px", padding: "16px", border: "1px solid rgba(102, 140, 182, 0.22)" };
const premiumMetricLabel = { color: "#9ab5cf", fontSize: "13px", marginBottom: "8px" };
const premiumMetricValue = { fontSize: "clamp(18px, 3vw, 24px)", fontWeight: "700", color: "#f4f8ff" };
const premiumActionStrip = { position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: "12px", marginTop: "22px" };
const premiumActionPill = { display: "flex", alignItems: "center", gap: "12px", padding: "16px", background: "rgba(255, 255, 255, 0.04)", borderRadius: "20px", border: "1px solid rgba(102, 140, 182, 0.22)", cursor: "pointer" };
const premiumActionIcon = { width: "44px", height: "44px", borderRadius: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(122, 184, 255, 0.14)", color: "#dff0ff", fontSize: "20px", flexShrink: 0 };
const premiumActionTitle = { fontWeight: "700", color: "#f3f8ff", marginBottom: "4px" };
const premiumActionMeta = { color: "#97b3ce", fontSize: "13px", lineHeight: 1.45 };
const premiumSectionBlock = { background: "linear-gradient(180deg, rgba(16, 25, 38, 0.94) 0%, rgba(12, 20, 31, 0.94) 100%)", border: "1px solid rgba(37, 55, 77, 0.9)", borderRadius: "28px", padding: "clamp(18px, 3vw, 26px)", boxShadow: "0 18px 36px rgba(6, 11, 20, 0.22)" };
const premiumOperationsList = { display: "grid", gap: "12px" };
const premiumOperationRow = { display: "flex", alignItems: "center", gap: "14px", padding: "16px 18px", borderRadius: "20px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(42, 61, 86, 0.92)", cursor: "pointer", flexWrap: "wrap", minWidth: 0 };
const premiumOperationCard = { display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", padding: "18px", borderRadius: "22px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(42, 61, 86, 0.92)", flexWrap: "wrap", minWidth: 0 };
const premiumOperationLeading = { display: "flex", alignItems: "center", gap: "14px", minWidth: 0, flex: 1 };
const premiumOperationTrailing = { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" };
const premiumOperationIcon = { width: "42px", height: "42px", borderRadius: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(88, 140, 204, 0.14)", color: "#dff0ff", fontWeight: "700", flexShrink: 0 };
const premiumOperationTitle = { fontWeight: "700", color: "#f3f7ff", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.35, wordBreak: "break-word" };
const premiumOperationMeta = { color: "#8ca8c2", fontSize: "13px" };
const premiumIncomeAmount = { color: "#8de0a6", fontWeight: "700", whiteSpace: "nowrap" };
const premiumExpenseAmount = { color: "#f7d17c", fontWeight: "700", whiteSpace: "nowrap" };
const premiumHighlightsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "14px" };
const premiumInfoCard = { background: "linear-gradient(180deg, rgba(14, 24, 36, 0.96), rgba(10, 17, 27, 0.96))", borderRadius: "24px", padding: "18px", border: "1px solid rgba(34, 50, 70, 0.92)" };
const premiumInfoLabel = { color: "#91aac4", fontSize: "13px", marginBottom: "10px" };
const premiumInfoValue = { color: "#eef5ff", fontSize: "15px", lineHeight: 1.55 };
const premiumTagRow = { display: "flex", flexWrap: "wrap", gap: "10px" };
const premiumTag = { padding: "10px 12px", borderRadius: "999px", background: "rgba(88, 140, 204, 0.12)", border: "1px solid rgba(88, 140, 204, 0.22)", color: "#dbeaff", fontSize: "13px" };
const premiumDualStat = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 130px), 1fr))", gap: "14px" };
const premiumDualLabel = { color: "#91aac4", fontSize: "13px", marginBottom: "8px" };
const premiumAsideCard = { background: "linear-gradient(180deg, rgba(16, 25, 38, 0.94) 0%, rgba(12, 20, 31, 0.94) 100%)", border: "1px solid rgba(37, 55, 77, 0.9)", borderRadius: "28px", padding: "20px", boxShadow: "0 18px 36px rgba(6, 11, 20, 0.18)" };
const premiumAccountStack = { display: "grid", gap: "12px" };
const premiumAccountRow = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "18px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(42, 61, 86, 0.92)", cursor: "pointer", flexWrap: "wrap" };
const premiumAccountTitle = { fontWeight: "700", color: "#eef5ff", marginBottom: "4px" };
const premiumAccountMeta = { fontSize: "13px", color: "#8da8c4" };
const premiumAccountAmount = { fontWeight: "700", color: "#eaf4ff", whiteSpace: "nowrap" };
const premiumShortcutGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))", gap: "12px" };
const premiumShortcutCard = { borderRadius: "20px", padding: "16px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(42, 61, 86, 0.92)", cursor: "pointer" };
const premiumShortcutIcon = { width: "38px", height: "38px", borderRadius: "12px", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "12px", background: "rgba(122, 184, 255, 0.12)", color: "#e7f3ff" };
const premiumShortcutTitle = { fontWeight: "700", color: "#eef5ff", marginBottom: "6px" };
const premiumShortcutMeta = { fontSize: "13px", color: "#8da8c4", lineHeight: 1.45 };
const premiumNoticeCard = { borderRadius: "24px", padding: "20px", background: "linear-gradient(140deg, rgba(26, 47, 78, 0.95), rgba(15, 27, 44, 0.95))", border: "1px solid rgba(74, 120, 173, 0.48)", cursor: "pointer" };
const premiumNoticeKicker = { color: "#b6d8ff", fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "10px" };
const premiumNoticeTitle = { fontSize: "18px", fontWeight: "700", marginBottom: "8px" };
const premiumNoticeText = { color: "#d7e8fb", lineHeight: 1.55 };
const premiumBannerCard = { borderRadius: "24px", padding: "20px", background: "linear-gradient(135deg, #235180, #5d8cc0)", border: "1px solid rgba(130, 182, 236, 0.5)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "14px", cursor: "pointer" };
const premiumBannerTitle = { fontSize: "18px", fontWeight: "700", marginBottom: "6px" };
const premiumBannerText = { color: "#eaf5ff", lineHeight: 1.5, fontSize: "14px" };
const premiumBannerIcon = { fontSize: "28px", fontWeight: "700" };
const paymentsShowcaseCard = { background: "linear-gradient(140deg, rgba(18, 35, 58, 0.98), rgba(11, 21, 34, 0.98))", borderRadius: "30px", padding: "clamp(20px, 3vw, 30px)", border: "1px solid rgba(72, 111, 158, 0.36)", boxShadow: "0 22px 44px rgba(4, 10, 19, 0.3)" };
const paymentsShowcaseEyebrow = { color: "#8eb6ea", fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" };
const paymentsShowcaseTitle = { fontSize: "clamp(28px, 5vw, 42px)", fontWeight: "800", letterSpacing: "-0.04em", lineHeight: 1.02, marginBottom: "14px" };
const paymentsShowcaseText = { fontSize: "15px", lineHeight: 1.65, color: "#c0d5ea", maxWidth: "720px" };
const paymentsShowcaseChips = { display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "18px" };
const paymentsShowcaseChip = { padding: "10px 12px", borderRadius: "999px", background: "rgba(122, 184, 255, 0.12)", border: "1px solid rgba(122, 184, 255, 0.22)", color: "#ddedff", fontSize: "13px" };
const paymentsFeatureGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: "14px" };
const paymentsFeatureCard = { padding: "20px", borderRadius: "24px", background: "linear-gradient(180deg, rgba(16, 25, 38, 0.94) 0%, rgba(12, 20, 31, 0.94) 100%)", border: "1px solid rgba(37, 55, 77, 0.9)", cursor: "pointer" };
const paymentsFeatureCardPrimary = { ...paymentsFeatureCard, background: "linear-gradient(135deg, rgba(28, 57, 92, 0.98), rgba(15, 31, 50, 0.98))", border: "1px solid rgba(96, 145, 202, 0.48)" };
const paymentsFeatureIcon = { width: "46px", height: "46px", borderRadius: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(122, 184, 255, 0.14)", marginBottom: "14px" };
const paymentsFeatureTitle = { fontSize: "20px", fontWeight: "700", marginBottom: "8px" };
const paymentsFeatureText = { color: "#a5bdd7", lineHeight: 1.58, fontSize: "14px" };
const paymentsInsightsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "14px" };
const paymentsInsightCard = { background: "linear-gradient(180deg, rgba(16, 25, 38, 0.94) 0%, rgba(12, 20, 31, 0.94) 100%)", border: "1px solid rgba(37, 55, 77, 0.9)", borderRadius: "24px", padding: "18px" };
const serviceCenterGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "14px" };
const serviceFeatureCard = { padding: "20px", borderRadius: "24px", background: "linear-gradient(180deg, rgba(16, 25, 38, 0.94) 0%, rgba(12, 20, 31, 0.94) 100%)", border: "1px solid rgba(37, 55, 77, 0.9)", cursor: "pointer" };
const serviceFeatureCardPrimary = { ...serviceFeatureCard, background: "linear-gradient(135deg, rgba(28, 57, 92, 0.98), rgba(15, 31, 50, 0.98))", border: "1px solid rgba(96, 145, 202, 0.48)" };
const operationsSummaryGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px" };
const operationsSummaryCard = { background: "linear-gradient(180deg, rgba(16, 25, 38, 0.94) 0%, rgba(12, 20, 31, 0.94) 100%)", border: "1px solid rgba(37, 55, 77, 0.9)", borderRadius: "24px", padding: "18px" };
const operationsSummaryValue = { fontSize: "clamp(28px, 4vw, 38px)", fontWeight: "800", color: "#f4f8ff" };
const operationsSummaryMeta = { marginTop: "8px", color: "#8da8c4", fontSize: "13px" };
const premiumCategoryPill = { padding: "8px 10px", borderRadius: "999px", background: "rgba(122, 184, 255, 0.1)", border: "1px solid rgba(122, 184, 255, 0.18)", color: "#d7eaff", fontSize: "12px", whiteSpace: "nowrap" };
const cardsSummaryGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px", marginBottom: "18px" };
const cardsSummaryCard = { background: "linear-gradient(180deg, rgba(16, 25, 38, 0.94) 0%, rgba(12, 20, 31, 0.94) 100%)", border: "1px solid rgba(37, 55, 77, 0.9)", borderRadius: "22px", padding: "18px" };
const cardsDeckGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: "16px" };
const cardsActionRow = { display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "16px" };
const compactButton = { background: "#1b2f45", color: "#dcecff", border: "1px solid #315272", borderRadius: "14px", padding: "12px 14px", fontSize: "14px", cursor: "pointer", minHeight: "44px" };
const detailsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" };
const detailsInfoCard = { background: "rgba(255, 255, 255, 0.03)", borderRadius: "22px", padding: "18px", border: "1px solid rgba(42, 61, 86, 0.92)" };
const transferShell = { display: "grid", gap: "18px" };
const transferPreviewCard = { background: "linear-gradient(135deg, rgba(28, 57, 92, 0.98), rgba(15, 31, 50, 0.98))", borderRadius: "24px", padding: "20px", border: "1px solid rgba(96, 145, 202, 0.48)", boxShadow: "0 18px 36px rgba(4, 10, 19, 0.24)" };
const transferPreviewName = { fontSize: "24px", fontWeight: "800", letterSpacing: "-0.03em", marginBottom: "8px" };
const transferPreviewMeta = { color: "#d2e5fb", fontSize: "14px", lineHeight: 1.65 };
const profileStatsGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px", marginTop: "18px" };
const settingsGrid = { display: "grid", gap: "14px" };
const filtersGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px" };

const sectionLead = {
  color: "#c4d6ea",
  fontSize: "14px",
  lineHeight: 1.55,
  marginBottom: "18px",
};

const actionRowWrap = {
  display: "flex",
  justifyContent: "flex-start",
  marginBottom: "18px",
};

const previewCard = {
  background: "rgba(20, 44, 71, 0.78)",
  border: "1px solid #31557f",
  borderRadius: "16px",
  padding: "16px",
  marginBottom: "18px",
};

const previewTitle = {
  fontSize: "13px",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#8fbfff",
  marginBottom: "8px",
};

const previewName = {
  fontSize: "20px",
  fontWeight: 700,
  color: "#f2f7ff",
  marginBottom: "6px",
};

const previewMeta = {
  fontSize: "14px",
  color: "#b8cbe0",
  marginTop: "4px",
};

const dividerLine = {
  height: "1px",
  background: "rgba(148, 177, 207, 0.16)",
  margin: "20px 0",
};

const helperNote = {
  marginTop: "14px",
  color: "#89a3c4",
  fontSize: "13px",
  lineHeight: 1.5,
};

const formCard = {
  background: "rgba(18, 29, 44, 0.9)",
  borderRadius: "20px",
  padding: "20px",
  border: "1px solid #1f3248",
};

const inputLabel = {
  fontSize: "14px",
  color: "#aab9cc",
  marginBottom: "8px",
  marginTop: "12px",
};

const input = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0f1927",
  color: "#eef4ff",
  border: "1px solid #263b55",
  borderRadius: "12px",
  padding: "14px",
  fontSize: "16px",
  outline: "none",
};

const textArea = {
  width: "100%",
  minHeight: "120px",
  boxSizing: "border-box",
  background: "#0f1927",
  color: "#eef4ff",
  border: "1px solid #263b55",
  borderRadius: "12px",
  padding: "14px",
  fontSize: "16px",
  outline: "none",
  resize: "vertical",
};

const textarea = textArea;

const primaryButton = {
  width: "100%",
  marginTop: "18px",
  background: "#2a5f96",
  color: "#ffffff",
  border: "none",
  borderRadius: "14px",
  padding: "14px",
  fontSize: "16px",
  cursor: "pointer",
};

const secondaryButton = {
  width: "100%",
  marginTop: "14px",
  background: "#1b2f45",
  color: "#dcecff",
  border: "1px solid #315272",
  borderRadius: "14px",
  padding: "12px",
  fontSize: "15px",
  cursor: "pointer",
};

const linkButton = {
  display: "block",
  marginTop: "18px",
  textAlign: "center",
  textDecoration: "none",
  background: "#2a5f96",
  color: "#ffffff",
  borderRadius: "14px",
  padding: "14px",
  fontSize: "16px",
};

const resultMessage = {
  marginTop: "16px",
  background: "rgba(22, 41, 61, 0.94)",
  border: "1px solid #29476a",
  color: "#dcecff",
  borderRadius: "16px",
  padding: "14px 16px",
};

const detailsRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  padding: "10px 0",
  borderBottom: "1px solid #22354c",
  fontSize: "14px",
  color: "#dcecff",
};

const switchRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 0",
  borderBottom: "1px solid #22354c",
};

export default App;
