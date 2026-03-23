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

  const knownFixes = [
    ["РџРµСЂРµРІРѕРґ РїРѕ VK ID РєР»РёРµРЅС‚Сѓ", "Перевод по VK ID клиенту"],
    ["РџРµСЂРµРІРѕРґ РїРѕ VK ID РѕС‚", "Перевод по VK ID от"],
    ["РћС‚РїСЂР°РІРёС‚РµР»СЊ", "Отправитель"],
    ["РџРѕР»СѓС‡Р°С‚РµР»СЊ", "Получатель"],
    ["Р—Р°Р±Р»РѕРєРёСЂРѕРІР°РЅР°", "Заблокирована"],
    ["РђРєС‚РёРІРЅР°", "Активна"],
  ];

  let normalized = value;
  for (const [broken, fixed] of knownFixes) {
    normalized = normalized.split(broken).join(fixed);
  }

  const score = (input) => {
    const cyrillic = (input.match(/[А-Яа-яЁё]/g) || []).length;
    const broken = (input.match(/[ÐÑЏђѓљњќўЂЃЉЊЌ]/g) || []).length;
    return cyrillic - broken * 3;
  };

  const tryDecode = (input) => {
    try {
      return decodeURIComponent(escape(input));
    } catch {
      return input;
    }
  };

  let best = normalized;
  for (let i = 0; i < 2; i += 1) {
    const candidate = tryDecode(best);
    if (score(candidate) > score(best)) {
      best = candidate;
    }
  }

  return best;
}

