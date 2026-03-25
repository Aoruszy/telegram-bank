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
      setErr("PIN и подтверждение не совпадают");
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
        setErr(typeof data.detail === "string" ? data.detail : "Не удалось сохранить PIN");
        setLoading(false);
        return;
      }
      setToken(data.access_token);
      onSuccess();
    } catch {
      setErr("Ошибка сети");
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
        setErr(typeof d === "string" ? d : "Неверный PIN");
        setLoading(false);
        return;
      }
      setToken(data.access_token);
      onSuccess();
    } catch {
      setErr("Ошибка сети");
    }
    setLoading(false);
  };

  return (
    <div className="app-shell" style={pinGateWrap}>
      <div style={pinGateCard}>
        <div style={pinGateTitle}>{setup ? "Придумайте PIN-код" : "Введите PIN-код"}</div>
        <div style={pinGateHint}>4–6 цифр. Не сообщайте код никому.</div>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          style={pinInput}
          value={pin}
          onChange={(e) => setPin(sanitizeDigitsOnly(e.target.value))}
          placeholder="••••"
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
            placeholder="Повторите PIN"
            aria-label="Подтверждение PIN"
          />
        )}
        {err && <div style={pinGateErr}>{err}</div>}
        <button
          type="button"
          style={{ ...pinGateSubmit, opacity: loading ? 0.7 : 1 }}
          disabled={loading}
          onClick={setup ? submitSetup : submitLogin}
        >
          {loading ? "Проверка…" : setup ? "Сохранить и войти" : "Войти"}
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
  if (!value) return "Без даты";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function categoryLabelRu(category) {
  const map = {
    transfer: "Перевод",
    shopping: "Покупки",
    subscription: "Подписки",
    topup: "Пополнение",
    services: "Услуги",
    commission: "Комиссия",
    other: "Прочее",
  };
  return map[category] || "Операция";
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
    const cyrillic = (input.match(/[Ѐ-ӿ]/g) || []).length;
    const latin = (input.match(/[A-Za-z]/g) || []).length;
    const broken = (input.match(/[?�]/g) || []).length;
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
      .replace(/^[^A-Za-zЀ-ӿ]+/u, "")
      .replace(/\s+/g, " ")
      .trim();
    return tail ? `Перевод по VK ID клиенту ${tail}` : "Перевод по VK ID";
  }

  return normalized;
}


function extractReadableTail(value) {
  if (typeof value !== "string") return "";
  const normalized = repairMojibake(value).replace(/\s+/g, " ").trim();
  const match = normalized.match(/([A-Za-zЀ-ӿ-]+(?:\s+[A-Za-zЀ-ӿ-]+){0,3})\s*$/u);
  return repairMojibake(match?.[1] || "").trim();
}



