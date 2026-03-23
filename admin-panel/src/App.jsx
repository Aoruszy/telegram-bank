import { useEffect, useMemo, useState } from "react";
import { adminFetch, adminUrl } from "./api.js";

const STORAGE_KEYS = {
  apiBase: "bank_admin_api_base",
  apiKey: "bank_admin_api_key",
};

function readStorage(key, fallback = "") {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) || fallback;
}

function writeStorage(key, value) {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(key, value);
  } else {
    window.localStorage.removeItem(key);
  }
}

function normalizeBase(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function normalizeSecretValue(value) {
  const raw = String(value || "").trim();
  const prefixes = ["ADMIN_API_KEY=", "VITE_ADMIN_API_KEY="];
  for (const prefix of prefixes) {
    if (raw.startsWith(prefix)) {
      return raw.slice(prefix.length).trim();
    }
  }
  return raw;
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function App() {
  const defaultApiBase = normalizeBase(import.meta.env.VITE_ADMIN_API_BASE || "https://api.zf-bank.ru");
  const defaultApiKey = normalizeSecretValue(import.meta.env.VITE_ADMIN_API_KEY || "");

  const [apiBase, setApiBase] = useState(() => readStorage(STORAGE_KEYS.apiBase, defaultApiBase));
  const [apiKey, setApiKey] = useState(() =>
    normalizeSecretValue(readStorage(STORAGE_KEYS.apiKey, defaultApiKey))
  );
  const [activeTab, setActiveTab] = useState("overview");
  const [searchText, setSearchText] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [applications, setApplications] = useState([]);
  const [serviceRequests, setServiceRequests] = useState([]);
  const [supportMessages, setSupportMessages] = useState([]);
  const [selectedUserVkId, setSelectedUserVkId] = useState("");
  const [selectedUserData, setSelectedUserData] = useState(null);
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceComment, setBalanceComment] = useState("Пополнение администратором");
  const [supportReply, setSupportReply] = useState("");

  useEffect(() => {
    writeStorage(STORAGE_KEYS.apiBase, apiBase);
  }, [apiBase]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.apiKey, apiKey);
  }, [apiKey]);

  const request = async (path, init = {}) => {
    const base = normalizeBase(apiBase || defaultApiBase);
    const headers = { ...(init.headers || {}) };
    const key = normalizeSecretValue(apiKey || defaultApiKey);
    if (key) headers["X-Admin-Key"] = key;
    return adminFetch(adminUrl(path, base), { ...init, headers });
  };

  const loadStats = async () => {
    const res = await request("/admin/stats");
    const data = await res.json();
    setStats(data);
  };

  const loadUsers = async () => {
    const res = await request("/admin/users");
    const data = await res.json();
    setUsers(Array.isArray(data) ? data : []);
  };

  const loadApplications = async () => {
    const res = await request("/admin/applications");
    const data = await res.json();
    setApplications(Array.isArray(data) ? data : []);
  };

  const loadServiceRequests = async () => {
    const res = await request("/admin/service-requests");
    const data = await res.json();
    setServiceRequests(Array.isArray(data) ? data : []);
  };

  const loadSupportMessages = async () => {
    const res = await request("/admin/support-messages");
    const data = await res.json();
    setSupportMessages(Array.isArray(data) ? data : []);
  };

  const loadUserDetails = async (vkId, nextTab = "client") => {
    const res = await request(`/admin/users/${vkId}/full`);
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }
    setSelectedUserVkId(vkId);
    setSelectedUserData(data);
    setActiveTab(nextTab);
  };

  const refreshAll = async (focusVkId = "") => {
    setLoading(true);
    setMessage("");
    try {
      await Promise.all([loadStats(), loadUsers(), loadApplications(), loadServiceRequests(), loadSupportMessages()]);
      if (focusVkId) {
        await loadUserDetails(focusVkId, activeTab === "client" ? "client" : activeTab);
      } else if (selectedUserVkId) {
        await loadUserDetails(selectedUserVkId, activeTab === "client" ? "client" : activeTab);
      }
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Не удалось загрузить данные админки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const approveApplication = async (id) => {
    try {
      const res = await request(`/admin/applications/${id}/approve`, { method: "POST" });
      const data = await res.json();
      setMessage(data.message || "Заявка одобрена");
      await refreshAll(selectedUserVkId);
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Не удалось одобрить заявку");
    }
  };

  const rejectApplication = async (id) => {
    try {
      const res = await request(`/admin/applications/${id}/reject`, { method: "POST" });
      const data = await res.json();
      setMessage(data.message || "Заявка отклонена");
      await refreshAll(selectedUserVkId);
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Не удалось отклонить заявку");
    }
  };

  const updateServiceRequestStatus = async (id, status) => {
    try {
      const res = await request(`/admin/service-requests/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      setMessage(data.message || "Статус обновлён");
      await refreshAll(selectedUserVkId);
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Не удалось обновить статус");
    }
  };

  const addBalance = async () => {
    if (!selectedUserVkId || !balanceAmount) {
      setMessage("Выберите клиента и укажите сумму");
      return;
    }

    try {
      const res = await request(`/admin/users/${selectedUserVkId}/add-balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(balanceAmount),
          comment: balanceComment || "Пополнение администратором",
        }),
      });
      const data = await res.json();
      setMessage(data.message || "Баланс пополнен");
      setBalanceAmount("");
      await refreshAll(selectedUserVkId);
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Не удалось пополнить баланс");
    }
  };

  const sendSupportReply = async () => {
    if (!selectedUserVkId || !supportReply.trim()) {
      setMessage("Выберите клиента и введите ответ для чата");
      return;
    }

    try {
      const res = await request(`/admin/users/${selectedUserVkId}/support-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: supportReply.trim() }),
      });
      const data = await res.json();
      setMessage(data.message || "Ответ отправлен");
      setSupportReply("");
      await refreshAll(selectedUserVkId);
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Не удалось отправить ответ");
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const haystack = `${user.full_name} ${user.vk_id} ${user.phone || ""}`.toLowerCase();
      return haystack.includes(searchText.toLowerCase());
    });
  }, [users, searchText]);

  const filteredApplications = useMemo(() => {
    return applications.filter((item) => {
      const haystack = `${item.product_type} ${item.user_full_name} ${item.user_vk_id} ${item.status}`.toLowerCase();
      return haystack.includes(searchText.toLowerCase());
    });
  }, [applications, searchText]);

  const filteredRequests = useMemo(() => {
    return serviceRequests.filter((item) => {
      const haystack = `${item.request_type} ${item.user_full_name} ${item.user_vk_id} ${item.status}`.toLowerCase();
      return haystack.includes(searchText.toLowerCase());
    });
  }, [serviceRequests, searchText]);

  const filteredSupportMessages = useMemo(() => {
    return supportMessages.filter((item) => {
      const haystack = `${item.user_full_name} ${item.user_vk_id} ${item.sender_type} ${item.message}`.toLowerCase();
      return haystack.includes(searchText.toLowerCase());
    });
  }, [supportMessages, searchText]);

  const totalPending = (stats?.pending_applications || 0) + (stats?.requests_created || 0);

  return (
    <div style={page}>
      <aside style={sidebar}>
        <div style={brandBlock}>
          <div style={brandBadge}>ZF</div>
          <div>
            <div style={brandTitle}>Control Center</div>
            <div style={brandSubtitle}>Операции, клиенты, заявки и сервисы</div>
          </div>
        </div>

        <div style={configCard}>
          <div style={panelTitle}>Подключение</div>
          <label style={fieldLabel}>
            API URL
            <input
              style={input}
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="https://api.zf-bank.ru"
            />
          </label>
          <label style={fieldLabel}>
            Admin API Key
            <input
              style={input}
              value={apiKey}
              onChange={(e) => setApiKey(normalizeSecretValue(e.target.value))}
              placeholder="Введите ключ админки"
              type="password"
            />
          </label>
          <button style={primaryButton} onClick={() => refreshAll()}>
            {loading ? "Синхронизация..." : "Обновить данные"}
          </button>
        </div>

        <div style={kpiStack}>
          <KpiCard label="Клиенты" value={stats?.users_count ?? users.length} accent="#7ab8ff" />
          <KpiCard label="Баланс системы" value={`${formatMoney(stats?.total_balance)} ₽`} accent="#8be28b" />
          <KpiCard label="Нужно внимания" value={totalPending} accent="#ffbc6d" />
        </div>

        <div style={navStack}>
          <NavButton active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
            Дашборд
          </NavButton>
          <NavButton active={activeTab === "users"} onClick={() => setActiveTab("users")}>
            Пользователи
          </NavButton>
          <NavButton active={activeTab === "applications"} onClick={() => setActiveTab("applications")}>
            Заявки
          </NavButton>
          <NavButton active={activeTab === "requests"} onClick={() => setActiveTab("requests")}>
            Запросы
          </NavButton>
          <NavButton active={activeTab === "support"} onClick={() => setActiveTab("support")}>
            AI-поддержка
          </NavButton>
          <NavButton active={activeTab === "client"} onClick={() => setActiveTab("client")} disabled={!selectedUserData}>
            Карточка клиента
          </NavButton>
        </div>
      </aside>

      <main style={content}>
        <section style={hero}>
          <div>
            <div style={heroEyebrow}>Админ-панель банка</div>
            <h1 style={heroTitle}>Управляйте клиентами, заявками и деньгами из одного экрана</h1>
            <p style={heroText}>
              Панель обновляет статус заявок, сервисных запросов и карточек клиентов без лишней ручной рутины.
            </p>
          </div>
          <div style={heroActions}>
            <button style={ghostButton} onClick={() => refreshAll()}>
              {loading ? "Синхронизация..." : "Синхронизировать"}
            </button>
            <button style={secondaryButton} onClick={() => setActiveTab("users")}>
              Открыть клиентов
            </button>
          </div>
        </section>

        {message ? <div style={messageBox}>{message}</div> : null}

        {(activeTab === "users" || activeTab === "applications" || activeTab === "requests" || activeTab === "support") && (
          <div style={searchRow}>
            <input
              style={searchInput}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Поиск по имени, VK ID, статусу, продукту или сообщению"
            />
          </div>
        )}

        {activeTab === "overview" && (
          <>
            <section style={overviewGrid}>
              <KpiPanel title="Всего счетов" value={stats?.accounts_count ?? 0} description="Активные клиентские счета" />
              <KpiPanel title="Карт выпущено" value={stats?.cards_count ?? 0} description="Физические и виртуальные карты" />
              <KpiPanel title="Операций" value={stats?.operations_count ?? 0} description="История транзакций" />
              <KpiPanel title="Сервисные запросы" value={stats?.service_requests_count ?? 0} description="Открытые и завершённые обращения" />
              <KpiPanel title="Сообщений поддержки" value={stats?.support_messages_count ?? 0} description="Диалоги клиента, AI и операторов" />
              <KpiPanel title="AI-ответов" value={stats?.ai_messages_count ?? 0} description="Реплики Gemma в чатах поддержки" />
            </section>

            <section style={dashboardTwoColumn}>
              <div style={surfaceCard}>
                <div style={panelTitle}>Очередь заявок</div>
                <div style={statusList}>
                  <StatusRow label="На рассмотрении" value={stats?.pending_applications ?? 0} />
                  <StatusRow label="Одобрено" value={stats?.approved_applications ?? 0} />
                  <StatusRow label="Отклонено" value={stats?.rejected_applications ?? 0} />
                </div>
              </div>
              <div style={surfaceCard}>
                <div style={panelTitle}>Сервисные запросы</div>
                <div style={statusList}>
                  <StatusRow label="Создано" value={stats?.requests_created ?? 0} />
                  <StatusRow label="В обработке" value={stats?.requests_in_progress ?? 0} />
                  <StatusRow label="Выполнено" value={stats?.requests_done ?? 0} />
                  <StatusRow label="Отклонено" value={stats?.requests_rejected ?? 0} />
                  <StatusRow label="Создано AI" value={stats?.ai_escalations_count ?? 0} />
                </div>
              </div>
            </section>
          </>
        )}

        {activeTab === "users" && (
          <section style={listGrid}>
            {filteredUsers.length === 0 ? (
              <div style={emptyState}>Пользователи не найдены. Проверьте API-ключ, API URL и наличие клиентов в базе.</div>
            ) : (
              filteredUsers.map((user) => (
                <article key={user.id} style={userCard}>
                  <div style={userCardTop}>
                    <div style={userAvatar}>{(user.full_name || "U")[0]}</div>
                    <div>
                      <div style={userCardTitle}>{user.full_name}</div>
                      <div style={mutedText}>VK ID: {user.vk_id}</div>
                    </div>
                  </div>

                  <div style={infoGrid}>
                    <InfoChip label="Телефон" value={user.phone || "Не указан"} />
                    <InfoChip label="Счета" value={user.accounts_count} />
                    <InfoChip label="Карты" value={user.cards_count} />
                    <InfoChip label="Заявки" value={user.applications_count} />
                  </div>

                  <div style={mutedText}>Создан: {user.created_at || "Нет даты"}</div>

                  <button style={primaryButton} onClick={() => loadUserDetails(user.vk_id)}>
                    Открыть карточку клиента
                  </button>
                </article>
              ))
            )}
          </section>
        )}

        {activeTab === "applications" && (
          <section style={stack}>
            {filteredApplications.length === 0 ? (
              <div style={emptyState}>Заявки не найдены</div>
            ) : (
              filteredApplications.map((item) => (
                <article key={item.id} style={surfaceCard}>
                  <div style={cardHeaderRow}>
                    <div>
                      <div style={panelTitle}>{item.product_type}</div>
                      <div style={mutedText}>{item.user_full_name} • {item.user_vk_id}</div>
                    </div>
                    <StatusPill>{item.status}</StatusPill>
                  </div>
                  <div style={mutedText}>Создано: {item.created_at}</div>
                  <div style={detailsBox}>{item.details}</div>
                  {item.status === "На рассмотрении" ? (
                    <div style={actionRow}>
                      <button style={primaryButton} onClick={() => approveApplication(item.id)}>Одобрить</button>
                      <button style={dangerButton} onClick={() => rejectApplication(item.id)}>Отклонить</button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </section>
        )}

        {activeTab === "requests" && (
          <section style={stack}>
            {filteredRequests.length === 0 ? (
              <div style={emptyState}>Сервисные запросы не найдены</div>
            ) : (
              filteredRequests.map((item) => (
                <article key={item.id} style={surfaceCard}>
                  <div style={cardHeaderRow}>
                    <div>
                      <div style={panelTitle}>{item.request_type}</div>
                      <div style={mutedText}>{item.user_full_name} • {item.user_vk_id}</div>
                    </div>
                    <StatusPill>{item.status}</StatusPill>
                  </div>
                  <div style={mutedText}>Создано: {item.created_at}</div>
                  <div style={detailsBox}>{item.details}</div>
                  <div style={actionRow}>
                    <button style={ghostButton} onClick={() => updateServiceRequestStatus(item.id, "В обработке")}>
                      В обработке
                    </button>
                    <button style={secondaryButton} onClick={() => updateServiceRequestStatus(item.id, "Выполнен")}>
                      Выполнен
                    </button>
                    <button style={dangerButton} onClick={() => updateServiceRequestStatus(item.id, "Отклонен")}>
                      Отклонен
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        )}

        {activeTab === "support" && (
          <section style={stack}>
            {filteredSupportMessages.length === 0 ? (
              <div style={emptyState}>Сообщения AI-поддержки не найдены</div>
            ) : (
              filteredSupportMessages.map((item) => (
                <article key={item.id} style={surfaceCard}>
                  <div style={cardHeaderRow}>
                    <div>
                      <div style={panelTitle}>
                        {item.sender_type === "ai"
                          ? "AI-помощник"
                          : item.sender_type === "admin"
                            ? "Оператор"
                            : "Клиент"}
                      </div>
                      <div style={mutedText}>{item.user_full_name} • {item.user_vk_id}</div>
                    </div>
                    <StatusPill>{item.created_at}</StatusPill>
                  </div>
                  <div style={detailsBox}>{item.message}</div>
                  <div style={actionRow}>
                    <button style={secondaryButton} onClick={() => loadUserDetails(item.user_vk_id, "client")}>
                      Открыть карточку клиента
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        )}

        {activeTab === "client" && (
          <section style={clientLayout}>
            {!selectedUserData ? (
              <div style={emptyState}>Выберите клиента в разделе «Пользователи».</div>
            ) : (
              <>
                <div style={clientMain}>
                  <div style={surfaceCard}>
                    <div style={cardHeaderRow}>
                      <div>
                        <div style={panelTitle}>{selectedUserData.user.full_name}</div>
                        <div style={mutedText}>VK ID: {selectedUserData.user.vk_id}</div>
                      </div>
                      <StatusPill>{selectedUserData.user.phone || "Нет телефона"}</StatusPill>
                    </div>
                    <div style={infoGrid}>
                      <InfoChip label="Телефон" value={selectedUserData.user.phone || "Не указан"} />
                      <InfoChip label="Дата регистрации" value={selectedUserData.user.created_at || "Нет даты"} />
                      <InfoChip label="Счетов" value={selectedUserData.accounts.length} />
                      <InfoChip label="Карт" value={selectedUserData.cards.length} />
                    </div>
                  </div>

                  <div style={surfaceCard}>
                    <div style={panelTitle}>Счета</div>
                    <div style={miniGrid}>
                      {selectedUserData.accounts.length === 0 ? (
                        <div style={emptyStateCompact}>У клиента пока нет счетов</div>
                      ) : (
                        selectedUserData.accounts.map((acc) => (
                          <div key={acc.id} style={miniCard}>
                            <div style={panelTitle}>{acc.account_name}</div>
                            <div style={moneyValue}>{formatMoney(acc.balance)} ₽</div>
                            <div style={mutedText}>{acc.currency} • {acc.status}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div style={surfaceCard}>
                    <div style={panelTitle}>Карты</div>
                    <div style={miniGrid}>
                      {selectedUserData.cards.length === 0 ? (
                        <div style={emptyStateCompact}>Карт пока нет</div>
                      ) : (
                        selectedUserData.cards.map((card) => (
                          <div key={card.id} style={miniCard}>
                            <div style={panelTitle}>{card.card_name}</div>
                            <div style={mutedText}>{card.card_number_mask}</div>
                            <div style={mutedText}>{card.expiry_date} • {card.status}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div style={surfaceCard}>
                    <div style={panelTitle}>Последние операции</div>
                    <div style={stackCompact}>
                      {selectedUserData.operations?.length ? (
                        selectedUserData.operations.map((item) => (
                          <div key={item.id} style={miniCard}>
                            <div style={cardHeaderRow}>
                              <div>
                                <div style={panelTitle}>{item.title}</div>
                                <div style={mutedText}>{item.created_at}</div>
                              </div>
                              <StatusPill>
                                {item.operation_type === "income" ? "+" : "-"}
                                {formatMoney(item.amount)} ₽
                              </StatusPill>
                            </div>
                            <div style={mutedText}>
                              {item.category} • {item.operation_type}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div style={emptyStateCompact}>Операций пока нет</div>
                      )}
                    </div>
                  </div>
                </div>

                <div style={clientSide}>
                  <div style={surfaceCard}>
                    <div style={panelTitle}>Пополнить баланс</div>
                    <label style={fieldLabel}>
                      Сумма
                      <input
                        style={input}
                        value={balanceAmount}
                        onChange={(e) => setBalanceAmount(e.target.value)}
                        placeholder="10000"
                        type="number"
                      />
                    </label>
                    <label style={fieldLabel}>
                      Комментарий
                      <input
                        style={input}
                        value={balanceComment}
                        onChange={(e) => setBalanceComment(e.target.value)}
                        placeholder="Пополнение администратором"
                      />
                    </label>
                    <button style={primaryButton} onClick={addBalance}>
                      Пополнить баланс
                    </button>
                  </div>

                  <div style={surfaceCard}>
                    <div style={panelTitle}>Последние заявки</div>
                    <div style={stackCompact}>
                      {selectedUserData.applications.length === 0 ? (
                        <div style={emptyStateCompact}>Нет заявок</div>
                      ) : (
                        selectedUserData.applications.slice(0, 4).map((item) => (
                          <div key={item.id} style={miniCard}>
                            <div style={panelTitle}>{item.product_type}</div>
                            <div style={mutedText}>{item.status}</div>
                            <div style={mutedText}>{item.created_at}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div style={surfaceCard}>
                    <div style={panelTitle}>Диалог поддержки</div>
                    <div style={stackCompact}>
                      {selectedUserData.support_messages?.length ? (
                        selectedUserData.support_messages.map((item) => (
                          <div key={item.id} style={miniCard}>
                            <div style={cardHeaderRow}>
                              <div style={panelTitle}>
                                {item.sender_type === "ai"
                                  ? "AI-помощник"
                                  : item.sender_type === "admin"
                                    ? "Оператор"
                                    : "Клиент"}
                              </div>
                              <div style={mutedText}>{item.created_at}</div>
                            </div>
                            <div style={mutedText}>{item.message}</div>
                          </div>
                        ))
                      ) : (
                        <div style={emptyStateCompact}>Диалогов пока нет</div>
                      )}
                    </div>
                    <div style={{ ...stackCompact, marginTop: 16 }}>
                      <label style={fieldLabel}>
                        Ответ оператора
                        <textarea
                          style={{ ...input, minHeight: 120, resize: "vertical" }}
                          value={supportReply}
                          onChange={(e) => setSupportReply(e.target.value)}
                          placeholder="Напишите ответ клиенту. Он увидит его в том же чате после AI-помощника."
                        />
                      </label>
                      <button style={primaryButton} onClick={sendSupportReply}>
                        Отправить ответ в чат
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function NavButton({ children, active, onClick, disabled = false }) {
  return (
    <button
      style={{
        ...navButton,
        background: active ? "linear-gradient(135deg, #2b6bb0, #4b89c9)" : "rgba(19, 31, 49, 0.88)",
        opacity: disabled ? 0.45 : 1,
      }}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function KpiCard({ label, value, accent }) {
  return (
    <div style={{ ...kpiCard, borderColor: accent }}>
      <div style={kpiLabel}>{label}</div>
      <div style={kpiValue}>{value}</div>
    </div>
  );
}

function KpiPanel({ title, value, description }) {
  return (
    <div style={surfaceCard}>
      <div style={panelTitle}>{title}</div>
      <div style={heroMetric}>{value}</div>
      <div style={mutedText}>{description}</div>
    </div>
  );
}

function StatusRow({ label, value }) {
  return (
    <div style={statusRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InfoChip({ label, value }) {
  return (
    <div style={infoChip}>
      <div style={infoChipLabel}>{label}</div>
      <div style={infoChipValue}>{value}</div>
    </div>
  );
}

function StatusPill({ children }) {
  return <div style={statusPill}>{children}</div>;
}

const page = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, rgba(88, 153, 255, 0.14), transparent 18%), linear-gradient(180deg, #08111d 0%, #0d1725 100%)",
  color: "#eef4ff",
  display: "grid",
  gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)",
  gap: "24px",
  padding: "24px",
  boxSizing: "border-box",
};

const sidebar = {
  display: "flex",
  flexDirection: "column",
  gap: "18px",
  position: "sticky",
  top: "24px",
  alignSelf: "start",
};

const content = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  minWidth: 0,
};

const brandBlock = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  background: "linear-gradient(180deg, rgba(18, 28, 43, 0.96) 0%, rgba(15, 24, 38, 0.96) 100%)",
  borderRadius: "26px",
  padding: "18px 20px",
  border: "1px solid rgba(97, 144, 204, 0.26)",
  boxShadow: "0 18px 40px rgba(7, 12, 20, 0.22)",
};

const brandBadge = {
  width: "54px",
  height: "54px",
  borderRadius: "18px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(135deg, #2a6eb5, #5a98db)",
  color: "#fff",
  fontSize: "22px",
  fontWeight: "700",
  flexShrink: 0,
};

const brandTitle = {
  fontSize: "24px",
  fontWeight: "700",
};

const brandSubtitle = {
  color: "#9fb3c8",
  fontSize: "14px",
  marginTop: "4px",
  lineHeight: "1.5",
};

const configCard = {
  background: "rgba(17, 26, 40, 0.94)",
  borderRadius: "24px",
  padding: "18px",
  border: "1px solid rgba(79, 119, 170, 0.22)",
  boxShadow: "0 18px 32px rgba(7, 12, 20, 0.18)",
};

const panelTitle = {
  fontSize: "18px",
  fontWeight: "700",
  marginBottom: "10px",
};

const fieldLabel = {
  display: "grid",
  gap: "8px",
  fontSize: "14px",
  color: "#b7c9dd",
  marginBottom: "12px",
};

const input = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(12, 21, 34, 0.95)",
  color: "#eef4ff",
  border: "1px solid #284666",
  borderRadius: "16px",
  padding: "14px 16px",
  outline: "none",
};

const kpiStack = {
  display: "grid",
  gap: "12px",
};

const kpiCard = {
  background: "rgba(17, 26, 40, 0.94)",
  borderRadius: "20px",
  padding: "16px 18px",
  border: "1px solid rgba(97, 144, 204, 0.24)",
};

const kpiLabel = {
  color: "#9fb3c8",
  fontSize: "13px",
  marginBottom: "8px",
};

const kpiValue = {
  fontSize: "24px",
  fontWeight: "700",
};

const navStack = {
  display: "grid",
  gap: "10px",
};

const navButton = {
  border: "1px solid rgba(97, 144, 204, 0.24)",
  color: "#fff",
  borderRadius: "18px",
  padding: "14px 16px",
  textAlign: "left",
  cursor: "pointer",
};

const hero = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "20px",
  alignItems: "end",
  background: "linear-gradient(135deg, rgba(18, 29, 44, 0.96) 0%, rgba(26, 52, 83, 0.92) 100%)",
  borderRadius: "32px",
  padding: "28px 30px",
  border: "1px solid rgba(98, 145, 205, 0.24)",
  boxShadow: "0 24px 52px rgba(7, 12, 20, 0.2)",
};

const heroEyebrow = {
  color: "#9bc7ff",
  fontSize: "12px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  marginBottom: "10px",
};

const heroTitle = {
  margin: 0,
  fontSize: "clamp(28px, 4vw, 46px)",
  lineHeight: "1.08",
};

const heroText = {
  margin: "12px 0 0",
  color: "#bfd0e4",
  fontSize: "15px",
  maxWidth: "740px",
  lineHeight: "1.6",
};

const heroActions = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  justifyContent: "flex-end",
};

const searchRow = {
  display: "flex",
};

const searchInput = {
  ...input,
  fontSize: "15px",
};

const messageBox = {
  background: "rgba(32, 55, 82, 0.92)",
  border: "1px solid rgba(97, 144, 204, 0.3)",
  color: "#dcecff",
  borderRadius: "18px",
  padding: "14px 16px",
};

const overviewGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "16px",
};

const dashboardTwoColumn = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "16px",
};

const surfaceCard = {
  background: "rgba(17, 26, 40, 0.94)",
  borderRadius: "24px",
  padding: "20px",
  border: "1px solid rgba(79, 119, 170, 0.22)",
  boxShadow: "0 18px 32px rgba(7, 12, 20, 0.16)",
};

const heroMetric = {
  fontSize: "clamp(28px, 4vw, 40px)",
  fontWeight: "700",
  marginBottom: "8px",
};

const mutedText = {
  color: "#9fb3c8",
  fontSize: "14px",
  lineHeight: "1.5",
};

const statusList = {
  display: "grid",
  gap: "10px",
};

const statusRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: "14px",
  padding: "12px 0",
  borderBottom: "1px solid rgba(59, 88, 122, 0.38)",
};

const listGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "16px",
};

const userCard = {
  background: "rgba(17, 26, 40, 0.94)",
  borderRadius: "24px",
  padding: "20px",
  border: "1px solid rgba(79, 119, 170, 0.22)",
  boxShadow: "0 18px 32px rgba(7, 12, 20, 0.16)",
  display: "grid",
  gap: "14px",
};

const userCardTop = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
};

const userAvatar = {
  width: "52px",
  height: "52px",
  borderRadius: "16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(135deg, #2a6eb5, #5a98db)",
  fontSize: "22px",
  fontWeight: "700",
  flexShrink: 0,
};

const userCardTitle = {
  fontSize: "20px",
  fontWeight: "700",
};

const infoGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "10px",
};

const infoChip = {
  background: "rgba(12, 21, 34, 0.95)",
  border: "1px solid rgba(59, 88, 122, 0.38)",
  borderRadius: "18px",
  padding: "12px 14px",
};

const infoChipLabel = {
  color: "#8fa6bd",
  fontSize: "12px",
  marginBottom: "6px",
};

const infoChipValue = {
  color: "#eef4ff",
  fontSize: "14px",
  fontWeight: "600",
};

const stack = {
  display: "grid",
  gap: "16px",
};

const cardHeaderRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "flex-start",
  flexWrap: "wrap",
  marginBottom: "10px",
};

const statusPill = {
  background: "rgba(43, 107, 176, 0.18)",
  color: "#bfe0ff",
  border: "1px solid rgba(83, 145, 211, 0.35)",
  borderRadius: "999px",
  padding: "8px 12px",
  fontSize: "12px",
  fontWeight: "700",
};

const detailsBox = {
  background: "rgba(12, 21, 34, 0.92)",
  border: "1px solid rgba(59, 88, 122, 0.32)",
  borderRadius: "18px",
  padding: "14px 16px",
  color: "#dcecff",
  lineHeight: "1.55",
  marginTop: "10px",
};

const actionRow = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  marginTop: "16px",
};

const clientLayout = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.4fr) minmax(300px, 0.9fr)",
  gap: "16px",
};

const clientMain = {
  display: "grid",
  gap: "16px",
};

const clientSide = {
  display: "grid",
  gap: "16px",
  alignSelf: "start",
};

const miniGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const miniCard = {
  background: "rgba(12, 21, 34, 0.95)",
  border: "1px solid rgba(59, 88, 122, 0.38)",
  borderRadius: "18px",
  padding: "14px 16px",
};

const stackCompact = {
  display: "grid",
  gap: "10px",
};

const emptyState = {
  background: "rgba(17, 26, 40, 0.94)",
  borderRadius: "24px",
  padding: "24px",
  border: "1px dashed rgba(91, 134, 190, 0.34)",
  color: "#a8b7ca",
  lineHeight: "1.6",
};

const emptyStateCompact = {
  ...miniCard,
  color: "#a8b7ca",
};

const moneyValue = {
  fontSize: "22px",
  fontWeight: "700",
  margin: "6px 0",
};

const primaryButton = {
  background: "linear-gradient(135deg, #2b6bb0, #4b89c9)",
  color: "#fff",
  border: "none",
  borderRadius: "16px",
  padding: "14px 18px",
  cursor: "pointer",
};

const secondaryButton = {
  background: "rgba(29, 55, 84, 0.94)",
  color: "#e4f1ff",
  border: "1px solid rgba(97, 144, 204, 0.26)",
  borderRadius: "16px",
  padding: "14px 18px",
  cursor: "pointer",
};

const ghostButton = {
  background: "rgba(12, 21, 34, 0.78)",
  color: "#dcecff",
  border: "1px solid rgba(97, 144, 204, 0.26)",
  borderRadius: "16px",
  padding: "14px 18px",
  cursor: "pointer",
};

const dangerButton = {
  background: "linear-gradient(135deg, #8f3040, #b65062)",
  color: "#fff",
  border: "none",
  borderRadius: "16px",
  padding: "14px 18px",
  cursor: "pointer",
};

export default App;