function App() {
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
    <div className="app-shell" style={page}>
      {activeTab === "home" && (
        <HomeScreen
          userData={userData}
          accounts={accounts}
          cards={cards}
          operations={operations}
          analytics={analytics}
          notifications={notifications}
          setActiveTab={setActiveTab}
          onToggleBalance={() => setActiveTab("settings")}
        />
      )}

      {activeTab === "payments" && (
        <PaymentsScreen setActiveTab={setActiveTab} favorites={favorites} />
      )}

      {activeTab === "chat" && (
        <ChatScreen vkId={vkId} />
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
        <OperationsScreen vkId={vkId} accounts={accounts} />
      )}

      {activeTab === "analytics" && (
        <AnalyticsScreen analytics={analytics} />
      )}

      {activeTab === "support" && (
        <SupportScreen setActiveTab={setActiveTab} />
      )}

      {activeTab === "safetyTips" && <SafetyTipsScreen />}

      {activeTab === "application" && (
        <ApplicationScreen vkId={vkId} />
      )}

      {activeTab === "applications" && (
        <ApplicationsListScreen vkId={vkId} />
      )}

      {activeTab === "transfer" && (
        <TransferScreen
          senderVkId={vkId}
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
        <TopUpScreen vkId={vkId} />
      )}

      {activeTab === "pay" && (
        <PayScreen
          vkId={vkId}
          onFavoriteSaved={() => setRefreshKey((prev) => prev + 1)}
        />
      )}

      {activeTab === "security" && (
        <SecurityScreen
          vkId={vkId}
          cards={cards}
          onActionDone={() => setRefreshKey((prev) => prev + 1)}
          setActiveTab={setActiveTab}
        />
      )}

      {activeTab === "serviceRequests" && (
        <ServiceRequestsScreen vkId={vkId} />
      )}

      {activeTab === "faq" && <FaqScreen />}
      {activeTab === "callBank" && <CallBankScreen />}
      {activeTab === "problemReport" && (
        <ProblemReportScreen vkId={vkId} />
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
        <FavoritesScreen favorites={favorites} />
      )}

      {activeTab === "profile" && (
        <ProfileScreen userData={userData} />
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

      <div style={bottomNav}>
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
}) {
  const mainCard = cards[0];
  const mainAccount = accounts[0];
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
          Завершите настройку профиля, чтобы открыть весь банковский функционал
        </div>
      )}

      <div style={topBadge}>ZF BANK PREMIER</div>

      <div style={header}>
        <div style={headerIdentity}>
          <div style={avatar}>{userData.full_name ? userData.full_name[0].toUpperCase() : "U"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={headerEyebrow}>Главный экран</div>
            <div style={userName}>{repairMojibake(userData.full_name)}</div>
            <div style={userTag}>Банк во ВКонтакте</div>
          </div>
        </div>
        <div style={headerActionsWrap}>
          <div style={headerAction} onClick={() => setActiveTab("settings")}>⚙</div>
          <div style={headerAction} onClick={() => setActiveTab("notifications")}>
            🔔
            {unreadCount > 0 && <div style={badgeDot}>{unreadCount}</div>}
          </div>
        </div>
      </div>

      <div style={search} onClick={() => setActiveTab("more")}>Поиск переводов, карт, заявок и сервисов</div>

      <div style={premiumHomeLayout}>
        <div style={premiumHeroCard}>
          <div style={premiumHeroGlow} />
          <div style={premiumHeroTop}>
            <div>
              <div style={premiumKicker}>Доступно на всех счетах</div>
              <div style={premiumBalance}>{visibleBalance}</div>
              <div style={premiumHeroSub}>Основной счёт: {mainAccount?.account_name || "Ещё не открыт"}</div>
            </div>
            <div style={premiumHeroBadge}>{accounts.length} {accounts.length === 1 ? "счёт" : accounts.length < 5 ? "счёта" : "счетов"}</div>
          </div>

          <div style={premiumHeroMetrics}>
            <div style={premiumMetricCard}><div style={premiumMetricLabel}>Расходы за месяц</div><div style={premiumMetricValue}>{formatMoney(totalExpenses)} ₽</div></div>
            <div style={premiumMetricCard}><div style={premiumMetricLabel}>Поступления</div><div style={premiumMetricValue}>{formatMoney(incomeThisMonth)} ₽</div></div>
            <div style={premiumMetricCard}><div style={premiumMetricLabel}>Активная карта</div><div style={premiumMetricValue}>{mainCard?.card_number_mask || "Без карты"}</div></div>
          </div>

          <div style={premiumActionStrip}>
            <div style={premiumActionPill} onClick={() => setActiveTab("transfer")}><span style={premiumActionIcon}>→</span><div><div style={premiumActionTitle}>Перевод по VK ID</div><div style={premiumActionMeta}>Основной сценарий банка</div></div></div>
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
            <div style={emptyBlock}>У вас пока нет операций. Первая активность появится сразу после перевода или оплаты.</div>
          ) : (
            <div style={premiumOperationsList}>
              {latestOperations.map((item) => (
                <div key={item.id} style={premiumOperationRow} onClick={() => setActiveTab("operations")}>
                  <div style={premiumOperationIcon}>{item.operation_type === "income" ? "↓" : "↑"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={premiumOperationTitle}>{repairMojibake(item.title)}</div>
                    <div style={premiumOperationMeta}>{categoryLabelRu(item.category)} · {formatOperationDate(item.created_at)}</div>
                  </div>
                  <div style={item.operation_type === "income" ? premiumIncomeAmount : premiumExpenseAmount}>{item.operation_type === "income" ? "+" : "−"}{formatMoney(item.amount)} ₽</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={premiumHighlightsGrid}>
          <div style={premiumInfoCard}>
            <div style={premiumInfoLabel}>На что уходят деньги</div>
            {primaryCategory.length === 0 ? <div style={premiumInfoValue}>Категории появятся после первых расходов</div> : <div style={premiumTagRow}>{primaryCategory.map((item) => <div key={item.key} style={premiumTag}>{categoryLabelRu(item.key)} · {formatMoney(item.value)} ₽</div>)}</div>}
          </div>
          <div style={premiumInfoCard}>
            <div style={premiumInfoLabel}>Расходы и поступления</div>
            <div style={premiumDualStat}>
              <div><div style={premiumDualLabel}>Поступления</div><div style={premiumIncomeAmount}>+{formatMoney(incomeThisMonth)} ₽</div></div>
              <div><div style={premiumDualLabel}>Расходы</div><div style={premiumExpenseAmount}>−{formatMoney(expenseThisMonth)} ₽</div></div>
            </div>
          </div>
        </div>

        <div style={premiumAsideCard}>
          <div style={screenSubtitle}>Быстрые сценарии</div>
          <div style={premiumShortcutGrid}>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("pay")}><div style={premiumShortcutIcon}>₽</div><div style={premiumShortcutTitle}>Оплата услуг</div><div style={premiumShortcutMeta}>Связь, коммунальные услуги, сервисы</div></div>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("favorites")}><div style={premiumShortcutIcon}>★</div><div style={premiumShortcutTitle}>Избранное</div><div style={premiumShortcutMeta}>Шаблоны и частые переводы</div></div>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("application")}><div style={premiumShortcutIcon}>+</div><div style={premiumShortcutTitle}>Заявка</div><div style={premiumShortcutMeta}>Открыть новый продукт</div></div>
            <div style={premiumShortcutCard} onClick={() => setActiveTab("support")}><div style={premiumShortcutIcon}>?</div><div style={premiumShortcutTitle}>Поддержка</div><div style={premiumShortcutMeta}>Чат и сервисные запросы</div></div>
          </div>
        </div>

        {latestNotification ? <div style={premiumNoticeCard} onClick={() => setActiveTab("notifications")}><div style={premiumNoticeKicker}>Последнее уведомление</div><div style={premiumNoticeTitle}>{repairMojibake(latestNotification.title)}</div><div style={premiumNoticeText}>{repairMojibake(latestNotification.message)}</div></div> : null}
        <div style={premiumBannerCard} onClick={() => setActiveTab("application")}><div><div style={premiumBannerTitle}>Новый продукт в один тап</div><div style={premiumBannerText}>Оформите карту или откройте счёт прямо из мини-приложения.</div></div><div style={premiumBannerIcon}>→</div></div>
      </div>
    </>
  );
}
function PaymentsScreen({ setActiveTab, favorites }) {
  return (
    <ScreenLayout title="Платежи и переводы">
      <div style={paymentsShowcaseCard}>
        <div style={paymentsShowcaseEyebrow}>Платежный центр</div>
        <div style={paymentsShowcaseTitle}>Переводы, шаблоны и повседневные платежи в одном месте</div>
        <div style={paymentsShowcaseText}>Основной сценарий внутри банка — перевод по VK ID. Ниже собраны остальные действия, которые нужны каждый день.</div>
        <div style={paymentsShowcaseChips}><div style={paymentsShowcaseChip}>Переводы по VK ID</div><div style={paymentsShowcaseChip}>Между своими счетами</div><div style={paymentsShowcaseChip}>Оплата сервисов</div></div>
      </div>

      <div style={paymentsFeatureGrid}>
        <div style={paymentsFeatureCardPrimary} onClick={() => setActiveTab("transfer")}><div style={paymentsFeatureIcon}>→</div><div style={paymentsFeatureTitle}>Перевод по VK ID</div><div style={paymentsFeatureText}>Найдём получателя по VK ID, покажем имя до отправки и сохраним шаблон при необходимости.</div></div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("internalTransfer")}><div style={paymentsFeatureIcon}>⇄</div><div style={paymentsFeatureTitle}>Между своими счетами</div><div style={paymentsFeatureText}>Быстрое перемещение денег между вашими продуктами внутри банка.</div></div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("interbankTransfer")}><div style={paymentsFeatureIcon}>Б</div><div style={paymentsFeatureTitle}>На другой банк</div><div style={paymentsFeatureText}>Переводы на внешние реквизиты и карты с отдельным сценарием подтверждения.</div></div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("pay")}><div style={paymentsFeatureIcon}>₽</div><div style={paymentsFeatureTitle}>Оплатить услугу</div><div style={paymentsFeatureText}>Связь, коммунальные услуги, цифровые сервисы и регулярные платежи.</div></div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("topup")}><div style={paymentsFeatureIcon}>+</div><div style={paymentsFeatureTitle}>Пополнить счёт</div><div style={paymentsFeatureText}>Пополнение баланса внутри банка и сервисные операции для счёта.</div></div>
        <div style={paymentsFeatureCard} onClick={() => setActiveTab("favorites")}><div style={paymentsFeatureIcon}>★</div><div style={paymentsFeatureTitle}>Шаблоны и избранное</div><div style={paymentsFeatureText}>Держите под рукой частые переводы и платежи, чтобы не вводить всё заново.</div></div>
      </div>

      {favorites.length > 0 ? (
        <div style={premiumSectionBlock}>
          <div style={sectionHeader}>
            <div><div style={screenSubtitle}>Быстрый запуск из избранного</div><div style={sectionLead}>Сохранённые шаблоны помогают повторять частые действия буквально в один-два тапа.</div></div>
            <button style={miniButton} onClick={() => setActiveTab("favorites")}>Все шаблоны</button>
          </div>
          <div style={premiumShortcutGrid}>
            {favorites.slice(0, 4).map((item) => (
              <div key={item.id} style={premiumShortcutCard} onClick={() => setActiveTab(item.payment_type === "service_payment" ? "pay" : "transfer")}>
                <div style={premiumShortcutIcon}>{item.payment_type === "service_payment" ? "₽" : "★"}</div>
                <div style={premiumShortcutTitle}>{item.template_name}</div>
                <div style={premiumShortcutMeta}>
                  {item.payment_type === "vk_transfer"
                    ? `Перевод по VK ID: ${item.recipient_value}`
                    : item.payment_type === "phone_transfer"
                      ? `Перевод по телефону: ${item.recipient_value}`
                      : `Оплата: ${item.provider_name || item.recipient_value}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </ScreenLayout>
  );
}

function ChatScreen({ vkId }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sendErr, setSendErr] = useState("");

  const loadMessages = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/support/messages/${vkId}`);
      const data = await res.json();
      if (Array.isArray(data)) setMessages(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadMessages();
  }, [vkId]);

  const sendMessage = async () => {
    setSendErr("");
    const ve = validateMessage(text);
    if (ve) {
      setSendErr(ve);
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/support/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vk_id: vkId, message: text.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSendErr(data.detail || "Не удалось отправить");
        return;
      }

      setText("");
      loadMessages();
    } catch (err) {
      console.error(err);
      setSendErr("Ошибка сети");
    }
  };

  return (
    <div style={{ paddingBottom: "90px" }}>
      <div style={screenTitle}>Чат поддержки</div>

      <div style={chatContainer}>
        {messages.map((msg) => (
          <div key={msg.id} style={msg.sender_type === "user" ? chatBubbleUser : chatBubbleBot}>
            {msg.message}
          </div>
        ))}
      </div>

      <div style={chatInputRow}>
        <input
          style={chatInputField}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Напишите сообщение..."
        />
        <button style={chatSendButton} onClick={sendMessage}>
          ➤
        </button>
      </div>
      {sendErr && (
        <div style={{ ...resultMessage, position: "fixed", bottom: "130px", left: 10, right: 10 }}>
          {sendErr}
        </div>
      )}
    </div>
  );
}

function MoreScreen({ setActiveTab }) {
  const [searchText, setSearchText] = useState("");

  const allItems = [
    { title: "💳 Мои счета", subtitle: "Счета и остатки", tab: "accounts" },
    { title: "🪪 Мои карты", subtitle: "Просмотр банковских карт", tab: "cards" },
    { title: "📊 История операций", subtitle: "Последние движения по счету", tab: "operations" },
    { title: "📈 Аналитика расходов", subtitle: "Разбивка трат по категориям", tab: "analytics" },
    { title: "🏦 Открыть новый счет", subtitle: "Создание нового счета", tab: "createAccount" },
    { title: "📄 Подать заявку", subtitle: "Оформление нового банковского продукта", tab: "application" },
    { title: "📑 Мои заявки", subtitle: "Просмотр отправленных заявок", tab: "applications" },
    { title: "🧰 Сервисные запросы", subtitle: "Пополнение, оплата, безопасность", tab: "serviceRequests" },
    { title: "🔔 Уведомления", subtitle: "История событий в приложении", tab: "notifications" },
    { title: "⭐ Избранное", subtitle: "Шаблоны и быстрые платежи", tab: "favorites" },
    { title: "👤 Профиль", subtitle: "Данные пользователя", tab: "profile" },
    { title: "⚙️ Настройки", subtitle: "Баланс, уведомления, язык", tab: "settings" },
    { title: "📞 Поддержка", subtitle: "Связь с банком", tab: "support" },
  ];

  const filteredItems = allItems.filter((item) =>
    `${repairMojibake(item.title)} ${item.subtitle}`.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <ScreenLayout title="Еще">
      <input
        style={input}
        placeholder="Поиск по разделам..."
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
      />

      {filteredItems.map((item) => (
        <MenuCard
          key={repairMojibake(item.title)}
          title={repairMojibake(item.title)}
          subtitle={item.subtitle}
          onClick={() => setActiveTab(item.tab)}
        />
      ))}

      {filteredItems.length === 0 && <div style={emptyBlock}>Ничего не найдено</div>}
    </ScreenLayout>
  );
}

function AccountsScreen({ accounts, cards, setActiveTab, onCardOpen, hideBalance }) {
  return (
    <ScreenLayout title="Мои счета и карты">
      {accounts.length === 0 ? (
        <div style={emptyBlock}>У пользователя пока нет счетов</div>
      ) : (
        accounts.map((account) => (
          <div key={account.id} style={accountCard}>
            <div style={accountTop}>
              <div style={moneyIcon}>₽</div>
              <div>
                <div style={accountBalance}>
                  {hideBalance
                    ? "•••••• ₽"
                    : Number(account.balance).toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }) + " ₽"}
                </div>
                <div style={accountName}>{repairMojibake(account.account_name)}</div>
              </div>
              <div style={cashbackBadge}>{account.status}</div>
            </div>
          </div>
        ))
      )}

      <MenuCard
        title="🏦 Открыть новый счет"
        subtitle="Создать дополнительный счет"
        onClick={() => setActiveTab("createAccount")}
      />

      <div style={screenSubtitle}>Мои карты</div>

      {cards.length === 0 ? (
        <div style={emptyBlock}>У пользователя пока нет карт</div>
      ) : (
        cards.map((card) => (
          <div key={card.id} style={menuCard} onClick={() => onCardOpen(card.id)}>
            <div style={menuCardTitle}>{repairMojibake(card.card_name)}</div>
            <div style={menuCardSubtitle}>{repairMojibake(card.card_number_mask)}</div>
            <div style={{ marginTop: "8px", color: "#9fc8f5", fontSize: "14px" }}>
              {repairMojibake(card.payment_system)} · {repairMojibake(card.expiry_date)} · {repairMojibake(card.status)}
            </div>
          </div>
        ))
      )}
    </ScreenLayout>
  );
}

