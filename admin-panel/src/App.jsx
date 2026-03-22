import { useEffect, useMemo, useState } from "react";
import { adminFetch, adminUrl } from "./api.js";

function App() {
  const [activeTab, setActiveTab] = useState("stats");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [applications, setApplications] = useState([]);
  const [serviceRequests, setServiceRequests] = useState([]);
  const [selectedUserVkId, setSelectedUserVkId] = useState("");
  const [selectedUserData, setSelectedUserData] = useState(null);
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceComment, setBalanceComment] = useState("Пополнение администратором");
  const [searchText, setSearchText] = useState("");
  const [message, setMessage] = useState("");

  const loadStats = async () => {
    try {
      const res = await adminFetch(adminUrl("/admin/stats"));
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error(err);
      setMessage(`Не удалось загрузить статистику: ${err.message}`);
    }
  };

  const loadUsers = async () => {
    try {
      const res = await adminFetch(adminUrl("/admin/users"));
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setUsers([]);
      setMessage(`Не удалось загрузить пользователей: ${err.message}`);
    }
  };

  const loadApplications = async () => {
    try {
      const res = await adminFetch(adminUrl("/admin/applications"));
      const data = await res.json();
      setApplications(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setApplications([]);
      setMessage(`Не удалось загрузить заявки: ${err.message}`);
    }
  };

  const loadServiceRequests = async () => {
    try {
      const res = await adminFetch(adminUrl("/admin/service-requests"));
      const data = await res.json();
      setServiceRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setServiceRequests([]);
      setMessage(`Не удалось загрузить сервисные запросы: ${err.message}`);
    }
  };

  const loadUserDetails = async (vkId) => {
    try {
      const res = await adminFetch(adminUrl(`/admin/users/${vkId}/full`));
      const data = await res.json();

      if (data.error) {
        setMessage(data.error);
        return;
      }

      setSelectedUserVkId(vkId);
      setSelectedUserData(data);
      setActiveTab("userDetails");
    } catch (err) {
      console.error(err);
      setMessage("Ошибка загрузки пользователя");
    }
  };

  const refreshAll = async () => {
    await Promise.all([loadStats(), loadUsers(), loadApplications(), loadServiceRequests()]);
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const approveApplication = async (id) => {
    try {
      const res = await adminFetch(adminUrl(`/admin/applications/${id}/approve`), {
        method: "POST",
      });
      const data = await res.json();
      setMessage(data.message || data.error || "Готово");
      await refreshAll();
      if (selectedUserVkId) {
        await loadUserDetails(selectedUserVkId);
      }
    } catch (err) {
      console.error(err);
      setMessage("Ошибка одобрения заявки");
    }
  };

  const rejectApplication = async (id) => {
    try {
      const res = await adminFetch(adminUrl(`/admin/applications/${id}/reject`), {
        method: "POST",
      });
      const data = await res.json();
      setMessage(data.message || data.error || "Готово");
      await refreshAll();
      if (selectedUserVkId) {
        await loadUserDetails(selectedUserVkId);
      }
    } catch (err) {
      console.error(err);
      setMessage("Ошибка отклонения заявки");
    }
  };

  const updateServiceRequestStatus = async (id, status) => {
    try {
      const res = await adminFetch(adminUrl(`/admin/service-requests/${id}/status`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      setMessage(data.message || data.error || "Готово");
      await refreshAll();
      if (selectedUserVkId) {
        await loadUserDetails(selectedUserVkId);
      }
    } catch (err) {
      console.error(err);
      setMessage("Ошибка обновления статуса");
    }
  };

  const addBalance = async () => {
    if (!selectedUserVkId || !balanceAmount) {
      setMessage("Выбери пользователя и укажи сумму");
      return;
    }

    try {
      const res = await adminFetch(
        adminUrl(`/admin/users/${selectedUserVkId}/add-balance`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            amount: Number(balanceAmount),
            comment: balanceComment || "Пополнение администратором",
          }),
        }
      );

      const data = await res.json();
      setMessage(data.message || data.error || "Готово");

      if (!data.error) {
        setBalanceAmount("");
        await refreshAll();
        await loadUserDetails(selectedUserVkId);
      }
    } catch (err) {
      console.error(err);
      setMessage("Ошибка пополнения баланса");
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const text = `${user.full_name} ${user.vk_id} ${user.phone || ""}`.toLowerCase();
      return text.includes(searchText.toLowerCase());
    });
  }, [users, searchText]);

  const filteredApplications = useMemo(() => {
    return applications.filter((item) => {
      const text = `${item.product_type} ${item.user_full_name} ${item.user_vk_id} ${item.status}`.toLowerCase();
      return text.includes(searchText.toLowerCase());
    });
  }, [applications, searchText]);

  const filteredRequests = useMemo(() => {
    return serviceRequests.filter((item) => {
      const text = `${item.request_type} ${item.user_full_name} ${item.user_vk_id} ${item.status}`.toLowerCase();
      return text.includes(searchText.toLowerCase());
    });
  }, [serviceRequests, searchText]);

  return (
    <div style={page}>
      <div style={header}>
        <div>
          <div style={title}>Админ-панель банка</div>
          <div style={subtitle}>Управление пользователями, заявками, запросами и статистикой</div>
        </div>
      </div>

      <div style={tabsRow}>
        <TabButton
          active={activeTab === "stats"}
          onClick={() => setActiveTab("stats")}
          text="Статистика"
        />
        <TabButton
          active={activeTab === "users"}
          onClick={() => setActiveTab("users")}
          text="Пользователи"
        />
        <TabButton
          active={activeTab === "applications"}
          onClick={() => setActiveTab("applications")}
          text="Заявки"
        />
        <TabButton
          active={activeTab === "requests"}
          onClick={() => setActiveTab("requests")}
          text="Запросы"
        />
        <TabButton
          active={activeTab === "userDetails"}
          onClick={() => setActiveTab("userDetails")}
          text="Карточка клиента"
          disabled={!selectedUserData}
        />
      </div>

      {activeTab !== "stats" && (
        <div style={searchWrap}>
          <input
            style={searchInput}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Поиск по имени, VK id, статусу..."
          />
        </div>
      )}

      {message && <div style={messageBox}>{message}</div>}

      {activeTab === "stats" && (
        <div>
          <div style={sectionTitle}>Общая статистика системы</div>

          <div style={statsGrid}>
            <StatCard title="Клиенты" value={stats?.users_count ?? 0} />
            <StatCard title="Счета" value={stats?.accounts_count ?? 0} />
            <StatCard title="Карты" value={stats?.cards_count ?? 0} />
            <StatCard title="Операции" value={stats?.operations_count ?? 0} />
            <StatCard title="Заявки" value={stats?.applications_count ?? 0} />
            <StatCard title="Сервисные запросы" value={stats?.service_requests_count ?? 0} />
          </div>

          <div style={card}>
            <div style={cardTitle}>Общий баланс всех счетов</div>
            <div style={bigStatValue}>
              {Number(stats?.total_balance || 0).toLocaleString("ru-RU", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} ₽
            </div>
          </div>

          <div style={sectionTitle}>Статусы заявок</div>
          <div style={statsGrid}>
            <StatCard title="На рассмотрении" value={stats?.pending_applications ?? 0} />
            <StatCard title="Одобрено" value={stats?.approved_applications ?? 0} />
            <StatCard title="Отклонено" value={stats?.rejected_applications ?? 0} />
          </div>

          <div style={sectionTitle}>Статусы сервисных запросов</div>
          <div style={statsGrid}>
            <StatCard title="Создан" value={stats?.requests_created ?? 0} />
            <StatCard title="В обработке" value={stats?.requests_in_progress ?? 0} />
            <StatCard title="Выполнен" value={stats?.requests_done ?? 0} />
            <StatCard title="Отклонен" value={stats?.requests_rejected ?? 0} />
          </div>
        </div>
      )}

      {activeTab === "users" && (
        <div style={grid}>
          {filteredUsers.length === 0 ? (
            <div style={emptyBlock}>Пользователи не найдены</div>
          ) : (
            filteredUsers.map((user) => (
              <div key={user.id} style={card}>
                <div style={cardTitle}>{user.full_name}</div>
                <div style={meta}>VK ID: {user.vk_id}</div>
                <div style={meta}>Телефон: {user.phone || "Не указан"}</div>
                <div style={meta}>Счетов: {user.accounts_count}</div>
                <div style={meta}>Карт: {user.cards_count}</div>
                <div style={meta}>Заявок: {user.applications_count}</div>
                <div style={meta}>Создан: {user.created_at || "Нет данных"}</div>

                <button
                  style={primaryButton}
                  onClick={() => loadUserDetails(user.vk_id)}
                >
                  Открыть карточку клиента
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "applications" && (
        <div style={listWrap}>
          {filteredApplications.length === 0 ? (
            <div style={emptyBlock}>Заявки не найдены</div>
          ) : (
            filteredApplications.map((item) => (
              <div key={item.id} style={card}>
                <div style={cardTitle}>{item.product_type}</div>
                <div style={meta}>Клиент: {item.user_full_name}</div>
                <div style={meta}>VK ID: {item.user_vk_id}</div>
                <div style={meta}>Статус: {item.status}</div>
                <div style={meta}>Дата: {item.created_at}</div>
                <div style={detailsBox}>{item.details}</div>

                {item.status === "На рассмотрении" ? (
                  <div style={buttonRow}>
                    <button
                      style={primaryButtonHalf}
                      onClick={() => approveApplication(item.id)}
                    >
                      Одобрить
                    </button>
                    <button
                      style={dangerButtonHalf}
                      onClick={() => rejectApplication(item.id)}
                    >
                      Отклонить
                    </button>
                  </div>
                ) : (
                  <div style={statusBadgeWrap}>
                    <div style={statusBadge}>{item.status}</div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "requests" && (
        <div style={listWrap}>
          {filteredRequests.length === 0 ? (
            <div style={emptyBlock}>Сервисные запросы не найдены</div>
          ) : (
            filteredRequests.map((item) => (
              <div key={item.id} style={card}>
                <div style={cardTitle}>{item.request_type}</div>
                <div style={meta}>Клиент: {item.user_full_name}</div>
                <div style={meta}>VK ID: {item.user_vk_id}</div>
                <div style={meta}>Статус: {item.status}</div>
                <div style={meta}>Дата: {item.created_at}</div>
                <div style={detailsBox}>{item.details}</div>

                <div style={buttonRowWrap}>
                  <button
                    style={secondaryButton}
                    onClick={() => updateServiceRequestStatus(item.id, "В обработке")}
                  >
                    В обработке
                  </button>
                  <button
                    style={primaryButtonSmall}
                    onClick={() => updateServiceRequestStatus(item.id, "Выполнен")}
                  >
                    Выполнен
                  </button>
                  <button
                    style={dangerButtonSmall}
                    onClick={() => updateServiceRequestStatus(item.id, "Отклонен")}
                  >
                    Отклонен
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "userDetails" && (
        <div>
          {!selectedUserData ? (
            <div style={emptyBlock}>Выбери пользователя в разделе "Пользователи"</div>
          ) : (
            <>
              <div style={sectionTitle}>Карточка клиента</div>

              <div style={card}>
                <div style={cardTitle}>{selectedUserData.user.full_name}</div>
                <div style={meta}>VK ID: {selectedUserData.user.vk_id}</div>
                <div style={meta}>Телефон: {selectedUserData.user.phone || "Не указан"}</div>
                <div style={meta}>Дата регистрации: {selectedUserData.user.created_at || "Нет данных"}</div>
              </div>

              <div style={card}>
                <div style={sectionSubTitle}>Пополнить баланс</div>

                <div style={fieldLabel}>Сумма</div>
                <input
                  style={input}
                  value={balanceAmount}
                  onChange={(e) => setBalanceAmount(e.target.value)}
                  placeholder="10000"
                  type="number"
                />

                <div style={fieldLabel}>Комментарий</div>
                <input
                  style={input}
                  value={balanceComment}
                  onChange={(e) => setBalanceComment(e.target.value)}
                  placeholder="Пополнение администратором"
                />

                <button style={primaryButton} onClick={addBalance}>
                  Пополнить баланс
                </button>
              </div>

              <div style={sectionTitle}>Счета</div>
              <div style={grid}>
                {selectedUserData.accounts.length === 0 ? (
                  <div style={emptyBlock}>Счетов нет</div>
                ) : (
                  selectedUserData.accounts.map((acc) => (
                    <div key={acc.id} style={card}>
                      <div style={cardTitle}>{acc.account_name}</div>
                      <div style={meta}>
                        Баланс: {Number(acc.balance).toLocaleString("ru-RU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} ₽
                      </div>
                      <div style={meta}>Валюта: {acc.currency}</div>
                      <div style={meta}>Статус: {acc.status}</div>
                    </div>
                  ))
                )}
              </div>

              <div style={sectionTitle}>Карты</div>
              <div style={grid}>
                {selectedUserData.cards.length === 0 ? (
                  <div style={emptyBlock}>Карт нет</div>
                ) : (
                  selectedUserData.cards.map((card) => (
                    <div key={card.id} style={card}>
                      <div style={cardTitle}>{card.card_name}</div>
                      <div style={meta}>{card.card_number_mask}</div>
                      <div style={meta}>Срок: {card.expiry_date}</div>
                      <div style={meta}>Статус: {card.status}</div>
                    </div>
                  ))
                )}
              </div>

              <div style={sectionTitle}>Заявки клиента</div>
              <div style={listWrap}>
                {selectedUserData.applications.length === 0 ? (
                  <div style={emptyBlock}>Заявок нет</div>
                ) : (
                  selectedUserData.applications.map((item) => (
                    <div key={item.id} style={card}>
                      <div style={cardTitle}>{item.product_type}</div>
                      <div style={meta}>Статус: {item.status}</div>
                      <div style={meta}>Дата: {item.created_at}</div>
                      <div style={detailsBox}>{item.details}</div>

                      {item.status === "На рассмотрении" ? (
                        <div style={buttonRow}>
                          <button
                            style={primaryButtonHalf}
                            onClick={() => approveApplication(item.id)}
                          >
                            Одобрить
                          </button>
                          <button
                            style={dangerButtonHalf}
                            onClick={() => rejectApplication(item.id)}
                          >
                            Отклонить
                          </button>
                        </div>
                      ) : (
                        <div style={statusBadgeWrap}>
                          <div style={statusBadge}>{item.status}</div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div style={sectionTitle}>Сервисные запросы клиента</div>
              <div style={listWrap}>
                {selectedUserData.service_requests.length === 0 ? (
                  <div style={emptyBlock}>Запросов нет</div>
                ) : (
                  selectedUserData.service_requests.map((item) => (
                    <div key={item.id} style={card}>
                      <div style={cardTitle}>{item.request_type}</div>
                      <div style={meta}>Статус: {item.status}</div>
                      <div style={meta}>Дата: {item.created_at}</div>
                      <div style={detailsBox}>{item.details}</div>

                      <div style={buttonRowWrap}>
                        <button
                          style={secondaryButton}
                          onClick={() => updateServiceRequestStatus(item.id, "В обработке")}
                        >
                          В обработке
                        </button>
                        <button
                          style={primaryButtonSmall}
                          onClick={() => updateServiceRequestStatus(item.id, "Выполнен")}
                        >
                          Выполнен
                        </button>
                        <button
                          style={dangerButtonSmall}
                          onClick={() => updateServiceRequestStatus(item.id, "Отклонен")}
                        >
                          Отклонен
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({ text, active, onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...tabButton,
        background: active ? "#2a5f96" : "#162334",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {text}
    </button>
  );
}

function StatCard({ title, value }) {
  return (
    <div style={statCard}>
      <div style={statTitle}>{title}</div>
      <div style={statValue}>{value}</div>
    </div>
  );
}

const page = {
  minHeight: "100vh",
  background: "#0b1220",
  color: "#eef4ff",
  width: "100%",
  maxWidth: "1440px",
  margin: "0 auto",
  padding: "clamp(16px, 3vw, 32px)",
  fontFamily: "Arial, sans-serif",
  boxSizing: "border-box",
};

const header = {
  marginBottom: "20px",
};

const title = {
  fontSize: "clamp(28px, 5vw, 40px)",
  fontWeight: "700",
};

const subtitle = {
  fontSize: "clamp(14px, 2vw, 16px)",
  color: "#9fb3c8",
  marginTop: "6px",
  maxWidth: "720px",
};

const tabsRow = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  marginBottom: "16px",
};

const tabButton = {
  border: "1px solid #2a4667",
  color: "#fff",
  borderRadius: "12px",
  padding: "10px 14px",
  fontSize: "14px",
};

const searchWrap = {
  marginBottom: "16px",
};

const searchInput = {
  width: "100%",
  boxSizing: "border-box",
  background: "#121d2c",
  color: "#eef4ff",
  border: "1px solid #263b55",
  borderRadius: "14px",
  padding: "14px",
  fontSize: "15px",
  outline: "none",
};

const messageBox = {
  background: "#16293d",
  border: "1px solid #29476a",
  color: "#dcecff",
  borderRadius: "12px",
  padding: "14px",
  marginBottom: "16px",
};

const sectionTitle = {
  fontSize: "clamp(22px, 4vw, 28px)",
  fontWeight: "700",
  marginTop: "20px",
  marginBottom: "12px",
};

const sectionSubTitle = {
  fontSize: "18px",
  fontWeight: "700",
  marginBottom: "10px",
};

const statsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "14px",
  marginBottom: "16px",
};

const statCard = {
  background: "#121d2c",
  border: "1px solid #1f3248",
  borderRadius: "18px",
  padding: "18px",
};

const statTitle = {
  fontSize: "14px",
  color: "#9fb3c8",
  marginBottom: "10px",
};

const statValue = {
  fontSize: "28px",
  fontWeight: "700",
};

const bigStatValue = {
  fontSize: "clamp(28px, 5vw, 40px)",
  fontWeight: "700",
  marginTop: "8px",
};

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "14px",
};

const listWrap = {
  display: "flex",
  flexDirection: "column",
  gap: "14px",
};

const card = {
  background: "#121d2c",
  border: "1px solid #1f3248",
  borderRadius: "18px",
  padding: "18px",
};

const cardTitle = {
  fontSize: "clamp(18px, 3vw, 22px)",
  fontWeight: "700",
  marginBottom: "10px",
};

const meta = {
  color: "#b6c6d9",
  fontSize: "14px",
  marginBottom: "6px",
};

const detailsBox = {
  marginTop: "10px",
  background: "#0f1927",
  border: "1px solid #20324a",
  borderRadius: "12px",
  padding: "12px",
  color: "#e4efff",
  fontSize: "14px",
  lineHeight: "1.5",
};

const statusBadgeWrap = {
  marginTop: "14px",
};

const statusBadge = {
  display: "inline-block",
  background: "#1b2f45",
  color: "#dcecff",
  border: "1px solid #315272",
  borderRadius: "999px",
  padding: "8px 12px",
  fontSize: "13px",
};

const emptyBlock = {
  background: "#121d2c",
  borderRadius: "18px",
  padding: "18px",
  color: "#a8b7ca",
  border: "1px solid #1f3248",
};

const fieldLabel = {
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

const buttonRow = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "10px",
  marginTop: "14px",
};

const buttonRowWrap = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  marginTop: "14px",
};

const primaryButton = {
  width: "100%",
  marginTop: "16px",
  background: "#2a5f96",
  color: "#ffffff",
  border: "none",
  borderRadius: "14px",
  padding: "14px",
  fontSize: "15px",
  cursor: "pointer",
};

const primaryButtonHalf = {
  background: "#2a5f96",
  color: "#ffffff",
  border: "none",
  borderRadius: "14px",
  padding: "14px",
  fontSize: "15px",
  cursor: "pointer",
};

const dangerButtonHalf = {
  background: "#8b2f3a",
  color: "#ffffff",
  border: "none",
  borderRadius: "14px",
  padding: "14px",
  fontSize: "15px",
  cursor: "pointer",
};

const secondaryButton = {
  background: "#1b2f45",
  color: "#dcecff",
  border: "1px solid #315272",
  borderRadius: "14px",
  padding: "12px 14px",
  fontSize: "14px",
  cursor: "pointer",
};

const primaryButtonSmall = {
  background: "#2a5f96",
  color: "#ffffff",
  border: "none",
  borderRadius: "14px",
  padding: "12px 14px",
  fontSize: "14px",
  cursor: "pointer",
};

const dangerButtonSmall = {
  background: "#8b2f3a",
  color: "#ffffff",
  border: "none",
  borderRadius: "14px",
  padding: "12px 14px",
  fontSize: "14px",
  cursor: "pointer",
};

export default App;
