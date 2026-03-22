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
  analytics,
  notifications,
  setActiveTab,
}) {
  const mainCard = cards[0];
  const totalExpenses = Number(analytics?.total_expenses || 0);
  const categories = analytics?.categories || {};
  const latestNotification = notifications[0];

  const categoryTotal = Object.values(categories).reduce(
    (sum, item) => sum + Number(item || 0),
    0
  );

  const segments = [
    { key: "shopping", color: "#4a90e2" },
    { key: "transfer", color: "#5fb0ff" },
    { key: "subscription", color: "#86c5ff" },
    { key: "services", color: "#b7ddff" },
    { key: "commission", color: "#7fd3c7" },
  ].filter((segment) => Number(categories[segment.key] || 0) > 0);

  const unreadCount = notifications.filter((item) => !item.is_read).length;

  return (
    <>
      {!userData.onboarding_completed && (
        <div style={onboardingBanner} onClick={() => setActiveTab("onboarding")}>
          👋 Завершите быстрый онбординг
        </div>
      )}

      <div style={topBadge}>BANK MINI APP</div>

      <div style={header}>
        <div style={avatar}>
          {userData.full_name ? userData.full_name[0].toUpperCase() : "U"}
        </div>

        <div style={{ flex: 1 }}>
          <div style={userName}>{userData.full_name}</div>
          <div style={userTag}>Обслуживание во ВКонтакте</div>
        </div>

        <div style={headerActionsWrap}>
          <div style={headerAction} onClick={() => setActiveTab("settings")}>
            ⚙️
          </div>
          <div style={headerAction} onClick={() => setActiveTab("notifications")}>
            🔔
            {unreadCount > 0 && <div style={badgeDot}>{unreadCount}</div>}
          </div>
        </div>
      </div>

      <div style={search} onClick={() => setActiveTab("more")}>
        🔍 Поиск счетов, карт, услуг и операций
      </div>

      <div style={storiesRow}>
        <div style={storyCard} onClick={() => setActiveTab("cards")}>
          💳<br />Карты
        </div>
        <div style={storyCard} onClick={() => setActiveTab("operations")}>
          📊<br />Операции
        </div>
        <div style={storyCard} onClick={() => setActiveTab("security")}>
          🛡️<br />Безопасность
        </div>
        <div style={storyCard} onClick={() => setActiveTab("favorites")}>
          ⭐<br />Избранное
        </div>
      </div>

      <div style={grid2}>
        <div style={infoCard} onClick={() => setActiveTab("analytics")}>
          <div style={cardTitle}>Расходы за месяц</div>
          <div style={cardText}>Статистика операций</div>
          <div style={bigText}>
            {totalExpenses.toLocaleString("ru-RU", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} ₽
          </div>

          <div style={progressWrap}>
            {segments.length === 0 ? (
              <div style={{ ...progressPart, background: "#2a3b52", width: "100%" }} />
            ) : (
              segments.map((segment) => {
                const value = Number(categories[segment.key] || 0);
                const width =
                  categoryTotal > 0 ? `${(value / categoryTotal) * 100}%` : "0%";

                return (
                  <div
                    key={segment.key}
                    style={{
                      ...progressPart,
                      background: segment.color,
                      width,
                    }}
                  />
                );
              })
            )}
          </div>

          <div style={miniLegend}>
            <span>Покупки</span>
            <span>Переводы</span>
            <span>Подписки</span>
          </div>
        </div>

        <div style={infoCard} onClick={() => setActiveTab("cards")}>
          <div style={cardTitle}>Моя карта</div>
          <div style={cardText}>{mainCard?.payment_system || "МИР"}</div>
          <div style={bigText}>
            {mainCard?.card_number_mask || "Карта не найдена"}
          </div>
          <div style={{ marginTop: "18px", color: "#a1b1c6", fontSize: "14px" }}>
            {mainCard?.status || "Нет данных"}
          </div>
        </div>
      </div>

      <div style={actionsRow}>
        <ActionButton
          icon="📱"
          text="Перевод\nпо телефону"
          onClick={() => setActiveTab("transfer")}
        />
        <ActionButton
          icon="➕"
          text="Пополнить"
          onClick={() => setActiveTab("topup")}
        />
        <ActionButton
          icon="🧾"
          text="Оплатить"
          onClick={() => setActiveTab("pay")}
        />
        <ActionButton
          icon="👤"
          text="Профиль"
          onClick={() => setActiveTab("profile")}
        />
      </div>

      <div style={sectionHeader}>
        <div style={screenSubtitle}>Мои счета</div>
        <button style={miniButton} onClick={() => setActiveTab("settings")}>
          {userData.hide_balance ? "Показать баланс" : "Скрыть баланс"}
        </button>
      </div>

      {accounts.length === 0 ? (
        <div style={emptyBlock}>У пользователя пока нет счетов</div>
      ) : (
        accounts.map((account) => (
          <div key={account.id} style={accountCard} onClick={() => setActiveTab("accounts")}>
            <div style={accountTop}>
              <div style={moneyIcon}>₽</div>

              <div>
                <div style={accountBalance}>
                  {userData.hide_balance
                    ? "•••••• ₽"
                    : Number(account.balance).toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }) + " ₽"}
                </div>
                <div style={accountName}>{account.account_name}</div>
              </div>

              <div style={cashbackBadge}>{account.status}</div>
            </div>
          </div>
        ))
      )}

      {latestNotification && (
        <>
          <div style={screenSubtitle}>Что нового</div>
          <div style={menuCard} onClick={() => setActiveTab("notifications")}>
            <div style={menuCardTitle}>{latestNotification.title}</div>
            <div style={menuCardSubtitle}>{latestNotification.message}</div>
          </div>
        </>
      )}

      <div style={banner} onClick={() => setActiveTab("application")}>
        <div>
          <div style={bannerTitle}>Оформить банковский продукт</div>
          <div style={bannerText}>Карта, кредит, вклад или ипотека</div>
        </div>
        <div style={bannerIcon}>🏦</div>
      </div>
    </>
  );
}