function CardsScreen({ cards, onActionDone, onCardOpen }) {
  const [message, setMessage] = useState("");

  const blockCard = async (cardId) => {
    try {
      const res = await apiFetch(`${API_BASE}/cards/${cardId}/block`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        setMessage(typeof data.error === "string" ? data.error : "Не удалось заблокировать карту");
        return;
      }

      setMessage("Карта заблокирована");
      onActionDone();
    } catch (err) {
      console.error(err);
      setMessage("Не удалось заблокировать карту");
    }
  };

  const activeCards = cards.filter((card) => repairMojibake(card?.status) !== "Заблокирована").length;

  return (
    <ScreenLayout title="Мои карты">
      <div style={cardsSummaryGrid}>
        <div style={cardsSummaryCard}>
          <div style={premiumMetricLabel}>Всего карт</div>
          <div style={operationsSummaryValue}>{cards.length}</div>
          <div style={operationsSummaryMeta}>Все выпущенные карточные продукты клиента.</div>
        </div>
        <div style={cardsSummaryCard}>
          <div style={premiumMetricLabel}>Активные</div>
          <div style={operationsSummaryValue}>{activeCards}</div>
          <div style={operationsSummaryMeta}>Их можно использовать для оплаты и переводов.</div>
        </div>
      </div>

      {cards.length === 0 ? (
        <div style={emptyBlock}>У вас пока нет выпущенных карт. Оформите продукт через раздел заявок.</div>
      ) : (
        <div style={{ display: "grid", gap: "14px" }}>
          {cards.map((card) => {
            const status = repairMojibake(card?.status) || "Активна";
            const title = repairMojibake(card?.card_name) || "Банковская карта";
            const mask = repairMojibake(card?.card_number_mask) || "•••• •••• •••• ••••";
            const system = repairMojibake(card?.payment_system) || "MIR";
            const expiry = repairMojibake(card?.expiry_date) || "—";

            return (
              <div key={card.id} style={menuCard}>
                <div onClick={() => onCardOpen(card.id)} style={{ cursor: "pointer" }}>
                  <div style={menuCardTitle}>{title}</div>
                  <div style={menuCardSubtitle}>{mask}</div>
                  <div style={{ marginTop: 10, color: "#9fc8f5", fontSize: 14 }}>
                    {system} · {expiry} · {status}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
                  <button style={compactButton} onClick={() => onCardOpen(card.id)}>
                    Реквизиты
                  </button>
                  {status !== "Заблокирована" ? (
                    <button style={compactButton} onClick={() => blockCard(card.id)}>
                      Заблокировать
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {message ? <div style={resultMessage}>{repairMojibake(message)}</div> : null}
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
      .catch((err) => console.error("Ошибка загрузки карты:", err));
  }, [cardId]);

  if (!cardData) {
    return <div style={loading}>Загрузка...</div>;
  }

  const requisites = cardData?.requisites || {};
  const title = repairMojibake(cardData?.card_name) || "Банковская карта";
  const mask = repairMojibake(showFullNumber ? cardData?.full_card_number : cardData?.card_number_mask) || "•••• •••• •••• ••••";
  const status = repairMojibake(cardData?.status) || "Активна";
  const paymentSystem = repairMojibake(cardData?.payment_system) || "MIR";
  const expiry = repairMojibake(cardData?.expiry_date) || "—";

  return (
    <ScreenLayout title="Реквизиты карты">
      <div style={{ display: "grid", gap: "16px" }}>
        <button style={{ ...compactButton, width: "fit-content" }} onClick={onBack}>
          ← Назад к картам
        </button>

        <div style={menuCard}>
          <div style={menuCardTitle}>{title}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#eef4ff", marginTop: 10 }}>{mask}</div>
          <div style={{ marginTop: 10, color: "#9fc8f5", fontSize: 14 }}>
            {paymentSystem} · {expiry} · {status}
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
            <button style={compactButton} onClick={() => setShowFullNumber((prev) => !prev)}>
              {showFullNumber ? "Скрыть номер" : "Показать полный номер"}
            </button>
          </div>
        </div>

        <div style={premiumSectionBlock}>
          <div style={sectionHeader}>
            <div>
              <div style={screenSubtitle}>Банковские реквизиты</div>
              <div style={sectionLead}>Полные данные для переводов и сверки карточного продукта.</div>
            </div>
          </div>
          <div style={detailsGrid}>
            <div style={detailsInfoCard}><div style={premiumInfoLabel}>Счёт</div><div style={premiumInfoValue}>{repairMojibake(requisites.account_number) || "Нет данных"}</div></div>
            <div style={detailsInfoCard}><div style={premiumInfoLabel}>БИК</div><div style={premiumInfoValue}>{repairMojibake(requisites.bik) || "Нет данных"}</div></div>
            <div style={detailsInfoCard}><div style={premiumInfoLabel}>Корреспондентский счёт</div><div style={premiumInfoValue}>{repairMojibake(requisites.correspondent_account) || "Нет данных"}</div></div>
            <div style={detailsInfoCard}><div style={premiumInfoLabel}>Банк</div><div style={premiumInfoValue}>{repairMojibake(requisites.bank_name) || "Нет данных"}</div></div>
            <div style={detailsInfoCard}><div style={premiumInfoLabel}>Валюта</div><div style={premiumInfoValue}>{repairMojibake(requisites.currency) || "RUB"}</div></div>
          </div>
        </div>
      </div>
    </ScreenLayout>
  );
}

function OperationsScreen({ vkId, accounts }) {
  const [operations, setOperations] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [operationType, setOperationType] = useState("");
  const [category, setCategory] = useState("");

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
              <div key={item.id} style={premiumOperationCard}>
                <div style={premiumOperationLeading}>
                  <div style={premiumOperationIcon}>{item.operation_type === "income" ? "↓" : "↑"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={premiumOperationTitle}>{repairMojibake(item.title)}</div><div style={premiumOperationMeta}>{formatOperationDate(item.created_at)}</div></div>
                </div>
                <div style={premiumOperationTrailing}><div style={premiumCategoryPill}>{categoryLabelRu(item.category)}</div><div style={item.operation_type === "income" ? premiumIncomeAmount : premiumExpenseAmount}>{item.operation_type === "income" ? "+" : "−"}{formatMoney(item.amount)} ₽</div></div>
              </div>
            ))}
          </div>
        </div>
      )}
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
  const markRead = async (id) => {
    await apiFetch(`${API_BASE}/notifications/${id}/read`, { method: "POST" });
    onRefresh();
  };

  return (
    <ScreenLayout title="Уведомления">
      {notifications.length === 0 ? (
        <div style={emptyBlock}>Уведомлений пока нет</div>
      ) : (
        notifications.map((item) => (
          <div
            key={item.id}
            style={{
              ...menuCard,
              border: item.is_read ? "1px solid #1f3248" : "1px solid #4a90e2",
            }}
          >
            <div style={menuCardTitle}>{repairMojibake(item.title)}</div>
            <div style={menuCardSubtitle}>{repairMojibake(item.message)}</div>
            <div style={{ marginTop: "8px", fontSize: "12px", color: "#8da4bf" }}>
              {item.created_at}
            </div>
            {!item.is_read && (
              <button style={secondaryButton} onClick={() => markRead(item.id)}>
                Отметить как прочитанное
              </button>
            )}
          </div>
        ))
      )}
    </ScreenLayout>
  );
}

function FavoritesScreen({ favorites }) {
  return (
    <ScreenLayout title="Избранные платежи">
      {favorites.length === 0 ? (
        <div style={emptyBlock}>Шаблонов пока нет</div>
      ) : (
        favorites.map((item) => (
          <div key={item.id} style={menuCard}>
            <div style={menuCardTitle}>{item.template_name}</div>
            <div style={menuCardSubtitle}>
              {item.payment_type === "vk_transfer"
                ? `Перевод по VK ID: ${item.recipient_value}`
                : item.payment_type === "phone_transfer"
                  ? `Перевод по телефону: ${item.recipient_value}`
                  : `Оплата: ${item.provider_name || item.recipient_value}`}
            </div>
            <div style={{ marginTop: "8px", fontSize: "12px", color: "#8da4bf" }}>
              {item.created_at}
            </div>
          </div>
        ))
      )}
    </ScreenLayout>
  );
}

function ProfileScreen({ userData }) {
  const fullName = repairMojibake(userData.full_name) || "Клиент банка";
  const avatarLetter = fullName ? fullName[0].toUpperCase() : "U";

  return (
    <ScreenLayout title="Профиль">
      <div style={menuCard}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px", flexWrap: "wrap" }}>
          <div style={{ ...avatar, width: "72px", height: "72px", fontSize: "30px" }}>
            {avatarLetter}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "28px", fontWeight: "800", color: "#f3f8ff", lineHeight: 1.1 }}>{fullName}</div>
            <div style={{ marginTop: "8px", color: "#9fc8f5", fontSize: "14px" }}>Клиент ZF Bank во ВКонтакте</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <div style={premiumTag}>VK ID: {userData.vk_id}</div>
          <div style={premiumTag}>{userData.phone || "Телефон пока не указан"}</div>
        </div>
      </div>

      <div style={profileStatsGrid}>
        <div style={cardsSummaryCard}>
          <div style={premiumMetricLabel}>Статус профиля</div>
          <div style={premiumMetricValue}>Активен</div>
          <div style={operationsSummaryMeta}>Доступ к счетам, картам и переводам открыт</div>
        </div>
        <div style={cardsSummaryCard}>
          <div style={premiumMetricLabel}>Язык интерфейса</div>
          <div style={premiumMetricValue}>{userData.language === "en" ? "English" : "Русский"}</div>
          <div style={operationsSummaryMeta}>Изменяется в настройках приложения</div>
        </div>
        <div style={cardsSummaryCard}>
          <div style={premiumMetricLabel}>Тема</div>
          <div style={premiumMetricValue}>{userData.app_theme || "system"}</div>
          <div style={operationsSummaryMeta}>Единый banking-стиль для всех экранов</div>
        </div>
      </div>

      <div style={premiumSectionBlock}>
        <div style={screenSubtitle}>Персональные данные</div>
        <div style={sectionLead}>Сводка по вашему профилю и параметрам аккаунта внутри банка.</div>
        <div style={detailsGrid}>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>ФИО</div><div style={premiumInfoValue}>{fullName}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Телефон</div><div style={premiumInfoValue}>{userData.phone || "Не указан"}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>VK ID</div><div style={premiumInfoValue}>{userData.vk_id}</div></div>
          <div style={detailsInfoCard}><div style={premiumInfoLabel}>Дата регистрации</div><div style={premiumInfoValue}>{userData.created_at || "Нет данных"}</div></div>
        </div>
      </div>
    </ScreenLayout>
  );
}

function SettingsScreen({ vkId, userData, onRefresh, onLogout }) {
  const [hideBalance, setHideBalance] = useState(userData.hide_balance);
  const [notificationsEnabled, setNotificationsEnabled] = useState(userData.notifications_enabled);
  const [language, setLanguage] = useState(userData.language || "ru");
  const [message, setMessage] = useState("");

  const saveSettings = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/users/${vkId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hide_balance: hideBalance,
          notifications_enabled: notificationsEnabled,
          language,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("Настройки сохранены");
      onRefresh();
    } catch (err) {
      console.error(err);
      setMessage("Не удалось сохранить изменения");
    }
  };

  return (
    <ScreenLayout title="Настройки">
      <div style={settingsGrid}>
        <div style={premiumSectionBlock}>
          <div style={screenSubtitle}>Приватность и интерфейс</div>
          <div style={sectionLead}>Управляйте отображением баланса, уведомлениями и языком приложения.</div>

          <div style={switchRow}>
            <span>Скрывать баланс на главной</span>
            <input type="checkbox" checked={hideBalance} onChange={(e) => setHideBalance(e.target.checked)} />
          </div>

          <div style={switchRow}>
            <span>Получать уведомления</span>
            <input type="checkbox" checked={notificationsEnabled} onChange={(e) => setNotificationsEnabled(e.target.checked)} />
          </div>

          <div style={inputLabel}>Язык</div>
          <select style={input} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>

          <button style={primaryButton} onClick={saveSettings}>Сохранить настройки</button>
        </div>

        <div style={premiumSectionBlock}>
          <div style={screenSubtitle}>Безопасность</div>
          <div style={sectionLead}>Если открываете банк на новом устройстве или передаёте телефон, завершите PIN-сессию.</div>
          <button
            type="button"
            style={secondaryButton}
            onClick={() => {
              onLogout?.();
              setMessage("Сессия сброшена. Для входа снова потребуется PIN-код.");
            }}
          >
            Выйти и сбросить PIN-сессию
          </button>
          {message && <div style={resultMessage}>{message}</div>}
        </div>
      </div>
    </ScreenLayout>
  );
}