function humanizeOperationTitle(title, operationType) {
  const normalized = repairMojibake(title || "").trim();
  if (!normalized) {
    return operationType === "income" ? "Пополнение счёта" : "Операция по счёту";
  }
  const lower = normalized.toLowerCase();
  if (lower.includes("vk id") || lower.includes("vkid")) {
    let recipientName = extractReadableTail(normalized);
    recipientName = recipientName
      .replace(/.*vk\s*id\s*/i, "")
      .replace(/^(клиенту|от)\s+/i, "")
      .replace(/перевод\s+по\s+vk\s*id/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (operationType === "income") {
      return recipientName ? `Перевод по VK ID от ${recipientName}` : "Перевод по VK ID";
    }
    return recipientName ? `Перевод по VK ID клиенту ${recipientName}` : "Перевод по VK ID";
  }
  return normalized;
}




function deriveRecentRecipients(operations) {
  const seen = new Set();
  const result = [];

  for (const item of operations || []) {
    if (item?.category !== "transfer" || item?.operation_type !== "expense") continue;

    const title = humanizeOperationTitle(item.title, item.operation_type) || "";
    const match = title.match(/клиенту\s+(.+)$/i);
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

function accountTypeLabel(accountType) {
  switch (String(accountType || "").toLowerCase()) {
    case "credit":
      return "Кредитный счет";
    case "mortgage":
      return "Ипотечный счет";
    case "deposit":
      return "Вклад";
    case "savings":
      return "Накопительный счет";
    case "main":
      return "Основной счет";
    default:
      return "Текущий счет";
  }
}

function serviceRequestStatusTone(status) {
  const normalized = repairMojibake(status || "");
  if (normalized.includes("Вып")) {
    return {
      background: "rgba(95, 194, 129, 0.14)",
      border: "1px solid rgba(95, 194, 129, 0.28)",
      color: "#9ee2b0",
    };
  }

  if (normalized.includes("Отклон")) {
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
  if (normalized.includes("одобр")) {
    return { background: "rgba(95, 194, 129, 0.14)", border: "1px solid rgba(95, 194, 129, 0.28)", color: "#9ee2b0" };
  }
  if (normalized.includes("откл")) {
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
        /* вне VK или нет прав */
      }
      if (cancelled) return;
      if (!lp.vk_user_id) {
        setVkInitError(
          "Откройте мини-приложение во ВКонтакте или задайте VITE_DEV_VK_USER_ID для локальной отладки."
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
  const [selectedAccountId, setSelectedAccountId] = useState(null);
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
            : "Не удалось авторизоваться в VK Mini App"
        );
        return;
      }
      setUserData(userJson.user);
    } catch (err) {
      console.error(err);
      setAuthError("Ошибка сети при авторизации");
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
      console.error("Ошибка загрузки данных:", err);
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
        Загрузка...
      </div>
    );
  }
  if (authError && !userData) {
    return <div className="app-shell" style={loading}>{authError}</div>;
  }
  if (!userData) {
    return (
      <div className="app-shell" style={loading}>
        Загрузка...
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
          onAccountOpen={(accountId) => {
            setSelectedAccountId(accountId);
            setActiveTab("accountDetails");
          }}
          onCardOpen={(cardId) => {
            setSelectedCardId(cardId);
            setActiveTab("cardDetails");
          }}
          hideBalance={userData.hide_balance}
        />
      )}

      {activeTab === "accountDetails" && selectedAccountId && (
        <AccountDetailsScreen
          vkId={vkId}
          accountId={selectedAccountId}
          accounts={accounts}
          onBack={() => setActiveTab("accounts")}
          onActionDone={() => setRefreshKey((prev) => prev + 1)}
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
          icon="🏠"
          label="Главная"
          active={activeTab === "home"}
          onClick={() => setActiveTab("home")}
        />
        <NavItem
          icon="💸"
          label="Платежи"
          active={activeTab === "payments"}
          onClick={() => setActiveTab("payments")}
        />
        <NavItem
          icon="💬"
          label="Чат"
          active={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
        />
        <NavItem
          icon="☰"
          label="Еще"
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
  const visibleBalance = userData.hide_balance ? "•••••• ₽" : `${formatMoney(totalBalance)} ₽`;
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
          Завершите быстрый старт, чтобы открыть все возможности приложения
        </div>
      )}

      {!isCompact ? <div style={topBadge}>ZF BANK PREMIER</div> : null}

      <div style={isCompact ? { ...header, alignItems: "flex-start" } : header}>
        <div style={isCompact ? { ...headerIdentity, alignItems: "flex-start" } : headerIdentity}>
          <div style={avatar}>{userData.full_name ? userData.full_name[0].toUpperCase() : "U"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={headerEyebrow}>Главный экран</div>
            <div style={userName}>{repairMojibake(userData.full_name)}</div>
            <div style={userTag}>Банк во ВКонтакте</div>
          </div>
        </div>
        <div style={isCompact ? { ...headerActionsWrap, flexShrink: 0 } : headerActionsWrap}>
          <div style={headerAction} onClick={() => setActiveTab("settings")}>⚙</div>
          <div style={headerAction} onClick={() => setActiveTab("notifications")}>
            🔔
            {unreadCount > 0 && <div style={badgeDot}>{unreadCount}</div>}
          </div>
        </div>
      </div>

      <div style={isCompact ? { ...search, marginBottom: "18px", padding: "15px 16px" } : search} onClick={() => setActiveTab("more")}>Поиск переводов, карт, заявок и сервисов</div>

      <div style={premiumHomeLayout}>
        <div style={isCompact ? { ...premiumHeroCard, borderRadius: "26px", padding: "18px" } : premiumHeroCard}>
          <div style={premiumHeroGlow} />
          <div style={isCompact ? { ...premiumHeroTop, flexDirection: "column", alignItems: "stretch" } : premiumHeroTop}>
            <div>
              <div style={premiumKicker}>Доступно на всех счетах</div>
              <div style={isCompact ? { ...premiumBalance, fontSize: "clamp(28px, 10vw, 40px)" } : premiumBalance}>{visibleBalance}</div>
              <div style={premiumHeroSub}>Основной счёт: {repairMojibake(mainAccount?.account_name) || "Ещё не открыт"}</div>
            </div>
            <div style={isCompact ? { ...premiumHeroBadge, alignSelf: "flex-start" } : premiumHeroBadge}>{accounts.length} {accounts.length === 1 ? "счёт" : accounts.length < 5 ? "счёта" : "счетов"}</div>
          </div>

          <div style={isCompact ? { ...premiumHeroMetrics, gridTemplateColumns: "1fr" } : premiumHeroMetrics}>
            <div style={premiumMetricCard}><div style={premiumMetricLabel}>Расходы за месяц</div><div style={premiumMetricValue}>{formatMoney(totalExpenses)} ₽</div></div>
            <div style={premiumMetricCard}><div style={premiumMetricLabel}>Поступления</div><div style={premiumMetricValue}>{formatMoney(incomeThisMonth)} ₽</div></div>
            <div style={premiumMetricCard}><div style={premiumMetricLabel}>Активная карта</div><div style={premiumMetricValue}>{mainCard?.card_number_mask || "Нет карты"}</div></div>
          </div>

          <div style={isCompact ? { ...premiumActionStrip, gridTemplateColumns: "1fr" } : premiumActionStrip}>
            <div style={premiumActionPill} onClick={() => setActiveTab("transfer")}><span style={premiumActionIcon}>→</span><div><div style={premiumActionTitle}>Перевод по VK ID</div><div style={premiumActionMeta}>Отправить деньги клиенту</div></div></div>
            <div style={premiumActionPill} onClick={() => setActiveTab("internalTransfer")}><span style={premiumActionIcon}>⇄</span><div><div style={premiumActionTitle}>Между своими счетами</div><div style={premiumActionMeta}>Перевод между своими счетами</div></div></div>
            <div style={premiumActionPill} onClick={() => setActiveTab("cards")}><span style={premiumActionIcon}>💳</span><div><div style={premiumActionTitle}>Мои карты</div><div style={premiumActionMeta}>Лимиты и управление</div></div></div>
            <div style={premiumActionPill} onClick={() => setActiveTab("analytics")}><span style={premiumActionIcon}>%</span><div><div style={premiumActionTitle}>Аналитика</div><div style={premiumActionMeta}>Разбор расходов и категорий</div></div></div>
          </div>
        </div>

        <div style={premiumAsideCard}>
          <div style={sectionHeader}><div style={screenSubtitle}>Счета и продукты</div><button style={miniButton} onClick={() => setActiveTab("accounts")}>Открыть</button></div>
          {accounts.length === 0 ? <div style={emptyBlock}>Пока нет активных счетов</div> : <div style={premiumAccountStack}>{accounts.slice(0, 4).map((account) => <div key={account.id} style={premiumAccountRow} onClick={() => setActiveTab("accounts")}><div><div style={premiumAccountTitle}>{repairMojibake(account.account_name)}</div><div style={premiumAccountMeta}>{account.status}</div></div><div style={premiumAccountAmount}>{userData.hide_balance ? "•••••• ₽" : `${formatMoney(account.balance)} ₽`}</div></div>)}</div>}
        </div>

        <div style={premiumSectionBlock}>
          <div style={sectionHeader}>
            <div><div style={screenSubtitle}>Последние операции</div><div style={sectionLead}>Живая лента расходов, пополнений и переводов по вашему профилю.</div></div>
            <button style={miniButton} onClick={() => setActiveTab("operations")}>Все операции</button>
          </div>
          {latestOperations.length === 0 ? (
            <div style={emptyBlock}>У вас пока нет операций. Первая активность появится после перевода или оплаты.</div>
          ) : (
            <div style={premiumOperationsList}>
              {latestOperations.map((item) => (
                <div key={item.id} style={premiumOperationRow} onClick={() => onOpenOperation ? onOpenOperation(item.id) : setActiveTab("operations")}>
                  <div style={premiumOperationIcon}>{item.operation_type === "income" ? "↓" : "↑"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={premiumOperationTitle}>{humanizeOperationTitle(item.title, item.operation_type)}</div>
                    <div style={premiumOperationMeta}>{categoryLabelRu(item.category)} · {formatOperationDate(item.created_at)}</div>
                  </div>
                  <div style={item.operation_type === "income" ? premiumIncomeAmount : premiumExpenseAmount}>{item.operation_type === "income" ? "+" : "-"}{formatMoney(Math.abs(item.amount))} ₽</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={isCompact ? { ...premiumHighlightsGrid, gridTemplateColumns: "1fr" } : premiumHighlightsGrid}>
          <div style={premiumInfoCard}>
            <div style={premiumInfoLabel}>На что уходят деньги</div>
            {primaryCategory.length === 0 ? <div style={premiumInfoValue}>Категории появятся после первых операций</div> : <div style={premiumTagRow}>{primaryCategory.map((item) => <div key={item.key} style={premiumTag}>{categoryLabelRu(item.key)} · {formatMoney(item.value)} ₽</div>)}</div>}
          </div>
          <div style={premiumInfoCard}>
            <div style={premiumInfoLabel}>Расходы и поступления</div>
            <div style={premiumDualStat}>
              <div><div style={premiumDualLabel}>Поступления</div><div style={premiumIncomeAmount}>+{formatMoney(incomeThisMonth)} ₽</div></div>
              <div><div style={premiumDualLabel}>Расходы</div><div style={premiumExpenseAmount}>-{formatMoney(expenseThisMonth)} ₽</div></div>
            </div>
          </div>
        </div>

        <div style={premiumAsideCard}>
          <div style={screenSubtitle}>Быстрые действия</div>
          <div style={isCompact ? { ...premiumShortcutGrid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } : premiumShortcutGrid}>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("internalTransfer")}><div style={premiumShortcutIcon}>⇄</div><div style={premiumShortcutTitle}>Свои счета</div><div style={premiumShortcutMeta}>Перевод между своими счетами</div></div>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("favorites")}><div style={premiumShortcutIcon}>★</div><div style={premiumShortcutTitle}>Избранное</div><div style={premiumShortcutMeta}>Шаблоны и частые переводы</div></div>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("application")}><div style={premiumShortcutIcon}>+</div><div style={premiumShortcutTitle}>Заявка</div><div style={premiumShortcutMeta}>Открыть новый продукт</div></div>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("support")}><div style={premiumShortcutIcon}>?</div><div style={premiumShortcutTitle}>Поддержка</div><div style={premiumShortcutMeta}>Чат и сервисные запросы</div></div>
          </div>
        </div>

        {latestNotification ? <div style={premiumNoticeCard} onClick={() => setActiveTab("notifications")}><div style={premiumNoticeKicker}>Последнее уведомление</div><div style={premiumNoticeTitle}>{repairMojibake(latestNotification.title)}</div><div style={premiumNoticeText}>{repairMojibake(latestNotification.message)}</div></div> : null}
        <div style={isCompact ? { ...premiumBannerCard, flexDirection: "column", alignItems: "flex-start" } : premiumBannerCard} onClick={() => setActiveTab("application")}><div><div style={premiumBannerTitle}>Новый продукт в один тап</div><div style={premiumBannerText}>Оформите карту или откройте счёт прямо из мини-приложения.</div></div><div style={premiumBannerIcon}>→</div></div>
      </div>
    </>
  );
}

function PaymentsScreen({ setActiveTab, favorites, operations, accounts, cards }) {
  const vkTemplates = (favorites || []).filter((item) => item.payment_type === "vk_transfer").slice(0, 4);
  const serviceTemplates = (favorites || []).filter((item) => item.payment_type === "service_payment").slice(0, 4);
  const recentRecipients = deriveRecentRecipients(operations);
  const activeCards = (cards || []).filter((card) => !repairMojibake(card?.status || "").toLowerCase().includes("блок")).length;
  const totalBalance = (accounts || []).reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const primaryAccount = getPrimaryAccount(accounts);

  const openTransferDraft = (draft) => {
    saveTransferDraft(draft);
    setActiveTab("transfer");
  };

  return (
    <ScreenLayout title="Платежи и переводы">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>Платежный центр</div>
        <div style={paymentsShowcaseTitle}>Все ежедневные переводы и платежи в одном месте</div>
        <div style={paymentsShowcaseText}>Используйте переводы по VK ID, быстрые шаблоны и повторные сценарии без лишних шагов.</div>
        <div style={paymentsShowcaseChipRow}>
          <div style={paymentsShowcaseChip}>Перевод по VK ID</div>
          <div style={paymentsShowcaseChip}>Шаблоны</div>
          <div style={paymentsShowcaseChip}>Оплата услуг</div>
        </div>
      </div>

      <div style={paymentsFeatureGrid}>
        <div style={paymentsFeatureCardPrimary} onClick={() => setActiveTab("transfer")}>
          <div style={paymentsFeatureIcon}>→</div>
          <div style={paymentsFeatureTitle}>Перевод по VK ID</div>
          <div style={paymentsFeatureText}>Главный сценарий банка: найдите клиента и отправьте деньги за пару шагов.</div>
        </div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("internalTransfer")}>
          <div style={paymentsFeatureIcon}>⇄</div>
          <div style={paymentsFeatureTitle}>Между своими счетами</div>
          <div style={paymentsFeatureText}>Быстро переведите деньги между своими банковскими счетами.</div>
        </div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("topup")}>
          <div style={paymentsFeatureIcon}>+</div>
          <div style={paymentsFeatureTitle}>Пополнить счет</div>
          <div style={paymentsFeatureText}>Быстрое пополнение карты или банковского счета.</div>
        </div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("pay")}>
          <div style={paymentsFeatureIcon}>₽</div>
          <div style={paymentsFeatureTitle}>Оплата услуг</div>
          <div style={paymentsFeatureText}>Связь, коммунальные услуги и регулярные платежи.</div>
        </div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("favorites")}>
          <div style={paymentsFeatureIcon}>★</div>
          <div style={paymentsFeatureTitle}>Избранное</div>
          <div style={paymentsFeatureText}>Повторяйте готовые сценарии без ручного ввода.</div>
        </div>
      </div>

      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Основной счет</div>
          <div style={premiumMetricValue}>{formatMoney(primaryAccount?.balance || 0)} ₽</div>
          <div style={operationsSummaryMeta}>{repairMojibake(primaryAccount?.account_name || "Пока не открыт")}</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Активные карты</div>
          <div style={premiumMetricValue}>{activeCards}</div>
          <div style={operationsSummaryMeta}>Можно использовать для оплаты и переводов</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Шаблоны</div>
          <div style={premiumMetricValue}>{favorites.length}</div>
          <div style={operationsSummaryMeta}>Частые сценарии для быстрого повтора</div>
        </div>
      </div>

      <div style={premiumPanelGrid}>
        <div style={menuCard}>
          <div style={sectionHeader}>
            <div>
              <div style={screenSubtitle}>Последние получатели</div>
              <div style={sectionLead}>Быстрый повтор недавних переводов по VK ID.</div>
            </div>
          </div>
          {recentRecipients.length === 0 ? (
            <div style={emptyBlock}>Пока нет недавних переводов.</div>
          ) : (
            <div style={operationsList}>
              {recentRecipients.map((item, index) => (
                <div key={`${item.recipientName}-${index}`} style={premiumOperationRow} onClick={() => openTransferDraft({ recipientName: item.recipientName, amount: String(Math.round(Math.abs(item.amount))), comment: "" })}>
                  <div style={operationIcon}>→</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={premiumOperationTitle}>{item.recipientName}</div>
                    <div style={operationMeta}>Перевод на {formatMoney(Math.abs(item.amount))} ₽</div>
                  </div>
                  <button style={compactButton} onClick={(event) => { event.stopPropagation(); openTransferDraft({ recipientName: item.recipientName, amount: String(Math.round(Math.abs(item.amount))), comment: "" }); }}>Повторить</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={menuCard}>
          <div style={sectionHeader}>
            <div>
              <div style={screenSubtitle}>Шаблоны и сценарии</div>
              <div style={sectionLead}>Готовые переводы и оплаты услуг для ежедневных сценариев.</div>
            </div>
            <button style={miniButton} onClick={() => setActiveTab("favorites")}>Все шаблоны</button>
          </div>
          <div style={premiumTemplatesGrid}>
            {vkTemplates.map((item) => (
              <div key={`vk-template-${item.id}`} style={premiumShortcutCard} onClick={() => openTransferDraft({ recipientName: repairMojibake(item.recipient_name || ""), amount: String(item.amount || ""), comment: "" })}>
                <div style={premiumShortcutIcon}>→</div>
                <div style={premiumShortcutTitle}>{repairMojibake(item.recipient_name || "Перевод по VK ID")}</div>
                <div style={premiumShortcutMeta}>VK ID: {item.recipient_value}</div>
              </div>
            ))}
            {serviceTemplates.map((item) => (
              <div key={`service-template-${item.id}`} style={premiumShortcutCard} onClick={() => setActiveTab("pay")}>
                <div style={premiumShortcutIcon}>₽</div>
                <div style={premiumShortcutTitle}>{repairMojibake(item.title || "Оплата услуги")}</div>
                <div style={premiumShortcutMeta}>{repairMojibake(item.provider_name || item.recipient_value || "Сервис")}</div>
              </div>
            ))}
            {vkTemplates.length === 0 && serviceTemplates.length === 0 ? <div style={emptyBlock}>Шаблонов пока нет.</div> : null}
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
    "Как пополнить баланс?",
    "Как перевести по VK ID?",
    "Как изменить PIN-код?",
    "У меня проблема с картой",
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
        setMessage(repairMojibake(data.error || "Не удалось отправить сообщение"));
        return;
      }
      setText("");
      setMessage(
        data.service_request
          ? `Диалог передан оператору: ${repairMojibake(data.service_request.request_type || "обращение")}`
          : ""
      );
      await loadMessages();
    } catch (error) {
      console.error(error);
      setMessage("Сетевая ошибка");
    }
  };

  const clearChat = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/support/messages/${vkId}/clear`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "Не удалось очистить чат"));
        return;
      }
      setMessages([]);
      setMessage("Чат очищен");
    } catch (error) {
      console.error(error);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Чат поддержки">
      <div style={menuCard}>
        <div style={sectionHeader}>
          <div>
            <div style={screenSubtitle}>Быстрые темы</div>
            <div style={sectionLead}>Выберите готовый вопрос или напишите свой.</div>
          </div>
          <button style={miniButton} onClick={clearChat}>Очистить чат</button>
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
        <div style={screenSubtitle}>Диалог</div>
        <div style={sectionLead}>История переписки с AI-помощником и сотрудниками банка.</div>
        {messages.length === 0 ? (
          <div style={emptyBlock}>Чат пока пуст. Начните диалог первым.</div>
        ) : (
          <div style={operationsList}>
            {messages.map((item) => {
              const senderLabel =
                repairMojibake(item.sender_label || "") ||
                (item.sender_type === "user"
                  ? "Вы"
                  : item.sender_type === "operator"
                    ? "Оператор"
                    : "AI-помощник");

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
        <div style={screenSubtitle}>Новое сообщение</div>
        <div style={sectionLead}>Опишите проблему или задайте вопрос по картам, переводам и продуктам.</div>
        <textarea
          style={{ ...textarea, minHeight: 140 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Например: не проходит перевод по VK ID"
        />
        {message ? <div style={messageBox}>{message}</div> : null}
        <button style={primaryButton} onClick={sendMessage}>Отправить сообщение</button>
      </div>
    </ScreenLayout>
  );
}


function MoreScreen({ setActiveTab }) {
  return (
    <ScreenLayout title="Ещё">
      <div style={premiumPanelGrid}>
        <MenuCard title="Профиль" subtitle="Личные данные, тема, язык" onClick={() => setActiveTab("profile")} />
        <MenuCard title="Мои карты" subtitle="Реквизиты и управление картами" onClick={() => setActiveTab("cards")} />
        <MenuCard title="Заявки" subtitle="Новые продукты и их статусы" onClick={() => setActiveTab("applications")} />
        <MenuCard title="Открыть счёт" subtitle="Быстрое оформление нового счёта" onClick={() => setActiveTab("createAccount")} />
        <MenuCard title="Безопасность" subtitle="PIN, карты и рекомендации" onClick={() => setActiveTab("security")} />
        <MenuCard title="Поддержка" subtitle="FAQ, чат и запросы" onClick={() => setActiveTab("support")} />
        <MenuCard title="Настройки" subtitle="Тема, язык, скрытие баланса" onClick={() => setActiveTab("settings")} />
      </div>
    </ScreenLayout>
  );
}


function AccountsScreen({ accounts, cards, setActiveTab, onAccountOpen, onCardOpen, hideBalance }) {
  return (
    <ScreenLayout title="Мои счета и карты">
      <div style={premiumPanelGrid}>
        <div style={menuCard}>
          <div style={screenSubtitle}>Счета</div>
          {accounts.length === 0 ? <div style={emptyBlock}>Активных счетов пока нет</div> : accounts.map((account) => (
            <div key={account.id} style={premiumOperationRow} onClick={() => onAccountOpen(account.id)}>
              <div style={operationIcon}>₽</div>
              <div style={{ flex: 1 }}>
                <div style={premiumOperationTitle}>
                  {repairMojibake(account.account_name || "Счёт")}
                  {account.is_primary ? " · Основной" : ""}
                </div>
                <div style={operationMeta}>
                  {accountTypeLabel(account.account_type)} · {repairMojibake(account.status || "Активен")}
                </div>
              </div>
              <div style={premiumOperationAmount}>{hideBalance ? "•••••• ₽" : `${formatMoney(account.balance)} ₽`}</div>
            </div>
          ))}
        </div>
        <div style={menuCard}>
          <div style={sectionHeader}><div style={screenSubtitle}>Карты</div><button style={miniButton} onClick={() => setActiveTab("cards")}>Открыть</button></div>
          {cards.length === 0 ? <div style={emptyBlock}>Карт пока нет</div> : cards.map((card) => (
            <div key={card.id} style={premiumOperationRow} onClick={() => onCardOpen(card.id)}>
              <div style={operationIcon}>💳</div>
              <div style={{ flex: 1 }}>
                <div style={premiumOperationTitle}>{repairMojibake(card.card_name || "Банковская карта")}</div>
                <div style={operationMeta}>{repairMojibake(card.card_number_mask || "0000 •••• •••• 0000")}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ScreenLayout>
  );
}


function AccountDetailsScreen({ vkId, accountId, accounts, onBack, onActionDone }) {
  const [accountData, setAccountData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [closeComment, setCloseComment] = useState("");
  const [paymentSourceId, setPaymentSourceId] = useState("");

  const loadAccount = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const res = await apiFetch(`${API_BASE}/accounts/${accountId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        setAccountData(null);
        setLoadError(repairMojibake(data?.error || "Не удалось загрузить счет"));
        return;
      }
      setAccountData(data);
    } catch (error) {
      console.error(error);
      setAccountData(null);
      setLoadError("Не удалось загрузить счет");
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    if (!accountData?.is_credit) return;
    const possibleSource = (accounts || []).find(
      (item) => item.id !== accountData.id && !item.is_credit
    );
    if (possibleSource) {
      setPaymentSourceId(String(possibleSource.id));
    }
  }, [accountData, accounts]);

  if (isLoading) {
    return <div style={loading}>Загрузка счета...</div>;
  }

  if (!accountData) {
    return (
      <ScreenLayout title="Счет">
        <div style={emptyBlock}>{loadError || "Не удалось загрузить счет"}</div>
        <div style={detailActionBar}>
          <button style={secondaryButton} onClick={onBack}>Назад</button>
          <button style={primaryButton} onClick={loadAccount}>Повторить</button>
        </div>
      </ScreenLayout>
    );
  }

  const sourceAccounts = (accounts || []).filter(
    (item) => item.id !== accountData.id && !item.is_credit
  );

  const requestClose = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/accounts/${accountId}/close-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: String(vkId),
          comment: closeComment.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "Не удалось отправить запрос"));
        return;
      }
      setMessage("Запрос на закрытие счета отправлен");
      setCloseComment("");
      onActionDone();
    } catch (error) {
      console.error(error);
      setMessage("Сетевая ошибка");
    }
  };

  const payCredit = async (paymentKind) => {
    if (!paymentSourceId) {
      setMessage("Выберите счет списания");
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/accounts/${accountId}/credit-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: String(vkId),
          from_account_id: Number(paymentSourceId),
          payment_kind: paymentKind,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "Не удалось провести платеж"));
        return;
      }
      setMessage(
        paymentKind === "full"
          ? "Кредитный счет погашен полностью"
          : "Обязательный платеж внесен"
      );
      await loadAccount();
      onActionDone();
    } catch (error) {
      console.error(error);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Счет">
      <div style={menuCard}>
        <button style={{ ...compactButton, width: "fit-content" }} onClick={onBack}>← Назад к счетам</button>
        <div style={{ height: 16 }} />
        <div style={paymentsShowcaseCard}>
          <div style={paymentsShowcaseEyebrow}>{accountTypeLabel(accountData.account_type)}</div>
          <div style={paymentsShowcaseTitle}>{repairMojibake(accountData.account_name || "Счет")}</div>
          <div style={paymentsShowcaseText}>
            {repairMojibake(accountData.status || "Активен")}
            {accountData.is_primary ? " • Основной счет" : ""}
          </div>
          <div style={{ marginTop: 18, fontSize: 34, fontWeight: 800, color: "#f3f7ff" }}>
            {formatMoney(accountData.balance || 0)} ₽
          </div>
        </div>
      </div>

      {message ? <div style={messageBox}>{message}</div> : null}

      <div style={detailsInfoGrid}>
        <div style={detailsInfoCard}>
          <div style={premiumInfoLabel}>Номер счета</div>
          <div style={premiumInfoValue}>{repairMojibake(accountData.account_number) || "Нет данных"}</div>
        </div>
        <div style={detailsInfoCard}>
          <div style={premiumInfoLabel}>Валюта</div>
          <div style={premiumInfoValue}>{repairMojibake(accountData.currency) || "RUB"}</div>
        </div>
        <div style={detailsInfoCard}>
          <div style={premiumInfoLabel}>Статус</div>
          <div style={premiumInfoValue}>{repairMojibake(accountData.status) || "Активен"}</div>
        </div>
        <div style={detailsInfoCard}>
          <div style={premiumInfoLabel}>Карт привязано</div>
          <div style={premiumInfoValue}>{Array.isArray(accountData.linked_cards) ? accountData.linked_cards.length : 0}</div>
        </div>
      </div>

      {accountData.linked_cards?.length ? (
        <div style={menuCard}>
          <div style={sectionHeader}>
            <div>
              <div style={screenSubtitle}>Карты по счету</div>
              <div style={sectionLead}>Карты, выпущенные к этому счету.</div>
            </div>
          </div>
          <div style={operationsList}>
            {accountData.linked_cards.map((card) => (
              <div key={card.id} style={premiumOperationRow}>
                <div style={operationIcon}>💳</div>
                <div style={{ flex: 1 }}>
                  <div style={premiumOperationTitle}>{repairMojibake(card.card_name || "Карта")}</div>
                  <div style={operationMeta}>{repairMojibake(card.card_number_mask || "")}</div>
                </div>
                <div style={operationMeta}>{repairMojibake(card.status || "Активна")}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {accountData.is_credit ? (
        <div style={menuCard}>
          <div style={sectionHeader}>
            <div>
              <div style={screenSubtitle}>Погашение задолженности</div>
              <div style={sectionLead}>Можно внести обязательный платеж или закрыть долг полностью.</div>
            </div>
          </div>
          <div style={detailsInfoGrid}>
            <div style={detailsInfoCard}>
              <div style={premiumInfoLabel}>Остаток долга</div>
              <div style={premiumInfoValue}>{formatMoney(accountData.debt_amount || 0)} ₽</div>
            </div>
            <div style={detailsInfoCard}>
              <div style={premiumInfoLabel}>Обязательный платеж</div>
              <div style={premiumInfoValue}>{formatMoney(accountData.minimum_payment || 0)} ₽</div>
            </div>
            <div style={detailsInfoCard}>
              <div style={premiumInfoLabel}>Ближайшая дата</div>
              <div style={premiumInfoValue}>{repairMojibake(accountData.next_payment_date) || "—"}</div>
            </div>
          </div>
          <div style={inputLabel}>Счет списания</div>
          <select style={input} value={paymentSourceId} onChange={(e) => setPaymentSourceId(e.target.value)}>
            <option value="">Выберите счет</option>
            {sourceAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {repairMojibake(acc.account_name)} · {formatMoney(acc.balance)} ₽
              </option>
            ))}
          </select>
          <div style={detailActionBar}>
            <button style={secondaryButton} onClick={() => payCredit("minimum")}>Внести обязательный платеж</button>
            <button style={primaryButton} onClick={() => payCredit("full")}>Погасить полностью</button>
          </div>
        </div>
      ) : null}

      <div style={menuCard}>
        <div style={sectionHeader}>
          <div>
            <div style={screenSubtitle}>Заявка на закрытие счета</div>
            <div style={sectionLead}>
              Для закрытия счета банк создаст сервисный запрос и проверит остаток средств.
            </div>
          </div>
        </div>
        {accountData.can_request_close ? (
          <>
            <div style={inputLabel}>Комментарий для банка</div>
            <textarea
              style={textarea}
              value={closeComment}
              onChange={(e) => setCloseComment(e.target.value)}
              placeholder="Например: счет больше не нужен"
            />
            <button style={primaryButton} onClick={requestClose}>Подать заявку на закрытие счета</button>
          </>
        ) : (
          <div style={emptyBlock}>{repairMojibake(accountData.close_restriction) || "Сейчас закрытие счета недоступно"}</div>
        )}
      </div>

      <div style={menuCard}>
        <div style={sectionHeader}>
          <div>
            <div style={screenSubtitle}>Последние операции</div>
            <div style={sectionLead}>Последние движения по этому счету.</div>
          </div>
        </div>
        {!accountData.operations?.length ? (
          <div style={emptyBlock}>По счету пока нет операций</div>
        ) : (
          <div style={operationsList}>
            {accountData.operations.map((item) => (
              <div key={item.id} style={premiumOperationRow}>
                <div style={operationIcon}>{item.operation_type === "income" ? "↓" : "↑"}</div>
                <div style={{ flex: 1 }}>
                  <div style={premiumOperationTitle}>{humanizeOperationTitle(item.title, item.operation_type)}</div>
                  <div style={operationMeta}>{repairMojibake(item.created_at || "")}</div>
                </div>
                <div style={item.operation_type === "income" ? premiumIncomeAmount : premiumExpenseAmount}>
                  {item.operation_type === "income" ? "+" : "−"}{formatMoney(item.amount)} ₽
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ScreenLayout>
  );
}




function CardsScreen({ cards, onActionDone, onCardOpen }) {
  const [message, setMessage] = useState("");

  const normalizedCards = (cards || []).map((card) => {
    const safeStatus = repairMojibake(card?.status) || "Активна";
    return {
      ...card,
      safeName: repairMojibake(card?.card_name) || "Банковская карта",
      safeMask: repairMojibake(card?.card_number_mask) || "0000 •••• •••• 0000",
      safeSystem: repairMojibake(card?.payment_system) || "МИР",
      safeStatus,
      safeLinkedAccountName: repairMojibake(card?.linked_account_name) || "Основной счет",
      isBlocked: safeStatus.toLowerCase().includes("блок"),
    };
  });

  const featuredCard = normalizedCards.find((card) => card.is_primary_account_card) || normalizedCards[0] || null;
  const activeCards = normalizedCards.filter((card) => !card.isBlocked);

  const blockCard = async (cardId) => {
    try {
      const res = await apiFetch(`${API_BASE}/cards/${cardId}/block`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "Не удалось заблокировать карту"));
        return;
      }
      setMessage("Карта заблокирована");
      onActionDone();
    } catch {
      setMessage("Сетевая ошибка");
    }
  };

  const requestUnblock = async (cardId) => {
    try {
      const res = await apiFetch(`${API_BASE}/cards/${cardId}/request-unblock`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "Не удалось отправить запрос на разблокировку"));
        return;
      }
      setMessage("Запрос на разблокировку отправлен");
      onActionDone();
    } catch {
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Мои карты">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Всего карт</div>
          <div style={premiumMetricValue}>{normalizedCards.length}</div>
          <div style={operationsSummaryMeta}>Все карты, выпущенные к вашим счетам.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Активные</div>
          <div style={premiumMetricValue}>{activeCards.length}</div>
          <div style={operationsSummaryMeta}>Карты, которыми можно пользоваться сейчас.</div>
        </div>
      </div>

      {message ? <div style={messageBox}>{message}</div> : null}

      <div style={menuCard}>
        <div style={paymentsShowcaseEyebrow}>Основная карта</div>
        {featuredCard ? (
          <>
            <div style={{ ...accountCard, minHeight: 0 }}>
              <div style={cardLogo}>{featuredCard.safeSystem}</div>
              <div style={accountCardLabel}>{featuredCard.safeName}</div>
              <div style={{ ...accountCardNumber, marginTop: 8 }}>{featuredCard.safeMask}</div>
              <div style={{ ...accountCardMeta, marginTop: 8 }}>
                {featuredCard.safeStatus} · {featuredCard.safeLinkedAccountName}
              </div>
              <div style={{ ...accountCardAmount, marginTop: 12 }}>{formatMoney(featuredCard.balance || 0)} ₽</div>
            </div>
            <div style={detailActionBar}>
              <button style={compactButton} onClick={() => onCardOpen(featuredCard.id)}>Реквизиты</button>
              {!featuredCard.isBlocked ? (
                <button style={compactButton} onClick={() => blockCard(featuredCard.id)}>Заблокировать</button>
              ) : (
                <button style={compactButton} onClick={() => requestUnblock(featuredCard.id)}>Разблокировать</button>
              )}
            </div>
          </>
        ) : (
          <div style={emptyBlock}>Карты пока не выпущены. Вы сможете открыть их после оформления продукта.</div>
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
            <div style={accountCardAmount}>{formatMoney(card.balance || 0)} ₽</div>
            <div style={detailActionBar}>
              <button
                style={compactButton}
                onClick={(e) => {
                  e.stopPropagation();
                  onCardOpen(card.id);
                }}
              >
                Реквизиты
              </button>
              {!card.isBlocked ? (
                <button
                  style={compactButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    blockCard(card.id);
                  }}
                >
                  Заблокировать
                </button>
              ) : (
                <button
                  style={compactButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    requestUnblock(card.id);
                  }}
                >
                  Разблокировать
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
    return <div style={loading}>Загрузка...</div>;
  }

  const requisites = cardData?.requisites || {};
  const title = repairMojibake(cardData?.card_name) || "Банковская карта";
  const mask = repairMojibake(showFullNumber ? cardData?.full_card_number : cardData?.card_number_mask) || "0000 •••• •••• 0000";
  const status = repairMojibake(cardData?.status) || "Активна";
  const paymentSystem = repairMojibake(cardData?.payment_system) || "МИР";
  const expiry = repairMojibake(cardData?.expiry_date) || "12/30";
  const linkedAccountName = repairMojibake(cardData?.linked_account_name) || "Основной счет";

  return (
    <ScreenLayout title="Реквизиты карты">
      <div style={menuCard}>
        <button style={{ ...compactButton, width: "fit-content" }} onClick={onBack}>← Назад к картам</button>
        <div style={{ height: 16 }} />
        <div style={paymentsShowcaseCard}>
          <div style={paymentsShowcaseEyebrow}>Детали и статус</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={paymentsShowcaseTitle}>{title}</div>
              <div style={paymentsShowcaseText}>{paymentSystem} • {status} • {linkedAccountName}</div>
              <div style={{ marginTop: 16, fontSize: 28, fontWeight: 800, color: "#f3f7ff" }}>{mask}</div>
              <div style={{ marginTop: 10, color: "#8ea8c6" }}>Срок действия: {expiry}</div>
              <div style={{ marginTop: 10, color: "#d8ecff", fontWeight: 700 }}>Баланс карты: {formatMoney(cardData?.balance || 0)} ₽</div>
            </div>
            <button style={compactButton} onClick={() => setShowFullNumber((prev) => !prev)}>{showFullNumber ? "Скрыть номер" : "Показать номер"}</button>
          </div>
        </div>
      </div>

      <div style={menuCard}>
        <div style={sectionHeader}>
          <div>
            <div style={screenSubtitle}>Банковские реквизиты</div>
            <div style={sectionLead}>Данные карты для переводов и проверок.</div>
          </div>
        </div>
        <div style={detailsInfoGrid}>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Счет</div><div style={premiumInfoValue}>{repairMojibake(requisites.account_number) || "Нет данных"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>БИК</div><div style={premiumInfoValue}>{repairMojibake(requisites.bik) || "Нет данных"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Корр. счет</div><div style={premiumInfoValue}>{repairMojibake(requisites.correspondent_account) || "Нет данных"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Банк</div><div style={premiumInfoValue}>{repairMojibake(requisites.bank_name) || "ZF Bank"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Валюта</div><div style={premiumInfoValue}>{repairMojibake(requisites.currency) || "RUB"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>CVV</div><div style={premiumInfoValue}>{repairMojibake(cardData?.cvv_code) || "000"}</div></div>
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
    { key: "", label: "Все" },
    { key: "transfer", label: "Переводы" },
    { key: "shopping", label: "Покупки" },
    { key: "services", label: "Услуги" },
    { key: "subscription", label: "Подписки" },
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
      .catch((err) => console.error("Ошибка загрузки операций:", err));
  };

  useEffect(() => {
    loadOperations();
  }, [vkId, accountId, operationType, category]);

  const incomeCount = operations.filter((item) => item.operation_type === "income").length;
  const expenseCount = operations.filter((item) => item.operation_type === "expense").length;
  const incomeSum = operations.filter((item) => item.operation_type === "income").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenseSum = operations.filter((item) => item.operation_type === "expense").reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return (
    <ScreenLayout title="Операции">
      <div style={operationsSummaryGrid}>
        <div style={operationsSummaryCard}><div style={premiumMetricLabel}>Всего операций</div><div style={operationsSummaryValue}>{operations.length}</div></div>
        <div style={operationsSummaryCard}><div style={premiumMetricLabel}>Поступления</div><div style={premiumIncomeAmount}>+{formatMoney(incomeSum)} ₽</div><div style={operationsSummaryMeta}>{incomeCount} операций</div></div>
        <div style={operationsSummaryCard}><div style={premiumMetricLabel}>Расходы</div><div style={premiumExpenseAmount}>−{formatMoney(expenseSum)} ₽</div><div style={operationsSummaryMeta}>{expenseCount} операций</div></div>
      </div>

      <div style={premiumSectionBlock}>
        <div style={sectionHeader}><div><div style={screenSubtitle}>Фильтры</div><div style={sectionLead}>Уточняйте выдачу по счёту, типу и категории, чтобы быстрее находить нужное движение.</div></div></div>
        <div style={{ marginBottom: "14px" }}>
          <div style={{ ...inputLabel, marginTop: 0 }}>Быстрые фильтры</div>
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
          <div><div style={inputLabel}>Счёт</div><select style={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Все счета</option>{accounts.map((acc) => <option key={acc.id} value={acc.id}>{repairMojibake(acc.account_name)}</option>)}</select></div>
          <div><div style={inputLabel}>Тип операции</div><select style={input} value={operationType} onChange={(e) => setOperationType(e.target.value)}><option value="">Все</option><option value="income">Только поступления</option><option value="expense">Только расходы</option></select></div>
          <div><div style={inputLabel}>Категория</div><select style={input} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Все категории</option><option value="transfer">Переводы</option><option value="shopping">Покупки</option><option value="subscription">Подписки</option><option value="topup">Пополнения</option><option value="services">Услуги</option><option value="commission">Комиссии</option></select></div>
        </div>
      </div>

      {operations.length === 0 ? <div style={emptyBlock}>Операции не найдены. Попробуйте снять фильтры или выполнить первое действие в приложении.</div> : (
        <div style={premiumSectionBlock}>
          <div style={sectionHeader}><div><div style={screenSubtitle}>Лента операций</div><div style={sectionLead}>Показываем самые свежие движения по счетам с краткой меткой категории.</div></div></div>
          <div style={premiumOperationsList}>
            {operations.map((item) => (
              <div key={item.id} style={premiumOperationCard} onClick={() => onOpenOperation?.(item.id)}>
                <div style={premiumOperationLeading}>
                  <div style={premiumOperationIcon}>{item.operation_type === "income" ? "↓" : "↑"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={premiumOperationTitle}>{humanizeOperationTitle(item.title, item.operation_type)}</div><div style={premiumOperationMeta}>{formatOperationDate(item.created_at)}</div></div>
                </div>
                <div style={premiumOperationTrailing}><div style={premiumCategoryPill}>{categoryLabelRu(item.category)}</div><div style={item.operation_type === "income" ? premiumIncomeAmount : premiumExpenseAmount}>{item.operation_type === "income" ? "+" : "в€’"}{formatMoney(item.amount)} ₽</div></div>
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
        if (!cancelled) setError("Не удалось загрузить операцию");
      });
    return () => {
      cancelled = true;
    };
  }, [vkId, operationId]);

  if (error) {
    return <ScreenLayout title="Деталь операции"><div style={messageBox}>{error}</div></ScreenLayout>;
  }

  if (!operation) {
    return <div style={loading}>Загрузка...</div>;
  }

  const title = humanizeOperationTitle(operation.title, operation.operation_type);
  const subtitle = `${repairMojibake(operation.category || "transfer")} • ${formatOperationDate(operation.created_at)}`;
  const isExpense = operation.operation_type === "expense";
  const isVkTransfer = title.toLowerCase().includes("vk id");

  return (
    <ScreenLayout title="Деталь операции">
      <div style={menuCard}>
        <button style={{ ...compactButton, width: "fit-content", marginBottom: 16 }} onClick={onBack}>← Назад к операциям</button>
        <div style={premiumNoticeCard}>
          <div style={premiumNoticeKicker}>Операция</div>
          <div style={premiumNoticeTitle}>{title}</div>
          <div style={premiumNoticeText}>{subtitle}</div>
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, color: isExpense ? "#ffb36a" : "#87f0ad", marginTop: 18 }}>
          {isExpense ? "-" : "+"}{formatMoney(Math.abs(Number(operation.amount || 0)))} ₽
        </div>
      </div>

      <div style={menuCard}>
        <div style={detailsInfoGrid}>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Статус</div><div style={premiumInfoValue}>{repairMojibake(operation.status) || "В обработке"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Счет</div><div style={premiumInfoValue}>{repairMojibake(operation.account_name) || "Счет банка"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Категория</div><div style={premiumInfoValue}>{repairMojibake(operation.category || "transfer")}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>ID</div><div style={premiumInfoValue}>{operation.id}</div></div>
        </div>
      </div>

      <div style={paymentsFeatureGrid}>
        <div style={paymentsFeatureCardPrimary} onClick={() => setActiveTab(isVkTransfer && isExpense ? "transfer" : "payments")}>
          <div style={paymentsFeatureIcon}>→</div>
          <div style={paymentsFeatureTitle}>{isVkTransfer && isExpense ? "Повторить перевод" : "В платежи"}</div>
          <div style={paymentsFeatureText}>Быстрый переход к повтору сценария или новой операции.</div>
        </div>
        <div style={serviceFeatureCard} onClick={() => setActiveTab("favorites")}>
          <div style={paymentsFeatureIcon}>★</div>
          <div style={paymentsFeatureTitle}>Сохранить шаблон</div>
          <div style={paymentsFeatureText}>Добавьте сценарий в избранное для повтора.</div>
        </div>
        <div style={serviceFeatureCard} onClick={() => setActiveTab("support")}>
          <div style={paymentsFeatureIcon}>?</div>
          <div style={paymentsFeatureTitle}>Нужна помощь</div>
          <div style={paymentsFeatureText}>Если по операции есть вопросы, сразу откройте поддержку.</div>
        </div>
      </div>
    </ScreenLayout>
  );
}


function AnalyticsScreen({ analytics }) {
  const categories = analytics?.categories || {};
  const total = Number(analytics?.total_expenses || 0);

  const categoryMap = [
    { key: "shopping", label: "Покупки" },
    { key: "transfer", label: "Переводы" },
    { key: "subscription", label: "Подписки" },
    { key: "services", label: "Услуги" },
    { key: "commission", label: "Комиссии" },
    { key: "other", label: "Другое" },
  ];

  return (
    <ScreenLayout title="Аналитика расходов">
      <div style={analyticsCard}>
        <div style={analyticsTotalLabel}>Общие расходы</div>
        <div style={analyticsTotalValue}>
          {total.toLocaleString("ru-RU", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} ₽
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
                })} ₽
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
    <ScreenLayout title="Уведомления">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}><div style={premiumMetricLabel}>Всего</div><div style={premiumMetricValue}>{notifications.length}</div><div style={operationsSummaryMeta}>Все события по вашему банку.</div></div>
        <div style={premiumMetricCard}><div style={premiumMetricLabel}>Непрочитанные</div><div style={premiumMetricValue}>{unread.length}</div><div style={operationsSummaryMeta}>Новые события, требующие внимания.</div></div>
      </div>

      <div style={menuCard}>
        <div style={sectionHeader}>
          <div>
            <div style={screenSubtitle}>Новые уведомления</div>
            <div style={sectionLead}>Сначала показываем непрочитанное.</div>
          </div>
          <button style={miniButton} onClick={markAllRead}>Прочитать все</button>
        </div>
        {unread.length === 0 ? <div style={emptyBlock}>Непрочитанных уведомлений нет</div> : (
          <div style={operationsList}>
            {unread.map((item) => (
              <div key={item.id} style={premiumOperationRow}>
                <div style={operationIcon}>•</div>
                <div style={{ flex: 1 }}>
                  <div style={premiumOperationTitle}>{repairMojibake(item.title)}</div>
                  <div style={operationMeta}>{repairMojibake(item.message)}</div>
                </div>
                <button style={secondaryButton} onClick={() => markRead(item.id)}>Отметить</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={menuCard}>
        <div style={sectionHeader}><div><div style={screenSubtitle}>История</div><div style={sectionLead}>Все прошлые уведомления.</div></div></div>
        {read.length === 0 ? <div style={emptyBlock}>История пока пуста</div> : (
          <div style={operationsList}>
            {read.map((item) => (
              <div key={item.id} style={premiumOperationRow}>
                <div style={operationIcon}>✓</div>
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
    <ScreenLayout title="Избранное">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}><div style={premiumMetricLabel}>Всего шаблонов</div><div style={premiumMetricValue}>{favorites.length}</div><div style={operationsSummaryMeta}>Сохраненные сценарии для быстрого запуска.</div></div>
        <div style={premiumMetricCard}><div style={premiumMetricLabel}>VK ID</div><div style={premiumMetricValue}>{vkFavorites.length}</div><div style={operationsSummaryMeta}>Частые переводы клиентам.</div></div>
        <div style={premiumMetricCard}><div style={premiumMetricLabel}>Услуги</div><div style={premiumMetricValue}>{serviceFavorites.length}</div><div style={operationsSummaryMeta}>Шаблоны для сервисных платежей.</div></div>
      </div>

      {favorites.length === 0 ? <div style={emptyBlock}>Избранное пока пусто</div> : (
        <div style={premiumTemplatesGrid}>
          {favorites.map((item) => (
            <div key={item.id} style={premiumShortcutCard}>
              <div style={premiumShortcutIcon}>{item.payment_type === "vk_transfer" ? "→" : "₽"}</div>
              <div style={premiumShortcutTitle}>{repairMojibake(item.title || item.recipient_name || "Шаблон")}</div>
              <div style={premiumShortcutMeta}>{item.payment_type === "vk_transfer" ? `VK ID: ${item.recipient_value}` : repairMojibake(item.provider_name || item.recipient_value || "Услуга")}</div>
              <div style={detailActionBar}>
                <button type="button" style={compactButton} onClick={() => openFavorite(item)}>Повторить</button>
                <button type="button" style={compactButton} onClick={() => setActiveTab(item.payment_type === "vk_transfer" ? "transfer" : "pay")}>
Открыть</button>
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
  const fullName = repairMojibake(profile.full_name || "Клиент ZF Bank");
  const avatarLetter = fullName ? fullName[0].toUpperCase() : "К";
  const phone = profile.phone ? normalizeRussianPhone(profile.phone) : "Номер не указан";
  const language = profile.language === "en" ? "Английский" : "Русский";
  const theme = repairMojibake(profile.app_theme || "dark").toLowerCase() === "dark" ? "Темная" : "Светлая";
  const createdAt = repairMojibake(profile.created_at || "Нет данных");
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
      setMessage("Укажите номер в формате +7XXXXXXXXXX");
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
        setMessage(repairMojibake(data.error || "Не удалось обновить телефон"));
        return;
      }
      setMessage("Телефон привязан к профилю");
      setIsEditingPhone(false);
      onRefresh();
    } catch (err) {
      console.error(err);
      setMessage("Сетевая ошибка");
    }
  };

  const requestUnblock = async (cardId) => {
    try {
      const res = await apiFetch(`${API_BASE}/cards/${cardId}/request-unblock`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(typeof data.error === "string" ? data.error : "Не удалось отправить запрос на разблокировку"));
        return;
      }
      setMessage("Запрос на разблокировку отправлен");
      onActionDone();
    } catch (err) {
      console.error(err);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Профиль">
      <div style={menuCard}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ ...avatar, width: 72, height: 72, fontSize: 30 }}>{avatarLetter}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "28px", fontWeight: 800, color: "#f3f7ff" }}>{fullName}</div>
            <div style={{ color: "#8bb7f0", marginTop: 4 }}>Банк во ВКонтакте</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={pill}>VK ID: {profile.vk_id}</div>
            <div style={pill}>{phone}</div>
          </div>
        </div>
      </div>

      <div style={menuCard}>
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#f3f7ff", marginBottom: 8 }}>Контакты и безопасность</div>
        <div style={{ color: "#9ab2cc", marginBottom: 16 }}>Привяжите актуальный телефон к банковскому профилю и перейдите в раздел безопасности для управления PIN и входами.</div>
        {!isEditingPhone && profile.phone ? (
          <div style={detailsInfoGrid}>
            <div style={detailsInfoCard}>
              <div style={premiumInfoLabel}>Текущий телефон</div>
              <div style={premiumInfoValue}>{phone}</div>
            </div>
          </div>
        ) : (
          <>
            <div style={inputLabel}>Телефон</div>
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
            <button style={primaryButton} onClick={savePhone}>Сохранить телефон</button>
          ) : (
            <button style={secondaryButton} onClick={() => { setIsEditingPhone(true); setMessage(""); }}>
              Изменить номер телефона
            </button>
          )}
          <button style={secondaryButton} onClick={() => setActiveTab("security")}>Открыть безопасность</button>
        </div>
      </div>

      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Статус профиля</div>
          <div style={premiumMetricValue}>Активен</div>
          <div style={operationsSummaryMeta}>Переводы, карты и продукты доступны.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Язык</div>
          <div style={premiumMetricValue}>{language}</div>
          <div style={operationsSummaryMeta}>Можно изменить позже в настройках.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Тема</div>
          <div style={premiumMetricValue}>{theme}</div>
          <div style={operationsSummaryMeta}>Единый стиль банка на всех экранах.</div>
        </div>
      </div>

      <div style={menuCard}>
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#f3f7ff", marginBottom: 8 }}>Личные данные</div>
        <div style={{ color: "#9ab2cc", marginBottom: 16 }}>Краткая сводка по вашему банковскому профилю.</div>
        <div style={detailsInfoGrid}>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>ФИО</div><div style={premiumInfoValue}>{fullName}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Телефон</div><div style={premiumInfoValue}>{phone}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>VK ID</div><div style={premiumInfoValue}>{profile.vk_id}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Дата регистрации</div><div style={premiumInfoValue}>{createdAt}</div></div>
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
        setMessage(repairMojibake(data.error || "Не удалось обновить настройки"));
        return;
      }
      setMessage("Настройки обновлены");
      onRefresh();
    } catch (err) {
      console.error(err);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Настройки">
      <div style={premiumPanelGrid}>
        <div style={premiumMetricsGrid}>
          <MenuCard
            title="Скрытие баланса"
            subtitle={userData.hide_balance ? "Баланс скрыт во всех витринах" : "Баланс отображается на экранах"}
            onClick={() => updateSettings({ hide_balance: !userData.hide_balance })}
          />
          <MenuCard
            title="Уведомления"
            subtitle={userData.notifications_enabled ? "Уведомления включены" : "Уведомления выключены"}
            onClick={() => updateSettings({ notifications_enabled: !userData.notifications_enabled })}
          />
          <MenuCard
            title="Язык"
            subtitle={userData.language === "en" ? "Английский" : "Русский"}
            onClick={() => updateSettings({ language: userData.language === "en" ? "ru" : "en" })}
          />
          <MenuCard
            title="Тема"
            subtitle={repairMojibake(userData.app_theme || "dark") === "light" ? "Светлая" : "Темная"}
            onClick={() => updateSettings({ app_theme: repairMojibake(userData.app_theme || "dark") === "light" ? "dark" : "light" })}
          />
        </div>
        {message ? <div style={messageBox}>{message}</div> : null}
        <MenuCard title="Выйти" subtitle="Завершить сессию в банке" onClick={onLogout} />
      </div>
    </ScreenLayout>
  );
}


function OnboardingScreen({ vkId, onDone }) {
  const steps = [
    { title: "Откройте счёт", text: "Создайте первый счёт для переводов и хранения денег." },
    { title: "Перевод по VK ID", text: "Быстро найдите клиента и отправьте деньги в пару шагов." },
    { title: "Держите всё под рукой", text: "История операций, карты, уведомления и поддержка в одном месте." },
  ];
  return (
    <ScreenLayout title="Начало работы">
      <div style={paymentsShowcaseCard}><div style={paymentsShowcaseEyebrow}>ZF Bank</div><div style={paymentsShowcaseTitle}>Ваш банк внутри VK</div><div style={paymentsShowcaseText}>Коротко покажем основные сценарии.</div></div>
      <div style={premiumPanelGrid}>{steps.map((step) => <MenuCard key={step.title} title={step.title} subtitle={step.text} />)}</div>
      <button style={primaryButton} onClick={onDone}>Понятно</button>
    </ScreenLayout>
  );
}



function SupportScreen({ setActiveTab }) {
  return (
    <ScreenLayout title="Поддержка">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>Сервисный центр</div>
        <div style={paymentsShowcaseTitle}>Поможем с переводами, картами и сервисами банка</div>
        <div style={paymentsShowcaseText}>Выберите чат, сервисный запрос, FAQ или сообщение о проблеме.</div>
      </div>

      <div style={serviceCenterGrid}>
        <div style={serviceFeatureCardPrimary} onClick={() => setActiveTab("chat")}>
          <div style={paymentsFeatureIcon}>💬</div>
          <div style={paymentsFeatureTitle}>Чат с банком</div>
          <div style={paymentsFeatureText}>Прямой диалог с поддержкой в мини-приложении.</div>
        </div>
        <div style={serviceFeatureCard} onClick={() => setActiveTab("serviceRequests")}>
          <div style={paymentsFeatureIcon}>🧾</div>
          <div style={paymentsFeatureTitle}>Сервисные запросы</div>
          <div style={paymentsFeatureText}>История заявок и статусы обращений.</div>
        </div>
        <div style={serviceFeatureCard} onClick={() => setActiveTab("problemReport")}>
          <div style={paymentsFeatureIcon}>!</div>
          <div style={paymentsFeatureTitle}>Сообщить о проблеме</div>
          <div style={paymentsFeatureText}>Быстро передайте в банк описание ошибки.</div>
        </div>
        <div style={serviceFeatureCard} onClick={() => setActiveTab("faq")}>
          <div style={paymentsFeatureIcon}>i</div>
          <div style={paymentsFeatureTitle}>FAQ</div>
          <div style={paymentsFeatureText}>Частые вопросы по переводам, картам и заявкам.</div>
        </div>
      </div>
    </ScreenLayout>
  );
}



function SafetyTipsScreen() {
  const tips = [
    "Никому не сообщайте CVC/CVV-код карты.",
    "Не передавайте PIN-код даже сотрудникам банка.",
    "Проверяйте адрес сайта и не переходите по подозрительным ссылкам.",
    "Подключайте уведомления о списаниях и переводах.",
    "Если заметили странную операцию — сразу блокируйте карту и пишите в поддержку.",
    "Не вводите данные карты в непроверенных приложениях и чатах.",
  ];

  return (
    <ScreenLayout title="Советы по безопасности">
      {tips.map((tip, index) => (
        <div key={index} style={menuCard}>
          <div style={menuCardTitle}>Совет {index + 1}</div>
          <div style={menuCardSubtitle}>{tip}</div>
        </div>
      ))}
    </ScreenLayout>
  );
}

function ApplicationScreen({ vkId }) {
  const productConfigs = {
    "Дебетовая карта": { subtitle: "Карта для ежедневных покупок, переводов и накоплений.", fields: [{ key: "fullName", label: "ФИО", placeholder: "Ваше имя и фамилия" }, { key: "phone", label: "Телефон", placeholder: "+79990000000" }, { key: "deliveryCity", label: "Город доставки", placeholder: "Москва" }] },
    "Кредитная карта": { subtitle: "Оформление кредитного лимита с проверкой дохода.", fields: [{ key: "fullName", label: "ФИО", placeholder: "Ваше имя и фамилия" }, { key: "phone", label: "Телефон", placeholder: "+79990000000" }, { key: "income", label: "Ежемесячный доход", placeholder: "120000" }, { key: "limit", label: "Желаемый лимит", placeholder: "300000" }] },
    "Вклад": { subtitle: "Откройте вклад с удобным сроком и суммой размещения.", fields: [{ key: "fullName", label: "ФИО", placeholder: "Ваше имя и фамилия" }, { key: "phone", label: "Телефон", placeholder: "+79990000000" }, { key: "amount", label: "Сумма вклада", placeholder: "500000" }, { key: "term", label: "Срок размещения", placeholder: "12 месяцев" }] },
    "Накопительный счет": { subtitle: "Гибкий счет для хранения средств с ежедневным доступом.", fields: [{ key: "fullName", label: "ФИО", placeholder: "Ваше имя и фамилия" }, { key: "phone", label: "Телефон", placeholder: "+79990000000" }, { key: "amount", label: "Планируемая сумма", placeholder: "150000" }] },
    "Кредит": { subtitle: "Запрос на потребительский кредит с предварительной оценкой условий.", fields: [{ key: "fullName", label: "ФИО", placeholder: "Ваше имя и фамилия" }, { key: "phone", label: "Телефон", placeholder: "+79990000000" }, { key: "income", label: "Ежемесячный доход", placeholder: "120000" }, { key: "amount", label: "Сумма кредита", placeholder: "700000" }, { key: "term", label: "Срок кредита", placeholder: "36 месяцев" }] },
  };
  const [productType, setProductType] = useState("Дебетовая карта");
  const [form, setForm] = useState({ fullName: "", phone: "", deliveryCity: "", income: "", limit: "", amount: "", term: "" });
  const [message, setMessage] = useState("");
  const config = productConfigs[productType] || productConfigs["Дебетовая карта"];
  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const sendApplication = async () => {
    const normalizedPhone = normalizeRussianPhone(form.phone);
    if (!form.fullName.trim() || !form.phone.trim()) return setMessage("Заполните ФИО и телефон");
    if (!normalizedPhone) return setMessage("Укажите номер в формате +7XXXXXXXXXX");
    const details = config.fields.map((field) => `${field.label}: ${form[field.key] || "не указано"}`).join("; ");
    try {
      const res = await apiFetch(`${API_BASE}/service-request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vk_id: String(vkId), request_type: productType, details }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setMessage(repairMojibake(data.error || "Заявка не отправлена"));
      setMessage("Заявка отправлена в банк");
    } catch (err) {
      console.error(err);
      setMessage("Сетевая ошибка");
    }
  };
  return (
    <ScreenLayout title="Новый продукт">
      <div style={paymentsShowcaseCard}><div style={paymentsShowcaseEyebrow}>Заявка на продукт</div><div style={paymentsShowcaseTitle}>{productType}</div><div style={paymentsShowcaseText}>{config.subtitle}</div></div>
      <div style={premiumTagRow}>{Object.keys(productConfigs).map((name) => <button key={name} type="button" style={{ ...compactButton, background: productType === name ? "#2d5f96" : compactButton.background, borderColor: productType === name ? "#5f9fe4" : compactButton.border }} onClick={() => setProductType(name)}>{name}</button>)}</div>
      <div style={menuCard}>{config.fields.map((field) => <div key={field.key}><div style={inputLabel}>{field.label}</div><input style={input} value={form[field.key] || ""} onChange={(e) => updateField(field.key, e.target.value)} placeholder={field.placeholder} /></div>)}{message ? <div style={messageBox}>{message}</div> : null}<button style={primaryButton} onClick={sendApplication}>Отправить заявку</button></div>
    </ScreenLayout>
  );
}


function ApplicationsListScreen({ vkId }) {
  const [applications, setApplications] = useState([]);
  useEffect(() => {
    apiFetch(`${API_BASE}/users/${vkId}/applications`).then((res) => res.json()).then((data) => setApplications(Array.isArray(data) ? data : [])).catch((err) => { console.error(err); setApplications([]); });
  }, [vkId]);
  const active = applications.filter((item) => !repairMojibake(item.status || "").toLowerCase().includes("одобрен") && !repairMojibake(item.status || "").toLowerCase().includes("отклон")).length;
  return (
    <ScreenLayout title="Мои заявки">
      <div style={premiumMetricsGrid}><div style={premiumMetricCard}><div style={premiumMetricLabel}>Всего заявок</div><div style={premiumMetricValue}>{applications.length}</div><div style={operationsSummaryMeta}>Все запросы на банковские продукты и услуги.</div></div><div style={premiumMetricCard}><div style={premiumMetricLabel}>В работе</div><div style={premiumMetricValue}>{active}</div><div style={operationsSummaryMeta}>Заявки, которые банк еще рассматривает.</div></div></div>
      <div style={menuCard}><div style={sectionHeader}><div><div style={screenSubtitle}>Статусы заявок</div><div style={sectionLead}>Следите за решениями по картам, счетам, вкладам и кредитным продуктам.</div></div></div>{applications.length === 0 ? <div style={emptyBlock}>Заявок пока нет</div> : <div style={operationsList}>{applications.map((item) => { const tone = applicationStatusTone(item.status); return <div key={item.id} style={applicationCard}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}><div style={{ minWidth: 0, flex: 1 }}><div style={menuCardTitle}>{repairMojibake(item.product_type || item.request_type || "Банковский продукт")}</div><div style={menuCardSubtitle}>{repairMojibake(item.details || "")}</div></div><div style={{ ...pill, ...tone }}>{repairMojibake(item.status || "На рассмотрении")}</div></div><div style={{ marginTop: 12, color: "#8ea8c6", fontSize: 13 }}>{repairMojibake(item.created_at || "")}</div></div>; })}</div>}</div>
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
    const requiredError = validateRequired(targetVkId, "VK ID получателя");
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
      setMessage("Не удалось проверить получателя");
      resetPreview();
    } finally {
      setPreviewLoading(false);
    }
  };

  const sendTransfer = async () => {
    const targetVkId = String(recipientVkId || "").trim();
    const requiredError = validateRequired(targetVkId, "VK ID получателя");
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

      setMessage(`Перевод выполнен: ${data.amount} ₽ → ${data.recipient?.full_name || targetVkId}`);
      setRecipientVkId("");
      setAmount("");
      setTemplateName("");
      clearTransferDraft();
      resetPreview();
      onTransferSuccess();
    } catch (error) {
      console.error(error);
      setMessage("Ошибка перевода");
    } finally {
      setTransferLoading(false);
    }
  };

  const saveFavorite = async () => {
    const targetVkId = String(recipientVkId || "").trim();
    const templateError = validateRequired(templateName, "Название шаблона");
    if (templateError) {
      setMessage(templateError);
      return;
    }
    const recipientError = validateRequired(targetVkId, "VK ID получателя");
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

      setMessage("Шаблон перевода по VK ID сохранён");
      setTemplateName("");
      onFavoriteSaved();
    } catch (error) {
      console.error(error);
      setMessage("Не удалось сохранить шаблон");
    }
  };

  return (
    <ScreenLayout title="Перевод по VK ID">
      <div style={transferShell}>
        <div style={paymentsShowcaseCard}>
          <div style={paymentsShowcaseEyebrow}>Переводы внутри VK Bank</div>
          <div style={paymentsShowcaseTitle}>Отправляйте деньги по VK ID без номера карты</div>
          <div style={paymentsShowcaseText}>Сначала проверяем получателя, показываем имя и счёт зачисления, затем проводим перевод в один шаг.</div>
          <div style={paymentsShowcaseChips}>
            <div style={paymentsShowcaseChip}>Быстрый перевод</div>
            <div style={paymentsShowcaseChip}>Проверка получателя</div>
            <div style={paymentsShowcaseChip}>Шаблоны для повторов</div>
          </div>
        </div>

        <div style={premiumSectionBlock}>
          <div style={screenSubtitle}>Новый перевод</div>
          <div style={sectionLead}>Введите VK ID получателя и сначала проверьте, кому уйдут деньги.</div>

          {vkTemplates.length > 0 ? (
            <>
              <div style={inputLabel}>Быстрый запуск из шаблонов</div>
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
                    <div style={premiumShortcutIcon}>★</div>
                    <div style={premiumShortcutTitle}>{repairMojibake(item.template_name)}</div>
                    <div style={premiumShortcutMeta}>VK ID: {item.recipient_value}</div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <div style={inputLabel}>VK ID получателя</div>
          <input
            style={input}
            value={recipientVkId}
            onChange={(e) => {
              setRecipientVkId(e.target.value.replace(/\s/g, ""));
              if (recipientPreview) resetPreview();
            }}
            placeholder="598896543"
          />

          <div style={inputLabel}>Счет списания</div>
          <select style={input} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
            {(accounts || []).map((acc) => (
              <option key={acc.id} value={acc.id}>
                {repairMojibake(acc.account_name)} · {formatMoney(acc.balance)} ₽
              </option>
            ))}
          </select>

          <div style={cardsActionRow}>
            <button style={compactButton} onClick={loadRecipientPreview} disabled={previewLoading}>
              {previewLoading ? "Проверяем..." : "Проверить получателя"}
            </button>
          </div>

          {recipientPreview && (
            <div style={transferPreviewCard}>
              <div style={premiumNoticeKicker}>Получатель найден</div>
              <div style={transferPreviewName}>{repairMojibake(recipientPreview.full_name)}</div>
              <div style={transferPreviewMeta}>VK ID: {recipientPreview.vk_id}</div>
              <div style={transferPreviewMeta}>Счёт зачисления: {repairMojibake(recipientPreview.account_name)}</div>
              {recipientPreview.phone_masked ? <div style={transferPreviewMeta}>Телефон: {recipientPreview.phone_masked}</div> : null}
            </div>
          )}

          <div style={inputLabel}>Сумма</div>
          <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" type="number" />

          <div style={{ ...inputLabel, marginTop: "10px" }}>Быстрые суммы</div>
          <div style={premiumTagRow}>
            {amountPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                style={{ ...compactButton, minHeight: "40px", padding: "10px 12px" }}
                onClick={() => setAmount(String(preset))}
              >
                {preset.toLocaleString("ru-RU")} ₽
              </button>
            ))}
          </div>

          <button style={primaryButton} onClick={sendTransfer} disabled={transferLoading}>
            {transferLoading ? "Отправляем..." : "Отправить перевод"}
          </button>
        </div>

        <div style={premiumSectionBlock}>
          <div style={screenSubtitle}>Сохранить как шаблон</div>
          <div style={sectionLead}>Полезно для частых переводов коллегам, близким и своим контактам в VK.</div>

          <div style={inputLabel}>Название шаблона</div>
          <input style={input} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Перевод коллеге" />

          <button style={secondaryButton} onClick={saveFavorite}>Сохранить в избранное</button>

          <div style={helperNote}>
            Переводы по номеру телефона лучше добавлять позже, когда в продукте появится обязательная и подтвержденная привязка номера.
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
      setMessage("Выберите разные счета");
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

      setMessage("Перевод между счетами выполнен");
      setAmount("");
      onSuccess();
    } catch (err) {
      console.error(err);
      setMessage("Ошибка перевода");
    }
  };

  return (
    <ScreenLayout title="Перевод между своими счетами">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>Внутренний перевод</div>
        <div style={paymentsShowcaseTitle}>Перемещайте деньги между своими счетами без комиссии</div>
        <div style={paymentsShowcaseText}>
          Основным остается самый первый счет, а новые счета можно использовать как накопительные или целевые.
        </div>
      </div>
      <div style={formCard}>
        {accounts.length < 2 ? (
          <div style={emptyBlock}>Для перевода между своими счетами нужно минимум 2 счета.</div>
        ) : (
          <>
            <div style={inputLabel}>Счет списания</div>
            <select style={input} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {repairMojibake(acc.account_name)}
                  {acc.is_primary ? " · Основной" : ""}
                  {" · "}
                  {Number(acc.balance).toLocaleString("ru-RU")} ₽
                </option>
              ))}
            </select>

            <div style={inputLabel}>Счет зачисления</div>
            <select style={input} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {repairMojibake(acc.account_name)}
                  {acc.is_primary ? " · Основной" : ""}
                  {" · "}
                  {Number(acc.balance).toLocaleString("ru-RU")} ₽
                </option>
              ))}
            </select>

            <div style={inputLabel}>Сумма</div>
            <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" type="number" />

            <button style={primaryButton} onClick={submitInternalTransfer}>
              Перевести
            </button>
          </>
        )}

        {primaryAccount ? (
          <div style={{ ...messageBox, marginTop: 16, marginBottom: 0 }}>
            Основной счет: {repairMojibake(primaryAccount.account_name)} · {formatMoney(primaryAccount.balance || 0)} ₽
          </div>
        ) : null}
        {message && <div style={resultMessage}>{message}</div>}
      </div>
    </ScreenLayout>
  );
}

function InterbankTransferScreen({ vkId, accounts, onSuccess }) {
  const [fromAccountId, setFromAccountId] = useState("");
  const [bank, setBank] = useState("Сбербанк");
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
    const vn = validateRequired(accountNumber, "Номер счёта получателя");
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

      setMessage("Межбанковский перевод выполнен");
      setAccountNumber("");
      setAmount("");
      onSuccess();
    } catch (err) {
      console.error(err);
      setMessage("Ошибка межбанковского перевода");
    }
  };

  return (
    <ScreenLayout title="Межбанковский перевод">
      <div style={formCard}>
        {accounts.length === 0 ? (
          <div style={emptyBlock}>Нет доступных счетов</div>
        ) : (
          <>
            <div style={inputLabel}>Счет списания</div>
            <select style={input} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {repairMojibake(acc.account_name)} В· {Number(acc.balance).toLocaleString("ru-RU")} ₽
                </option>
              ))}
            </select>

        <div style={inputLabel}>Банк получателя</div>
            <select style={input} value={bank} onChange={(e) => setBank(e.target.value)}>
              <option>Сбербанк</option>
              <option>Т-Банк</option>
              <option>ВТБ</option>
              <option>Альфа-Банк</option>
              <option>Газпромбанк</option>
              <option>Россельхозбанк</option>
            </select>

            <div style={inputLabel}>Номер счета получателя</div>
            <input style={input} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="40817810..." />

            <div style={inputLabel}>Сумма</div>
            <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="15000" type="number" />

            <button style={primaryButton} onClick={submitInterbankTransfer}>
              Отправить
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
    if (!accountName) return setMessage("Введите название счёта");
    try {
      const res = await apiFetch(`${API_BASE}/accounts/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vk_id: String(vkId), account_name: accountName, currency }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setMessage("Счёт не создан");
      setMessage("Счёт успешно открыт");
      onSuccess();
    } catch {
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Открыть счёт">
      <div style={paymentsShowcaseCard}><div style={paymentsShowcaseEyebrow}>Новый счёт</div><div style={paymentsShowcaseTitle}>Откройте дополнительный счёт</div></div>
      <div style={menuCard}>
        <div style={inputLabel}>Название счёта</div>
        <input style={input} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Накопительный счёт" />
        <div style={inputLabel}>Валюта</div>
        <select style={input} value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="RUB">RUB</option><option value="USD">USD</option><option value="EUR">EUR</option></select>
        {message ? <div style={messageBox}>{message}</div> : null}
        <button style={primaryButton} onClick={submitCreateAccount}>Открыть счёт</button>
      </div>
    </ScreenLayout>
  );
}


function TopUpScreen({ vkId }) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("С карты другого банка");
  const [message, setMessage] = useState("");
  const amountPresets = [1000, 5000, 10000, 25000];

  const submitTopUp = async () => {
    const amountError = validateAmount(amount);
    if (amountError) {
      setMessage(amountError);
      return;
    }
    if (!source) {
      setMessage("Выберите источник пополнения");
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vk_id: vkId, request_type: "Пополнение счета", details: `Источник: ${source}; Сумма: ${amount} ₽` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "Не удалось оформить пополнение"));
        return;
      }
      setMessage("Запрос на пополнение отправлен");
      setAmount("");
    } catch (err) {
      console.error(err);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Пополнить счет">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>Пополнение</div>
        <div style={paymentsShowcaseTitle}>Быстрое пополнение счета без визита в офис</div>
        <div style={paymentsShowcaseText}>Выберите источник средств, укажите сумму и отправьте запрос на пополнение прямо из мини-приложения.</div>
      </div>
      <div style={formCard}>
        <div style={inputLabel}>Источник пополнения</div>
        <select style={input} value={source} onChange={(e) => setSource(e.target.value)}>
          <option>С карты другого банка</option>
          <option>С наличных через офис</option>
          <option>Внутренний перевод</option>
          <option>С накопительного счета</option>
        </select>
        <div style={inputLabel}>Сумма</div>
        <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" type="number" />
        <div style={{ ...inputLabel, marginTop: "10px" }}>Быстрые суммы</div>
        <div style={premiumTagRow}>{amountPresets.map((preset) => <button key={preset} type="button" style={{ ...compactButton, minHeight: "40px", padding: "10px 12px" }} onClick={() => setAmount(String(preset))}>{preset.toLocaleString("ru-RU")} ₽</button>)}</div>
        <button style={primaryButton} onClick={submitTopUp}>Отправить запрос на пополнение</button>
        {message && <div style={resultMessage}>{repairMojibake(message)}</div>}
      </div>
    </ScreenLayout>
  );
}


function PayScreen({ vkId, onFavoriteSaved }) {
  const [serviceType, setServiceType] = useState("Мобильная связь");
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [message, setMessage] = useState("");
  const amountPresets = [300, 700, 1500, 3000];

  const submitPayment = async () => {
    const amountError = validateAmount(amount);
    if (amountError) return setMessage(amountError);
    if (!serviceType || !provider.trim()) return setMessage("Укажите категорию и получателя");
    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vk_id: vkId, request_type: "Оплата услуг", details: `Категория: ${serviceType}; Получатель: ${provider}; Сумма: ${amount} ₽` }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setMessage(repairMojibake(data.error || "Не удалось провести платеж"));
      setMessage("Платеж отправлен на обработку");
      setProvider("");
      setAmount("");
    } catch (err) {
      console.error(err);
      setMessage("Сетевая ошибка");
    }
  };

  const saveFavorite = async () => {
    if (!templateName.trim() || !provider.trim()) return setMessage("Укажите название шаблона и получателя");
    try {
      const res = await apiFetch(`${API_BASE}/favorites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vk_id: vkId, template_name: templateName, payment_type: "service_payment", recipient_value: provider, provider_name: provider }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setMessage(repairMojibake(data.error || "Не удалось сохранить шаблон"));
      setMessage("Шаблон сохранен");
      setTemplateName("");
      onFavoriteSaved();
    } catch (err) {
      console.error(err);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Оплата услуг">
      <div style={paymentsShowcaseCard}><div style={paymentsShowcaseEyebrow}>Платежи</div><div style={paymentsShowcaseTitle}>Оплачивайте услуги, связь и подписки из одного раздела</div><div style={paymentsShowcaseText}>Создавайте быстрые сервисные платежи и сохраняйте шаблоны для регулярных оплат.</div></div>
      <div style={formCard}>
        <div style={inputLabel}>Категория</div>
        <select style={input} value={serviceType} onChange={(e) => setServiceType(e.target.value)}><option>Мобильная связь</option><option>Интернет</option><option>ЖКХ</option><option>Подписки</option><option>Образование</option><option>Штрафы</option></select>

        <div style={inputLabel}>Поставщик или номер</div>
        <input style={input} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Например: МТС / Ростелеком / лицевой счет" />
        <div style={inputLabel}>Сумма</div>
        <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1200" type="number" />
        <div style={{ ...inputLabel, marginTop: "10px" }}>Быстрые суммы</div>
        <div style={premiumTagRow}>{amountPresets.map((preset) => <button key={preset} type="button" style={{ ...compactButton, minHeight: "40px", padding: "10px 12px" }} onClick={() => setAmount(String(preset))}>{preset.toLocaleString("ru-RU")} ₽</button>)}</div>
        <button style={primaryButton} onClick={submitPayment}>Отправить платеж</button>
        <div style={inputLabel}>Название шаблона</div>
        <input style={input} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Например: Домашний интернет" />
        <button style={secondaryButton} onClick={saveFavorite}>Сохранить в избранное</button>
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
    String(repairMojibake(mainCard?.status || "")).toLowerCase().includes("?"),
  );

  useEffect(() => {
    setMainCardBlocked(String(repairMojibake(mainCard?.status || "")).toLowerCase().includes("?"));
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
        body: JSON.stringify({ vk_id: vkId, request_type: type, details }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "? ? ? ?"));
        return;
      }
      setMessage("? ?");
      onRefresh();
    } catch (err) {
      console.error(err);
      setMessage("? ? ?");
    }
  };

  const blockMainCard = async () => {
    if (!mainCard) {
      setMessage("? ? ? ?");
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/cards/${mainCard.id}/block`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "? ? ? ?"));
        return;
      }
      setMainCardBlocked(true);
      setMessage("? ?");
      onActionDone();
      loadSecurity();
    } catch (err) {
      console.error(err);
      setMessage("? ? ?");
    }
  };

  const requestMainCardUnblock = async () => {
    if (!mainCard) {
      setMessage("? ? ? ?");
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/cards/${mainCard.id}/request-unblock`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "? ? ? ? ? ?"));
        return;
      }
      setMainCardBlocked(true);
      setMessage("? ? ? ?");
      onActionDone();
    } catch (err) {
      console.error(err);
      setMessage("? ? ?");
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
      setMessage("? PIN ? ? ? ?");
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/users/${vkId}/pin/change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_pin: currentPin, new_pin: newPin, new_pin_confirm: newPinConfirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "Не удалось изменить PIN"));
        return;
      }
      setCurrentPin("");
      setNewPin("");
      setNewPinConfirm("");
      setMessage("PIN успешно изменен");
      onRefresh();
      loadSecurity();
    } catch (err) {
      console.error(err);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Безопасность">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>PIN-код</div>
          <div style={premiumMetricValue}>{securityData?.pin_set || userData?.pin_set ? "Установлен" : "Не установлен"}</div>
          <div style={operationsSummaryMeta}>Используется для входа и подтверждения важных действий.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Уведомления</div>
          <div style={premiumMetricValue}>{securityData?.notifications_enabled ? "Включены" : "Выключены"}</div>
          <div style={operationsSummaryMeta}>Операции и важные события по вашему профилю.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Номер телефона</div>
          <div style={premiumMetricValue}>{securityData?.phone_masked || "Не указан"}</div>
          <div style={operationsSummaryMeta}>Телефон для связи и поддержки.</div>
        </div>
      </div>

      <div style={menuCard}>
        <div style={screenSubtitle}>Сменить PIN</div>
        <div style={sectionLead}>Укажите текущий PIN и задайте новый код для входа и подтверждения действий.</div>
        <div style={inputLabel}>Текущий PIN</div>
        <input style={input} type="password" inputMode="numeric" value={currentPin} onChange={(e) => setCurrentPin(sanitizeDigitsOnly(e.target.value))} placeholder="Текущий PIN" />
        <div style={inputLabel}>Новый PIN</div>
        <input style={input} type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(sanitizeDigitsOnly(e.target.value))} placeholder="Новый PIN" />
        <div style={inputLabel}>Подтверждение нового PIN</div>
        <input style={input} type="password" inputMode="numeric" value={newPinConfirm} onChange={(e) => setNewPinConfirm(sanitizeDigitsOnly(e.target.value))} placeholder="Повторите новый PIN" />
        <button style={primaryButton} onClick={changePin}>Изменить PIN</button>
      </div>

      <div style={premiumPanelGrid}>
        <MenuCard
          title={mainCardBlocked ? "Разблокировать карту" : "Заблокировать карту"}
          subtitle={mainCard ? repairMojibake(mainCard.card_number_mask) : "Карта не найдена"}
          onClick={mainCardBlocked ? requestMainCardUnblock : blockMainCard}
        />
        <MenuCard
          title="Подозрительная операция"
          subtitle="Сообщить о подозрительной активности"
          onClick={() => createSecurityRequest("Подозрительная операция", "Пользователь сообщил о подозрительной активности")}
        />
        <MenuCard
          title="Советы по безопасности"
          subtitle="Рекомендации по защите аккаунта"
          onClick={() => setActiveTab("safetyTips")}
        />
        <MenuCard
          title="Профиль"
          subtitle="Контакты, телефон и данные профиля"
          onClick={() => setActiveTab("profile")}
        />
      </div>

      <div style={menuCard}>
        <div style={screenSubtitle}>История входов и устройств</div>
        <div style={sectionLead}>Последние входы в VK Mini App и действия с PIN.</div>
        {!securityData?.login_history?.length ? (
          <div style={emptyBlock}>История входов пока пуста.</div>
        ) : (
          <div style={operationsList}>
            {securityData.login_history.map((item) => (
              <div key={item.id} style={premiumOperationRow}>
                <div style={operationIcon}>?</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={premiumOperationTitle}>{repairMojibake(item.device_name || "VK Mini App")}</div>
                  <div style={operationMeta}>
                    {repairMojibake(item.platform || "Неизвестно")} · {repairMojibake(item.source || "Вход")} · {repairMojibake(item.created_at || "")}
                  </div>
                </div>
                <div style={premiumShortcutMeta}>{repairMojibake(item.ip_address || "IP не указан")}</div>
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
    <ScreenLayout title="Позвонить в банк">
      <div style={formCard}>
        <div style={menuCardTitle}>Контактный центр</div>
        <div style={menuCardSubtitle}>+7 (800) 555-35-35</div>
        <div style={{ marginTop: "12px", color: "#aab9cc", lineHeight: "1.5" }}>
          Этот номер можно использовать для консультации, блокировки карты и решения спорных операций.
        </div>

        <a href="tel:+78005553535" style={linkButton}>
          Позвонить
        </a>
      </div>
    </ScreenLayout>
  );
}

function FaqScreen() {
  return (
    <ScreenLayout title="Частые вопросы">
      <MenuCard title="💳 Как заблокировать карту?" subtitle="Перейдите в раздел Безопасность" />
      <MenuCard title="💸 Как сделать перевод?" subtitle="Откройте Платежи → Перевод по VK ID" />
      <MenuCard title="📄 Как подать заявку?" subtitle="Главная → Заявка или Еще → Подать заявку" />
      <MenuCard title="💬 Как связаться с поддержкой?" subtitle="Откройте Онлайн-чат или Позвонить в банк" />
    </ScreenLayout>
  );
}

function ProblemReportScreen({ vkId }) {
  const [problemText, setProblemText] = useState("");
  const [message, setMessage] = useState("");
  const submitProblem = async () => {
    if (!problemText.trim()) return setMessage("Опишите проблему");
    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vk_id: vkId, request_type: "Сообщить о проблеме", details: problemText }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setMessage(repairMojibake(data.error || "Не удалось отправить обращение"));
      setMessage("Сообщение о проблеме отправлено");
      setProblemText("");
    } catch (err) {
      console.error(err);
      setMessage("Сетевая ошибка");
    }
  };
  return (
    <ScreenLayout title="Сообщить о проблеме">
      <div style={paymentsShowcaseCard}><div style={paymentsShowcaseEyebrow}>Сервис</div><div style={paymentsShowcaseTitle}>Расскажите о проблеме, и банк возьмет ее в работу</div><div style={paymentsShowcaseText}>Опишите ситуацию как можно подробнее: что произошло, где возникла ошибка и что вы ожидали увидеть.</div></div>
      <div style={formCard}><div style={inputLabel}>Описание проблемы</div><textarea style={textarea} value={problemText} onChange={(e) => setProblemText(e.target.value)} placeholder="Например: не проходит перевод, не открывается карта, ошибка при оплате" /><button style={primaryButton} onClick={submitProblem}>Отправить запрос</button>{message && <div style={resultMessage}>{repairMojibake(message)}</div>}</div>
    </ScreenLayout>
  );
}


function ServiceRequestsScreen({ vkId }) {
  const [requests, setRequests] = useState([]);
  useEffect(() => {
    apiFetch(`${API_BASE}/users/${vkId}/service-requests`).then((res) => res.json()).then((data) => setRequests(Array.isArray(data) ? data : [])).catch((err) => console.error("Ошибка загрузки сервисных запросов:", err));
  }, [vkId]);
  const openRequests = requests.filter((item) => !repairMojibake(item.status || "").toLowerCase().includes("выполн")).length;
  return (
    <ScreenLayout title="Сервисные запросы">
      <div style={premiumMetricsGrid}><div style={premiumMetricCard}><div style={premiumMetricLabel}>Всего запросов</div><div style={premiumMetricValue}>{requests.length}</div><div style={operationsSummaryMeta}>Здесь собраны обращения по сервисам, платежам и проблемам.</div></div><div style={premiumMetricCard}><div style={premiumMetricLabel}>Активные</div><div style={premiumMetricValue}>{openRequests}</div><div style={operationsSummaryMeta}>Запросы, по которым банк еще не закрыл обработку.</div></div></div>
      {requests.length === 0 ? <div style={emptyBlock}>Сервисных запросов пока нет</div> : <div style={{ display: "grid", gap: "14px" }}>{requests.map((item) => { const tone = serviceRequestStatusTone(item.status); return <div key={item.id} style={applicationCard}><div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 700, color: "#eef5ff", marginBottom: "8px" }}>{repairMojibake(item.request_type || "Сервисный запрос")}</div><div style={{ color: "#9fb3c8", lineHeight: 1.6 }}>{repairMojibake(item.details || "")}</div></div><div style={{ ...pill, ...tone }}>{repairMojibake(item.status || "На рассмотрении")}</div></div><div style={{ marginTop: "12px", fontSize: "13px", color: "#8da8c4" }}>{repairMojibake(item.created_at || "")}</div></div>; })}</div>}
    </ScreenLayout>
  );
}

function ChatScreenSafe({ vkId }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const quickTopics = [
    "Как пополнить баланс?",
    "Как перевести по VK ID?",
    "Как изменить PIN-код?",
    "Нужно разблокировать карту",
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
        setMessage(repairMojibake(data.error || "Не удалось отправить сообщение"));
        return;
      }
      setText("");
      setMessage(
        data.service_request
          ? `Диалог передан оператору: ${repairMojibake(data.service_request.request_type || "обращение")}`
          : ""
      );
      await loadMessages();
    } catch (error) {
      console.error(error);
      setMessage("Сетевая ошибка");
    }
  };

  const clearChat = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/support/messages/${vkId}/clear`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "Не удалось очистить чат"));
        return;
      }
      setMessages([]);
      setMessage("Чат очищен");
    } catch (error) {
      console.error(error);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Чат поддержки">
      <div style={menuCard}>
        <div style={sectionHeader}>
          <div>
            <div style={screenSubtitle}>Быстрые темы</div>
            <div style={sectionLead}>Выберите готовый вопрос или напишите свой.</div>
          </div>
          <button style={miniButton} onClick={clearChat}>Очистить чат</button>
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
        <div style={screenSubtitle}>Диалог</div>
        <div style={sectionLead}>История сообщений с AI-помощником и операторами банка.</div>
        {messages.length === 0 ? (
          <div style={emptyBlock}>Чат пока пуст. Начните диалог первым.</div>
        ) : (
          <div style={operationsList}>
            {messages.map((item) => {
              const senderLabel =
                repairMojibake(item.sender_label || "") ||
                (item.sender_type === "user"
                  ? "Вы"
                  : item.sender_type === "operator"
                    ? "Оператор"
                    : "AI-помощник");

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
        <div style={screenSubtitle}>Новое сообщение</div>
        <div style={sectionLead}>Опишите проблему или задайте вопрос по переводам, картам и продуктам.</div>
        <textarea
          style={{ ...textarea, minHeight: 140 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Например: не проходит перевод по VK ID"
        />
        {message ? <div style={messageBox}>{message}</div> : null}
        <button style={primaryButton} onClick={sendMessage}>Отправить сообщение</button>
      </div>
    </ScreenLayout>
  );
}

function ApplicationScreenSafe({ vkId }) {
  const productConfigs = {
    "Дебетовая карта": {
      subtitle: "Карта для ежедневных покупок, переводов и онлайн-оплаты.",
      fields: [
        { key: "fullName", label: "Имя и фамилия", placeholder: "Ваше имя и фамилия" },
        { key: "phone", label: "Телефон", placeholder: "+79990000000" },
        { key: "deliveryCity", label: "Город доставки", placeholder: "Калининград" },
      ],
    },
    "Кредитная карта": {
      subtitle: "Карта с кредитным лимитом и базовой оценкой дохода.",
      fields: [
        { key: "fullName", label: "Имя и фамилия", placeholder: "Ваше имя и фамилия" },
        { key: "phone", label: "Телефон", placeholder: "+79990000000" },
        { key: "income", label: "Ежемесячный доход", placeholder: "120000" },
        { key: "limit", label: "Желаемый лимит", placeholder: "300000" },
      ],
    },
    "Вклад": {
      subtitle: "Оформление вклада с выбором суммы и срока.",
      fields: [
        { key: "fullName", label: "Имя и фамилия", placeholder: "Ваше имя и фамилия" },
        { key: "phone", label: "Телефон", placeholder: "+79990000000" },
        { key: "amount", label: "Сумма вклада", placeholder: "500000" },
        { key: "term", label: "Срок", placeholder: "12 месяцев" },
      ],
    },
    "Накопительный счет": {
      subtitle: "Дополнительный счет для хранения и накопления средств.",
      fields: [
        { key: "fullName", label: "Имя и фамилия", placeholder: "Ваше имя и фамилия" },
        { key: "phone", label: "Телефон", placeholder: "+79990000000" },
        { key: "amount", label: "Планируемая сумма", placeholder: "150000" },
      ],
    },
    "Кредит": {
      subtitle: "Подача заявки на кредит с базовой оценкой параметров.",
      fields: [
        { key: "fullName", label: "Имя и фамилия", placeholder: "Ваше имя и фамилия" },
        { key: "phone", label: "Телефон", placeholder: "+79990000000" },
        { key: "income", label: "Ежемесячный доход", placeholder: "120000" },
        { key: "amount", label: "Сумма кредита", placeholder: "700000" },
        { key: "term", label: "Срок кредита", placeholder: "36 месяцев" },
      ],
    },
  };

  const [productType, setProductType] = useState("Дебетовая карта");
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
      setMessage("Заполните имя и телефон");
      return;
    }
    if (!isValidRussianPhone(normalizedPhone)) {
      setMessage("Укажите телефон в формате +7XXXXXXXXXX");
      return;
    }

    const details = config.fields
      .map((field) => `${field.label}: ${form[field.key] || "не указано"}`)
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
        setMessage(repairMojibake(data.error || "Не удалось отправить заявку"));
        return;
      }
      setMessage("Заявка отправлена в банк");
    } catch (error) {
      console.error(error);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Новый продукт">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>Заявка</div>
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
        <button style={primaryButton} onClick={sendApplication}>Отправить заявку</button>
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
    return !status.includes("одобрен") && !status.includes("отклон");
  }).length;

  return (
    <ScreenLayout title="Мои заявки">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Всего заявок</div>
          <div style={premiumMetricValue}>{applications.length}</div>
          <div style={operationsSummaryMeta}>Все запросы на банковские продукты и услуги.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>В работе</div>
          <div style={premiumMetricValue}>{activeCount}</div>
          <div style={operationsSummaryMeta}>Заявки, по которым банк еще принимает решение.</div>
        </div>
      </div>

      <div style={menuCard}>
        <div style={screenSubtitle}>Статусы заявок</div>
        <div style={sectionLead}>Здесь собраны ваши заявки на продукты и сервисы банка.</div>
        {applications.length === 0 ? (
          <div style={emptyBlock}>Заявок пока нет</div>
        ) : (
          <div style={operationsList}>
            {applications.map((item) => {
              const tone = applicationStatusTone(item.status);
              return (
                <div key={item.id} style={applicationCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={menuCardTitle}>
                        {repairMojibake(item.product_type || "Банковский продукт")}
                      </div>
                      <div style={menuCardSubtitle}>{repairMojibake(item.details || "")}</div>
                    </div>
                    <div style={{ ...pill, ...tone }}>
                      {repairMojibake(item.status || "На рассмотрении")}
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
  const [source, setSource] = useState("С карты другого банка");
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
        setMessage(repairMojibake(data.error || "Не удалось оформить пополнение"));
        return;
      }
      setMessage("Счет пополнен");
      setAmount("");
      onSuccess?.();
    } catch (error) {
      console.error(error);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Пополнить счет">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>Пополнение</div>
        <div style={paymentsShowcaseTitle}>Быстрое пополнение счета</div>
        <div style={paymentsShowcaseText}>Выберите источник средств и сумму пополнения.</div>
      </div>
      <div style={formCard}>
        <div style={inputLabel}>Счет зачисления</div>
        <select style={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {(accounts || []).map((acc) => (
            <option key={acc.id} value={acc.id}>
              {repairMojibake(acc.account_name)} · {formatMoney(acc.balance)} ₽
            </option>
          ))}
        </select>
        <div style={inputLabel}>Источник пополнения</div>
        <select style={input} value={source} onChange={(e) => setSource(e.target.value)}>
          <option>С карты другого банка</option>
          <option>Наличными через офис</option>
          <option>Внутренний перевод</option>
          <option>С накопительного счета</option>
        </select>
        <div style={inputLabel}>Сумма</div>
        <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" type="number" />
        <div style={{ ...inputLabel, marginTop: "10px" }}>Быстрые суммы</div>
        <div style={premiumTagRow}>
          {amountPresets.map((preset) => (
            <button key={preset} type="button" style={{ ...compactButton, minHeight: "40px", padding: "10px 12px" }} onClick={() => setAmount(String(preset))}>
              {preset.toLocaleString("ru-RU")} ₽
            </button>
          ))}
        </div>
        {message ? <div style={messageBox}>{message}</div> : null}
        <button style={primaryButton} onClick={submitTopUp}>Пополнить счет</button>
      </div>
    </ScreenLayout>
  );
}

function PayScreenSafe({ vkId, accounts, onSuccess, onFavoriteSaved }) {
  const [fromAccountId, setFromAccountId] = useState("");
  const [serviceType, setServiceType] = useState("Мобильная связь");
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
      setMessage("Укажите поставщика или номер");
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
        setMessage(repairMojibake(data.error || "Не удалось отправить платеж"));
        return;
      }
      setMessage("Платеж выполнен");
      setAmount("");
      setProvider("");
      onSuccess?.();
    } catch (error) {
      console.error(error);
      setMessage("Сетевая ошибка");
    }
  };

  const saveFavorite = async () => {
    if (!templateName.trim() || !provider.trim()) {
      setMessage("Укажите название шаблона и поставщика");
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
        setMessage(repairMojibake(data.error || "Не удалось сохранить шаблон"));
        return;
      }
      setMessage("Шаблон сохранен");
      setTemplateName("");
      onFavoriteSaved();
    } catch (error) {
      console.error(error);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Оплата услуг">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>Платежи</div>
        <div style={paymentsShowcaseTitle}>Оплачивайте услуги из мини-приложения</div>
        <div style={paymentsShowcaseText}>Подготовьте платеж и сохраните шаблон для повторов.</div>
      </div>
      <div style={formCard}>
        <div style={inputLabel}>Счет списания</div>
        <select style={input} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
          {(accounts || []).map((acc) => (
            <option key={acc.id} value={acc.id}>
              {repairMojibake(acc.account_name)} · {formatMoney(acc.balance)} ₽
            </option>
          ))}
        </select>
        <div style={inputLabel}>Категория</div>
        <select style={input} value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
          <option>Мобильная связь</option>
          <option>Интернет</option>
          <option>ЖКХ</option>
          <option>Подписки</option>
          <option>Образование</option>
          <option>Штрафы</option>
        </select>
        <div style={inputLabel}>Поставщик или номер</div>
        <input style={input} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Например: МТС или номер договора" />
        <div style={inputLabel}>Сумма</div>
        <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1200" type="number" />
        <div style={inputLabel}>Название шаблона</div>
        <input style={input} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Например: Домашний интернет" />
        {message ? <div style={messageBox}>{message}</div> : null}
        <div style={detailActionBar}>
          <button style={primaryButton} onClick={submitPayment}>Отправить платеж</button>
          <button style={secondaryButton} onClick={saveFavorite}>Сохранить шаблон</button>
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
      setMessage("Опишите проблему");
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          request_type: "Сообщить о проблеме",
          details: problemText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessage(repairMojibake(data.error || "Не удалось отправить обращение"));
        return;
      }
      setMessage("Сообщение о проблеме отправлено");
      setProblemText("");
    } catch (error) {
      console.error(error);
      setMessage("Сетевая ошибка");
    }
  };

  return (
    <ScreenLayout title="Сообщить о проблеме">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>Сервис</div>
        <div style={paymentsShowcaseTitle}>Расскажите о проблеме, и банк возьмет ее в работу</div>
        <div style={paymentsShowcaseText}>Опишите, что именно произошло и какой результат вы ожидали.</div>
      </div>
      <div style={formCard}>
        <div style={inputLabel}>Описание проблемы</div>
        <textarea
          style={textarea}
          value={problemText}
          onChange={(e) => setProblemText(e.target.value)}
          placeholder="Например: не проходит перевод или не открывается карта"
        />
        {message ? <div style={messageBox}>{message}</div> : null}
        <button style={primaryButton} onClick={submitProblem}>Отправить запрос</button>
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
    (item) => !repairMojibake(item.status || "").toLowerCase().includes("выполн")
  ).length;

  return (
    <ScreenLayout title="Сервисные запросы">
      <div style={premiumMetricsGrid}>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Всего запросов</div>
          <div style={premiumMetricValue}>{requests.length}</div>
          <div style={operationsSummaryMeta}>Обращения по сервисам, оплатам и спорным ситуациям.</div>
        </div>
        <div style={premiumMetricCard}>
          <div style={premiumMetricLabel}>Активные</div>
          <div style={premiumMetricValue}>{activeCount}</div>
          <div style={operationsSummaryMeta}>Запросы, которые банк еще не закрыл.</div>
        </div>
      </div>

      {requests.length === 0 ? (
        <div style={emptyBlock}>Сервисных запросов пока нет</div>
      ) : (
        <div style={{ display: "grid", gap: "14px" }}>
          {requests.map((item) => {
            const tone = serviceRequestStatusTone(item.status);
            return (
              <div key={item.id} style={applicationCard}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "#eef5ff", marginBottom: "8px" }}>
                      {repairMojibake(item.request_type || "Сервисный запрос")}
                    </div>
                    <div style={{ color: "#9fb3c8", lineHeight: 1.6 }}>
                      {repairMojibake(item.details || "")}
                    </div>
                  </div>
                  <div style={{ ...pill, ...tone }}>
                    {repairMojibake(item.status || "На рассмотрении")}
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