function PaymentsScreen({ setActiveTab, favorites }) {
  return (
    <ScreenLayout title="Платежи">
      {favorites.length > 0 && (
        <>
          <div style={screenSubtitle}>Избранные шаблоны</div>
          {favorites.slice(0, 3).map((item) => (
            <div key={item.id} style={menuCard}>
              <div style={menuCardTitle}>{item.template_name}</div>
              <div style={menuCardSubtitle}>
                {item.payment_type === "phone_transfer"
                  ? `Перевод: ${item.recipient_value}`
                  : `Платеж: ${item.provider_name || item.recipient_value}`}
              </div>
            </div>
          ))}
        </>
      )}

      <MenuCard
        title="📱 Перевод по номеру телефона"
        subtitle="Быстрый перевод клиенту"
        onClick={() => setActiveTab("transfer")}
      />
      <MenuCard
        title="💳 Перевод между своими счетами"
        subtitle="Перевод между личными счетами"
        onClick={() => setActiveTab("internalTransfer")}
      />
      <MenuCard
        title="🏦 Межбанковский перевод"
        subtitle="Выбор банка и реквизитов"
        onClick={() => setActiveTab("interbankTransfer")}
      />
      <MenuCard
        title="🧾 Оплата услуг"
        subtitle="Выбор вида услуги и получателя"
        onClick={() => setActiveTab("pay")}
      />
      <MenuCard
        title="➕ Пополнение"
        subtitle="Пополнение счета"
        onClick={() => setActiveTab("topup")}
      />
      <MenuCard
        title="⭐ Мои шаблоны"
        subtitle="Избранные платежи и переводы"
        onClick={() => setActiveTab("favorites")}
      />
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
    `${item.title} ${item.subtitle}`.toLowerCase().includes(searchText.toLowerCase())
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
          key={item.title}
          title={item.title}
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
                <div style={accountName}>{account.account_name}</div>
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
            <div style={menuCardTitle}>{card.card_name}</div>
            <div style={menuCardSubtitle}>{card.card_number_mask}</div>
            <div style={{ marginTop: "8px", color: "#9fc8f5", fontSize: "14px" }}>
              {card.payment_system} · {card.expiry_date} · {card.status}
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
    <ScreenLayout title="Мои карты">
      {cards.length === 0 ? (
        <div style={emptyBlock}>У пользователя пока нет карт</div>
      ) : (
        cards.map((card) => (
          <div key={card.id} style={menuCard}>
            <div onClick={() => onCardOpen(card.id)}>
              <div style={menuCardTitle}>{card.card_name}</div>
              <div style={menuCardSubtitle}>{card.card_number_mask}</div>
              <div style={{ marginTop: "8px", color: "#9fc8f5", fontSize: "14px" }}>
                {card.payment_system} · {card.expiry_date} · {card.status}
              </div>
            </div>

            {card.status !== "Заблокирована" && (
              <button style={secondaryButton} onClick={() => blockCard(card.id)}>
                Заблокировать карту
              </button>
            )}
          </div>
        ))
      )}

      {message && <div style={resultMessage}>{message}</div>}
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

  return (
    <ScreenLayout title="Реквизиты карты">
      <button style={secondaryButton} onClick={onBack}>
        ← Назад
      </button>

      <div style={formCard}>
        <div style={menuCardTitle}>{cardData.card_name}</div>
        <div style={menuCardSubtitle}>
          {showFullNumber ? cardData.full_card_number : cardData.card_number_mask}
        </div>

        <button style={secondaryButton} onClick={() => setShowFullNumber((prev) => !prev)}>
          {showFullNumber ? "Скрыть номер карты" : "Показать номер карты"}
        </button>

        <div style={detailsRow}>
          <span>Платежная система</span>
          <span>{cardData.payment_system}</span>
        </div>
        <div style={detailsRow}>
          <span>Срок действия</span>
          <span>{cardData.expiry_date}</span>
        </div>
        <div style={detailsRow}>
          <span>Статус</span>
          <span>{cardData.status}</span>
        </div>
      </div>

      <div style={formCard}>
        <div style={screenSubtitle}>Реквизиты</div>
        <div style={detailsRow}>
          <span>Номер счета</span>
          <span>{cardData.requisites.account_number}</span>
        </div>
        <div style={detailsRow}>
          <span>БИК</span>
          <span>{cardData.requisites.bik}</span>
        </div>
        <div style={detailsRow}>
          <span>Корр. счет</span>
          <span>{cardData.requisites.correspondent_account}</span>
        </div>
        <div style={detailsRow}>
          <span>Банк</span>
          <span>{cardData.requisites.bank_name}</span>
        </div>
        <div style={detailsRow}>
          <span>Валюта</span>
          <span>{cardData.requisites.currency}</span>
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

    const url = `${API_BASE}/users/${vkId}/operations${
      params.toString() ? `?${params.toString()}` : ""
    }`;

    apiFetch(url)
      .then((res) => res.json())
      .then((data) => setOperations(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Ошибка загрузки операций:", err));
  };

  useEffect(() => {
    loadOperations();
  }, [vkId, accountId, operationType, category]);

  const categoryLabel = {
    transfer: "Перевод",
    shopping: "Покупка",
    subscription: "Подписка",
    topup: "Пополнение",
    services: "Услуги",
    commission: "Комиссия",
    other: "Другое",
  };

  return (
    <ScreenLayout title="История операций">
      <div style={formCard}>
        <div style={inputLabel}>Счет</div>
        <select style={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Все счета</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.account_name}
            </option>
          ))}
        </select>

        <div style={inputLabel}>Тип операции</div>
        <select style={input} value={operationType} onChange={(e) => setOperationType(e.target.value)}>
          <option value="">Все</option>
          <option value="income">Только доходы</option>
          <option value="expense">Только расходы</option>
        </select>

        <div style={inputLabel}>Категория</div>
        <select style={input} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Все категории</option>
          <option value="transfer">Переводы</option>
          <option value="shopping">Покупки</option>
          <option value="subscription">Подписки</option>
          <option value="topup">Пополнения</option>
          <option value="services">Услуги</option>
          <option value="commission">Комиссии</option>
        </select>
      </div>

      {operations.length === 0 ? (
        <div style={emptyBlock}>Операции пока отсутствуют</div>
      ) : (
        operations.map((item) => (
          <div key={item.id} style={operationItem}>
            <div>
              <div style={operationTitle}>{item.title}</div>
              <div style={operationDate}>
                {item.created_at} · {categoryLabel[item.category] || "Другое"}
              </div>
            </div>

            <div style={item.operation_type === "income" ? incomeAmount : expenseAmount}>
              {item.operation_type === "income" ? "+" : "-"}
              {Number(item.amount).toLocaleString("ru-RU", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} ₽
            </div>
          </div>
        ))
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
            <div style={menuCardTitle}>{item.title}</div>
            <div style={menuCardSubtitle}>{item.message}</div>
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
              {item.payment_type === "phone_transfer"
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
  return (
    <ScreenLayout title="Профиль">
      <div style={formCard}>
        <div style={detailsRow}>
          <span>ФИО</span>
          <span>{userData.full_name}</span>
        </div>
        <div style={detailsRow}>
          <span>Телефон</span>
          <span>{userData.phone || "Не указан"}</span>
        </div>
        <div style={detailsRow}>
          <span>VK ID</span>
          <span>{userData.vk_id}</span>
        </div>
        <div style={detailsRow}>
          <span>Дата регистрации</span>
          <span>{userData.created_at || "Нет данных"}</span>
        </div>
        <div style={detailsRow}>
          <span>Язык</span>
          <span>{userData.language}</span>
        </div>
        <div style={detailsRow}>
          <span>Тема</span>
          <span>{userData.app_theme}</span>
        </div>
      </div>
    </ScreenLayout>
  );
}

function SettingsScreen({ vkId, userData, onRefresh, onLogout }) {
  const [hideBalance, setHideBalance] = useState(userData.hide_balance);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    userData.notifications_enabled
  );
  const [language, setLanguage] = useState(userData.language || "ru");
  const [message, setMessage] = useState("");

  const saveSettings = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/users/${vkId}/settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hide_balance: hideBalance,
            notifications_enabled: notificationsEnabled,
            language,
          }),
        }
      );

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage("Настройки сохранены");
      onRefresh();
    } catch (err) {
      console.error(err);
      setMessage("Ошибка сохранения");
    }
  };

  return (
    <ScreenLayout title="Настройки">
      <div style={formCard}>
        <div style={switchRow}>
          <span>Скрывать баланс</span>
          <input
            type="checkbox"
            checked={hideBalance}
            onChange={(e) => setHideBalance(e.target.checked)}
          />
        </div>

        <div style={switchRow}>
          <span>Уведомления</span>
          <input
            type="checkbox"
            checked={notificationsEnabled}
            onChange={(e) => setNotificationsEnabled(e.target.checked)}
          />
        </div>

        <div style={inputLabel}>Язык</div>
        <select style={input} value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>

        <button style={primaryButton} onClick={saveSettings}>
          Сохранить
        </button>

        <button
          type="button"
          style={secondaryButton}
          onClick={() => {
            onLogout?.();
            setMessage("Сессия сброшена. Введите PIN снова.");
          }}
        >
          Выйти (сброс PIN-сессии)
        </button>

        {message && <div style={resultMessage}>{message}</div>}
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
  const [recipientPhone, setRecipientPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [message, setMessage] = useState("");

  const sendTransfer = async () => {
    const normalizedPhone = normalizeRussianPhone(recipientPhone);

    if (!isValidRussianPhone(normalizedPhone)) {
      setMessage("Введите корректный номер в формате РФ: +7XXXXXXXXXX");
      return;
    }

    const va = validateAmount(amount);
    if (va) {
      setMessage(va);
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_vk_id: senderVkId,
          recipient_phone: normalizedPhone,
          amount: Number(amount),
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }

      setMessage(`Перевод выполнен: ${data.amount} ₽ → ${data.recipient_full_name}`);
      setRecipientPhone("");
      setAmount("");
      onTransferSuccess();
    } catch (error) {
      console.error(error);
      setMessage("Ошибка перевода");
    }
  };

  const saveFavorite = async () => {
    const normalizedPhone = normalizeRussianPhone(recipientPhone);

    const vt = validateRequired(templateName, "Название шаблона");
    if (vt) {
      setMessage(vt);
      return;
    }
    if (!recipientPhone) {
      setMessage("Укажите телефон получателя");
      return;
    }

    if (!isValidRussianPhone(normalizedPhone)) {
      setMessage("Введите корректный номер в формате РФ: +7XXXXXXXXXX");
      return;
    }

    const res = await apiFetch(`${API_BASE}/favorites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vk_id: senderVkId,
        template_name: templateName,
        payment_type: "phone_transfer",
        recipient_value: normalizedPhone,
      }),
    });

    const data = await res.json();
    if (data.error) {
      setMessage(data.error);
      return;
    }

    setMessage("Шаблон перевода сохранен");
    setTemplateName("");
    onFavoriteSaved();
  };

  return (
    <ScreenLayout title="Перевод по телефону">
      <div style={formCard}>
        <div style={inputLabel}>Телефон получателя</div>
        <input
          style={input}
          value={recipientPhone}
          onChange={(e) => setRecipientPhone(e.target.value)}
          onBlur={() => {
            if (recipientPhone) setRecipientPhone(normalizeRussianPhone(recipientPhone));
          }}
          placeholder="+79990001122"
        />

        <div style={inputLabel}>Сумма</div>
        <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" type="number" />

        <button style={primaryButton} onClick={sendTransfer}>
          Отправить перевод
        </button>

        <div style={inputLabel}>Название шаблона</div>
        <input style={input} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Перевод маме" />

        <button style={secondaryButton} onClick={saveFavorite}>
          Сохранить в избранное
        </button>

        {message && <div style={resultMessage}>{message}</div>}
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
                  {acc.account_name} · {Number(acc.balance).toLocaleString("ru-RU")} ₽
                </option>
              ))}
            </select>

            <div style={inputLabel}>Счет зачисления</div>
            <select style={input} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.account_name} · {Number(acc.balance).toLocaleString("ru-RU")} ₽
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
                  {acc.account_name} · {Number(acc.balance).toLocaleString("ru-RU")} ₽
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
    <div style={{ paddingBottom: "90px" }}>
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
  background: "#0b1220",
  color: "#eef4ff",
  minHeight: "100dvh",
  fontFamily: "system-ui, -apple-system, Segoe UI, Arial, sans-serif",
  padding: "clamp(12px, 3vw, 18px) clamp(12px, 4vw, 20px) calc(88px + env(safe-area-inset-bottom, 0px))",
  boxSizing: "border-box",
  width: "100%",
  maxWidth: "520px",
  margin: "0 auto",
};

const loading = {
  background: "#0b1220",
  color: "#eef4ff",
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "system-ui, -apple-system, Segoe UI, Arial, sans-serif",
  padding: "16px",
  textAlign: "center",
  boxSizing: "border-box",
};

const onboardingBanner = {
  background: "#27476b",
  color: "#fff",
  borderRadius: "16px",
  padding: "14px 16px",
  marginBottom: "14px",
  cursor: "pointer",
  textAlign: "center",
};

const topBadge = {
  width: "fit-content",
  margin: "0 auto 18px",
  background: "#16324f",
  color: "#d9ecff",
  fontWeight: "700",
  borderRadius: "999px",
  padding: "8px 18px",
  fontSize: "14px",
  border: "1px solid #23476d",
};

const header = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  marginBottom: "16px",
};

const headerActionsWrap = {
  display: "flex",
  gap: "8px",
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
  width: "54px",
  height: "54px",
  borderRadius: "50%",
  background: "linear-gradient(135deg, #27476b, #3d6797)",
  border: "1px solid #5d8fc8",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "24px",
  color: "#ffffff",
  flexShrink: 0,
};

const userName = {
  fontSize: "22px",
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
  background: "#121d2c",
  color: "#8191a6",
  borderRadius: "16px",
  padding: "14px 16px",
  fontSize: "16px",
  marginBottom: "18px",
  border: "1px solid #1e2f45",
  cursor: "pointer",
};

const storiesRow = {
  display: "flex",
  gap: "10px",
  overflowX: "auto",
  paddingBottom: "6px",
  marginBottom: "18px",
};

const storyCard = {
  minWidth: "120px",
  background: "linear-gradient(135deg, #18304d, #26486f)",
  borderRadius: "24px",
  padding: "18px 14px",
  fontSize: "14px",
  lineHeight: "1.3",
  border: "1px solid #355c88",
  boxSizing: "border-box",
  flexShrink: 0,
  color: "#eaf3ff",
  cursor: "pointer",
};

const grid2 = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "14px",
  marginBottom: "18px",
};

const infoCard = {
  background: "#121d2c",
  borderRadius: "24px",
  padding: "18px",
  minHeight: "150px",
  boxSizing: "border-box",
  cursor: "pointer",
  border: "1px solid #1f3248",
};

const cardTitle = {
  fontSize: "18px",
  fontWeight: "700",
  marginBottom: "10px",
};

const cardText = {
  color: "#a1b1c6",
  fontSize: "14px",
};

const bigText = {
  fontSize: "18px",
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
  background: "#121d2c",
  borderRadius: "20px",
  padding: "18px",
  border: "1px solid #1f3248",
};

const analyticsTotalLabel = {
  color: "#aab9cc",
  fontSize: "14px",
};

const analyticsTotalValue = {
  fontSize: "28px",
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
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "12px",
  marginBottom: "18px",
};

const actionItem = {
  textAlign: "center",
  cursor: "pointer",
};

const actionIcon = {
  background: "#121d2c",
  borderRadius: "18px",
  height: "62px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "24px",
  marginBottom: "8px",
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
  padding: "18px",
  marginBottom: "18px",
  cursor: "pointer",
  border: "1px solid #28476d",
};

const accountTop = {
  display: "flex",
  alignItems: "flex-start",
  gap: "12px",
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
  fontSize: "20px",
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
  padding: "18px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "18px",
  cursor: "pointer",
  border: "1px solid #406fa6",
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
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(14, 22, 34, 0.96)",
  borderTop: "1px solid #22354c",
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  padding: "10px 8px max(14px, env(safe-area-inset-bottom, 0px))",
  backdropFilter: "blur(10px)",
  maxWidth: "520px",
  margin: "0 auto",
  boxSizing: "border-box",
};

const navItem = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "4px",
  cursor: "pointer",
};

const navIcon = {
  fontSize: "20px",
};

const navLabel = {
  fontSize: "11px",
};

const screenTitle = {
  fontSize: "clamp(22px, 5.5vw, 28px)",
  fontWeight: "700",
  marginBottom: "18px",
};

const screenSubtitle = {
  fontSize: "20px",
  fontWeight: "700",
  marginTop: "6px",
  marginBottom: "4px",
};

const screenContent = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const menuCard = {
  background: "#121d2c",
  borderRadius: "20px",
  padding: "18px",
  cursor: "pointer",
  border: "1px solid #1f3248",
};

const menuCardTitle = {
  fontSize: "18px",
  fontWeight: "700",
  marginBottom: "6px",
};

const menuCardSubtitle = {
  color: "#aab9cc",
  fontSize: "14px",
};

const operationItem = {
  background: "#121d2c",
  borderRadius: "18px",
  padding: "16px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
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
  background: "#121d2c",
  padding: "14px 16px",
  borderRadius: "16px 16px 16px 6px",
  width: "fit-content",
  maxWidth: "80%",
  border: "1px solid #1f3248",
};

const chatBubbleUser = {
  background: "#2a5f96",
  padding: "14px 16px",
  borderRadius: "16px 16px 6px 16px",
  width: "fit-content",
  maxWidth: "80%",
  marginLeft: "auto",
};

const chatContainer = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  marginBottom: "70px",
};

const chatInputRow = {
  position: "fixed",
  bottom: "70px",
  left: 0,
  right: 0,
  padding: "10px",
  background: "#0b1220",
  display: "flex",
  gap: "10px",
};

const chatInputField = {
  flex: 1,
  padding: "12px",
  borderRadius: "12px",
  border: "1px solid #2b3f57",
  background: "#121d2c",
  color: "#fff",
};

const chatSendButton = {
  width: "50px",
  borderRadius: "12px",
  border: "none",
  background: "#2a5f96",
  color: "#fff",
  fontSize: "18px",
};

const emptyBlock = {
  background: "#121d2c",
  borderRadius: "18px",
  padding: "18px",
  color: "#a8b7ca",
  border: "1px solid #1f3248",
};

const applicationCard = {
  background: "#121d2c",
  borderRadius: "18px",
  padding: "16px",
  border: "1px solid #1f3248",
};

const formCard = {
  background: "#121d2c",
  borderRadius: "20px",
  padding: "18px",
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
  background: "#16293d",
  border: "1px solid #29476a",
  color: "#dcecff",
  borderRadius: "12px",
  padding: "14px",
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