function OnboardingScreen({ vkId, onDone }) {
  const finish = async () => {
    await apiFetch(`${API_BASE}/users/${vkId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_completed: true }),
    });
    onDone();
  };

  return (
    <ScreenLayout title="Добро пожаловать">
      <div style={menuCard}>
        <div style={menuCardTitle}>Что умеет приложение</div>
        <div style={menuCardSubtitle}>
          Здесь вы можете смотреть счета и карты, переводить деньги, оплачивать услуги,
          подавать заявки, общаться с поддержкой и пользоваться избранными шаблонами.
        </div>
      </div>

      <div style={menuCard}>
        <div style={menuCardTitle}>Быстрый старт</div>
        <div style={menuCardSubtitle}>
          Начните с проверки счетов, затем попробуйте переводы, платежи и аналитический раздел.
        </div>
      </div>

      <button style={primaryButton} onClick={finish}>
        Начать пользоваться
      </button>
    </ScreenLayout>
  );
}
function SupportScreen({ setActiveTab }) {
  return (
    <ScreenLayout title="Поддержка">
      <MenuCard
        title="☎️ Позвонить в банк"
        subtitle="+7 (800) 555-35-35"
        onClick={() => setActiveTab("callBank")}
      />
      <MenuCard
        title="💬 Онлайн-чат"
        subtitle="Связаться с оператором"
        onClick={() => setActiveTab("chat")}
      />
      <MenuCard
        title="❓ Частые вопросы"
        subtitle="Справочный раздел"
        onClick={() => setActiveTab("faq")}
      />
      <MenuCard
        title="🔒 Сообщить о проблеме"
        subtitle="Безопасность и блокировка карты"
        onClick={() => setActiveTab("problemReport")}
      />
      <MenuCard
        title="🧰 История запросов"
        subtitle="Просмотр сервисных запросов"
        onClick={() => setActiveTab("serviceRequests")}
      />
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
  const [productType, setProductType] = useState("Дебетовая карта");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [income, setIncome] = useState("");
  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState("");
  const [message, setMessage] = useState("");

  const sendApplication = async () => {
    let details = "";

    if (!fullName || !phone) {
      setMessage("Заполни ФИО и телефон");
      return;
    }

    const normalizedPhone = normalizeRussianPhone(phone);

    if (!isValidRussianPhone(normalizedPhone)) {
      setMessage("Введите корректный номер телефона РФ: +7XXXXXXXXXX");
      return;
    }

    if (productType === "Кредит" && (!income || !amount || !term)) {
      setMessage("Для кредита заполни доход, сумму и срок");
      return;
    }

    if (productType === "Ипотека" && (!income || !amount || !term)) {
      setMessage("Для ипотеки заполни доход, стоимость/сумму и срок");
      return;
    }

    if (productType === "Вклад" && (!amount || !term)) {
      setMessage("Для вклада заполни сумму и срок");
      return;
    }

    if (productType === "Дебетовая карта") {
      details = `ФИО: ${fullName}; Телефон: ${normalizedPhone}`;
    } else if (productType === "Кредит") {
      details = `ФИО: ${fullName}; Телефон: ${normalizedPhone}; Доход: ${income}; Сумма кредита: ${amount}; Срок: ${term}`;
    } else if (productType === "Ипотека") {
      details = `ФИО: ${fullName}; Телефон: ${normalizedPhone}; Доход: ${income}; Стоимость/сумма: ${amount}; Срок: ${term}`;
    } else if (productType === "Вклад") {
      details = `ФИО: ${fullName}; Телефон: ${normalizedPhone}; Сумма вклада: ${amount}; Срок: ${term}`;
    }

    try {
      const res = await apiFetch(`${API_BASE}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          product_type: productType,
          details,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("Заявка отправлена");
      setFullName("");
      setPhone("");
      setIncome("");
      setAmount("");
      setTerm("");
    } catch (err) {
      console.error(err);
      setMessage("Ошибка отправки");
    }
  };

  return (
    <ScreenLayout title="Подать заявку">
      <div style={formCard}>
        <div style={inputLabel}>Продукт</div>
        <select style={input} value={productType} onChange={(e) => setProductType(e.target.value)}>
          <option>Дебетовая карта</option>
          <option>Кредит</option>
          <option>Ипотека</option>
          <option>Вклад</option>
        </select>

        <div style={inputLabel}>ФИО</div>
        <input style={input} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Иван Иванов" />

        <div style={inputLabel}>Телефон</div>
        <input
          style={input}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => {
            if (phone) setPhone(normalizeRussianPhone(phone));
          }}
          placeholder="+79990001122"
        />

        {(productType === "Кредит" || productType === "Ипотека") && (
          <>
            <div style={inputLabel}>Ежемесячный доход</div>
            <input style={input} value={income} onChange={(e) => setIncome(e.target.value)} placeholder="100000" />
          </>
        )}

        {(productType === "Кредит" || productType === "Ипотека" || productType === "Вклад") && (
          <>
            <div style={inputLabel}>{productType === "Вклад" ? "Сумма" : "Сумма / стоимость"}</div>
            <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000" />
            <div style={inputLabel}>Срок</div>
            <input style={input} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="12 месяцев" />
          </>
        )}

        <button style={primaryButton} onClick={sendApplication}>
          Отправить заявку
        </button>

        {message && <div style={resultMessage}>{message}</div>}
      </div>
    </ScreenLayout>
  );
}

function ApplicationsListScreen({ vkId }) {
  const [applications, setApplications] = useState([]);

  useEffect(() => {
    apiFetch(`${API_BASE}/users/${vkId}/applications`)
      .then((res) => res.json())
      .then((data) => setApplications(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Ошибка загрузки заявок:", err));
  }, [vkId]);

  return (
    <ScreenLayout title="Мои заявки">
      {applications.length === 0 ? (
        <div style={emptyBlock}>Заявок пока нет</div>
      ) : (
        applications.map((item) => (
          <div key={item.id} style={applicationCard}>
            <div style={{ fontWeight: "bold" }}>{item.product_type}</div>
            <div style={{ marginTop: "6px", color: "#9fb3c8" }}>Статус: {item.status}</div>
            <div style={{ marginTop: "6px", color: "#dcecff", fontSize: "13px" }}>{item.details}</div>
            <div style={{ marginTop: "4px", fontSize: "13px" }}>{item.created_at}</div>
          </div>
        ))
      )}
    </ScreenLayout>
  );
}

function TransferScreen({ senderVkId, onTransferSuccess, onFavoriteSaved }) {
  const [recipientVkId, setRecipientVkId] = useState("");
  const [recipientPreview, setRecipientPreview] = useState(null);
  const [amount, setAmount] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [message, setMessage] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);

  const resetPreview = () => setRecipientPreview(null);

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
            Переводы по номеру телефона лучше добавлять позже, когда в продукте появится обязательная и подтверждённая привязка номера.
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
      <div style={formCard}>
        {accounts.length < 2 ? (
          <div style={emptyBlock}>Для перевода между своими счетами нужно минимум 2 счета.</div>
        ) : (
          <>
            <div style={inputLabel}>Счет списания</div>
            <select style={input} value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {repairMojibake(acc.account_name)} · {Number(acc.balance).toLocaleString("ru-RU")} ₽
                </option>
              ))}
            </select>

            <div style={inputLabel}>Счет зачисления</div>
            <select style={input} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {repairMojibake(acc.account_name)} · {Number(acc.balance).toLocaleString("ru-RU")} ₽
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
                  {repairMojibake(acc.account_name)} · {Number(acc.balance).toLocaleString("ru-RU")} ₽
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
    const vn = validateAccountName(accountName);
    if (vn) {
      setMessage(vn);
      return;
    }
    try {
      const res = await apiFetch(`${API_BASE}/accounts/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          account_name: accountName,
          currency,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("Новый счет создан");
      setAccountName("");
      onSuccess();
    } catch (err) {
      console.error(err);
      setMessage("Ошибка создания счета");
    }
  };

  return (
    <ScreenLayout title="Открыть новый счет">
      <div style={formCard}>
        <div style={inputLabel}>Название счета</div>
        <input style={input} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Накопительный счет" />

        <div style={inputLabel}>Валюта</div>
        <select style={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option>RUB</option>
          <option>USD</option>
          <option>EUR</option>
        </select>

        <button style={primaryButton} onClick={submitCreateAccount}>
          Создать счет
        </button>

        {message && <div style={resultMessage}>{message}</div>}
      </div>
    </ScreenLayout>
  );
}

function TopUpScreen({ vkId }) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("С карты другого банка");
  const [message, setMessage] = useState("");

  const submitTopUp = async () => {
    if (!amount || !source) {
      setMessage("Заполни все поля");
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          request_type: "Пополнение счета",
          details: `Источник: ${source}; Сумма: ${amount} ₽`,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("Запрос на пополнение создан");
      setAmount("");
    } catch (err) {
      console.error(err);
      setMessage("Ошибка создания запроса");
    }
  };

  return (
    <ScreenLayout title="Пополнение">
      <div style={formCard}>
        <div style={inputLabel}>Источник пополнения</div>
        <select style={input} value={source} onChange={(e) => setSource(e.target.value)}>
          <option>С карты другого банка</option>
          <option>Банковский перевод</option>
          <option>Через банкомат</option>
          <option>Наличными в кассе</option>
          <option>Со своего другого счета</option>
        </select>

        <div style={inputLabel}>Сумма</div>
        <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" type="number" />

        <button style={primaryButton} onClick={submitTopUp}>
          Пополнить
        </button>

        {message && <div style={resultMessage}>{message}</div>}
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

  const submitPayment = async () => {
    if (!serviceType || !provider || !amount) {
      setMessage("Заполни все поля");
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          request_type: "Оплата услуги",
          details: `Вид услуги: ${serviceType}; Получатель: ${provider}; Сумма: ${amount} ₽`,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("Оплата выполнена");
      setProvider("");
      setAmount("");
    } catch (err) {
      console.error(err);
      setMessage("Ошибка оплаты");
    }
  };

  const saveFavorite = async () => {
    if (!templateName || !provider) {
      setMessage("Укажи название шаблона и получателя");
      return;
    }

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

    const data = await res.json();
    if (data.error) {
      setMessage(data.error);
      return;
    }

    setMessage("Шаблон платежа сохранен");
    setTemplateName("");
    onFavoriteSaved();
  };

  return (
    <ScreenLayout title="Оплата услуг">
      <div style={formCard}>
        <div style={inputLabel}>Вид услуги</div>
        <select style={input} value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
          <option>Мобильная связь</option>
          <option>Интернет</option>
          <option>ЖКХ</option>
          <option>Образование</option>
          <option>Штрафы</option>
          <option>Телевидение</option>
        </select>

        <div style={inputLabel}>Получатель</div>
        <input style={input} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="МТС / Ростелеком / ЖКХ-сервис" />

        <div style={inputLabel}>Сумма</div>
        <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1200" type="number" />

        <button style={primaryButton} onClick={submitPayment}>
          Оплатить
        </button>

        <div style={inputLabel}>Название шаблона</div>
        <input style={input} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Интернет домой" />

        <button style={secondaryButton} onClick={saveFavorite}>
          Сохранить в избранное
        </button>

        {message && <div style={resultMessage}>{message}</div>}
      </div>
    </ScreenLayout>
  );
}

function SecurityScreen({ vkId, cards, onActionDone, setActiveTab }) {
  const [message, setMessage] = useState("");
  const mainCard = cards[0];

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

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("Запрос отправлен");
    } catch (err) {
      console.error(err);
      setMessage("Ошибка отправки запроса");
    }
  };

  const blockMainCard = async () => {
    if (!mainCard) {
      setMessage("Нет карты для блокировки");
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/cards/${mainCard.id}/block`, {
        method: "POST",
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("Карта заблокирована");
      onActionDone();
    } catch (err) {
      console.error(err);
      setMessage("Ошибка блокировки карты");
    }
  };

  return (
    <ScreenLayout title="Безопасность">
      <MenuCard
        title="🔒 Заблокировать карту"
        subtitle={mainCard ? mainCard.card_number_mask : "Карта не найдена"}
        onClick={blockMainCard}
      />
      <MenuCard
        title="🔑 Сменить PIN-код"
        subtitle="Создать запрос на смену PIN"
        onClick={() => createSecurityRequest("Смена PIN-кода", "Пользователь запросил смену PIN-кода")}
      />
      <MenuCard
        title="📍 Подозрительная операция"
        subtitle="Сообщить о подозрительной активности"
        onClick={() =>
          createSecurityRequest(
            "Подозрительная операция",
            "Пользователь сообщил о подозрительной операции"
          )
        }
      />
      <MenuCard
        title="🛡️ Советы по безопасности"
        subtitle="Рекомендации по защите аккаунта"
        onClick={() => setActiveTab("safetyTips")}
      />

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
      <MenuCard title="💸 Как сделать перевод?" subtitle="Откройте Платежи → Перевод по телефону" />
      <MenuCard title="📄 Как подать заявку?" subtitle="Главная → Заявка или Еще → Подать заявку" />
      <MenuCard title="💬 Как связаться с поддержкой?" subtitle="Откройте Онлайн-чат или Позвонить в банк" />
    </ScreenLayout>
  );
}

function ProblemReportScreen({ vkId }) {
  const [problemText, setProblemText] = useState("");
  const [message, setMessage] = useState("");

  const submitProblem = async () => {
    if (!problemText.trim()) {
      setMessage("Опиши проблему");
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/service-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vk_id: vkId,
          request_type: "Сообщение о проблеме",
          details: problemText,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("Сообщение о проблеме отправлено");
      setProblemText("");
    } catch (err) {
      console.error(err);
      setMessage("Ошибка отправки");
    }
  };

  return (
    <ScreenLayout title="Сообщить о проблеме">
      <div style={formCard}>
        <div style={inputLabel}>Описание проблемы</div>
        <textarea
          style={textArea}
          value={problemText}
          onChange={(e) => setProblemText(e.target.value)}
          placeholder="Опишите проблему с картой, операцией или аккаунтом"
        />

        <button style={primaryButton} onClick={submitProblem}>
          Отправить
        </button>

        {message && <div style={resultMessage}>{message}</div>}
      </div>
    </ScreenLayout>
  );
}

function ServiceRequestsScreen({ vkId }) {
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    apiFetch(`${API_BASE}/users/${vkId}/service-requests`)
      .then((res) => res.json())
      .then((data) => setRequests(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Ошибка загрузки сервисных запросов:", err));
  }, [vkId]);

  return (
    <ScreenLayout title="Сервисные запросы">
      {requests.length === 0 ? (
        <div style={emptyBlock}>Сервисных запросов пока нет</div>
      ) : (
        requests.map((item) => (
          <div key={item.id} style={applicationCard}>
            <div style={{ fontWeight: "bold" }}>{item.request_type}</div>
            <div style={{ marginTop: "6px", color: "#9fb3c8" }}>{item.details}</div>
            <div style={{ marginTop: "8px", color: "#9fc8f5", fontSize: "13px" }}>
              Статус: {item.status}
            </div>
            <div style={{ marginTop: "4px", fontSize: "13px" }}>{item.created_at}</div>
          </div>
        ))
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
  gap: "14px",
  marginBottom: "20px",
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
  padding: "16px 18px",
  fontSize: "16px",
  marginBottom: "22px",
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
  bottom: 0,
  background: "rgba(14, 22, 34, 0.96)",
  borderTop: "1px solid #22354c",
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  padding: "10px 10px max(14px, env(safe-area-inset-bottom, 0px))",
  backdropFilter: "blur(10px)",
  width: "min(100%, 1120px)",
  transform: "translateX(-50%)",
  boxSizing: "border-box",
  borderTopLeftRadius: "18px",
  borderTopRightRadius: "18px",
  boxShadow: "0 -12px 32px rgba(7, 13, 22, 0.35)",
};

const screenLayout = {
  paddingBottom: "100px",
  maxWidth: "920px",
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
  gap: "14px",
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
  bottom: "70px",
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(100%, 1120px)",
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
const premiumOperationCard = { display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "center", padding: "18px", borderRadius: "22px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(42, 61, 86, 0.92)", flexWrap: "wrap", minWidth: 0 };
const premiumOperationLeading = { display: "flex", alignItems: "center", gap: "14px", minWidth: 0, flex: 1 };
const premiumOperationTrailing = { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" };
const premiumOperationIcon = { width: "42px", height: "42px", borderRadius: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(88, 140, 204, 0.14)", color: "#dff0ff", fontWeight: "700", flexShrink: 0 };
const premiumOperationTitle = { fontWeight: "700", color: "#f3f7ff", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
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
const premiumShortcutGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: "12px" };
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
const paymentsFeatureGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "14px" };
const paymentsFeatureCard = { padding: "20px", borderRadius: "24px", background: "linear-gradient(180deg, rgba(16, 25, 38, 0.94) 0%, rgba(12, 20, 31, 0.94) 100%)", border: "1px solid rgba(37, 55, 77, 0.9)", cursor: "pointer" };
const paymentsFeatureCardPrimary = { ...paymentsFeatureCard, background: "linear-gradient(135deg, rgba(28, 57, 92, 0.98), rgba(15, 31, 50, 0.98))", border: "1px solid rgba(96, 145, 202, 0.48)" };
const paymentsFeatureIcon = { width: "46px", height: "46px", borderRadius: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(122, 184, 255, 0.14)", marginBottom: "14px" };
const paymentsFeatureTitle = { fontSize: "20px", fontWeight: "700", marginBottom: "8px" };
const paymentsFeatureText = { color: "#a5bdd7", lineHeight: 1.58, fontSize: "14px" };
const operationsSummaryGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px" };
const operationsSummaryCard = { background: "linear-gradient(180deg, rgba(16, 25, 38, 0.94) 0%, rgba(12, 20, 31, 0.94) 100%)", border: "1px solid rgba(37, 55, 77, 0.9)", borderRadius: "24px", padding: "18px" };
const operationsSummaryValue = { fontSize: "clamp(28px, 4vw, 38px)", fontWeight: "800", color: "#f4f8ff" };
const operationsSummaryMeta = { marginTop: "8px", color: "#8da8c4", fontSize: "13px" };
const premiumCategoryPill = { padding: "8px 10px", borderRadius: "999px", background: "rgba(122, 184, 255, 0.1)", border: "1px solid rgba(122, 184, 255, 0.18)", color: "#d7eaff", fontSize: "12px", whiteSpace: "nowrap" };
const cardsSummaryGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px", marginBottom: "18px" };
const cardsSummaryCard = { background: "linear-gradient(180deg, rgba(16, 25, 38, 0.94) 0%, rgba(12, 20, 31, 0.94) 100%)", border: "1px solid rgba(37, 55, 77, 0.9)", borderRadius: "22px", padding: "18px" };
const cardsDeckGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "16px" };
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
