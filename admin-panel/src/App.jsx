import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";
import { adminFetch, adminUrl } from "./api";

const DEFAULT_API_BASE = (import.meta.env.VITE_ADMIN_API_BASE || "https://api.zf-bank.ru").replace(/\/$/, "");
const ROLE_ORDER = {
  operator: 1,
  admin: 2,
  superadmin: 3,
};
const ROLE_LABELS = {
  operator: "Оператор",
  admin: "Администратор",
  superadmin: "Суперадминистратор",
};
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REQUEST_STATUS_OPTIONS = ["Создан", "В обработке", "Выполнен", "Отклонен"];

const INITIAL_CLIENT = {
  user: null,
  accounts: [],
  cards: [],
  applications: [],
  service_requests: [],
  operations: [],
  support_messages: [],
};

function canAccess(role, minimumRole) {
  return (ROLE_ORDER[role] || 0) >= (ROLE_ORDER[minimumRole] || 0);
}

function formatNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatDate(value) {
  return value || "—";
}

function formatChartDateLabel(value) {
  if (!value || typeof value !== "string" || !value.includes("-")) {
    return value || "—";
  }
  const [, month, day] = value.split("-");
  return `${day}.${month}`;
}

function formatChartTooltipValue(value, name) {
  return [formatNumber(value), name];
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "Неизвестная ошибка");
}

async function requestJson(path, { base, method = "GET", body, csrfToken, headers } = {}) {
  const upperMethod = method.toUpperCase();
  const finalHeaders = { ...(headers || {}) };
  if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
  }
  if (csrfToken && MUTATING_METHODS.has(upperMethod)) {
    finalHeaders["X-CSRF-Token"] = csrfToken;
  }

  const response = await adminFetch(adminUrl(path, base), {
    method: upperMethod,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  return response.json().catch(() => ({}));
}

function getViewTitle(view) {
  const titles = {
    overview: "Сводка системы",
    users: "Клиенты банка",
    applications: "Заявки на продукты",
    requests: "Сервисные запросы",
    support: "История поддержки",
    client: "Карточка клиента",
    audit: "Журнал действий",
    staff: "Управление сотрудниками",
  };
  return titles[view] || "Административная панель";
}

function Overview({ stats }) {
  const cards = [
    ["Пользователи", stats?.users_count],
    ["Счета", stats?.accounts_count],
    ["Карты", stats?.cards_count],
    ["Операции", stats?.operations_count],
    ["Заявки", stats?.applications_count],
    ["Сервисные запросы", stats?.service_requests_count],
    ["Сообщения поддержки", stats?.support_messages_count],
    ["AI-эскалации", stats?.ai_escalations_count],
  ];
  const operationsTrend = stats?.operations_by_day || [];
  const applicationStatuses = stats?.applications_by_status || [];
  const requestStatuses = stats?.service_requests_by_status || [];
  const statusChartColors = ["#4f8cff", "#4dd7a8", "#ffb65c", "#ff7187"];

  return (
    <section className="stack">
      <div className="metric-grid">
        {cards.map(([label, value]) => (
          <article className="panel metric-card" key={label}>
            <p className="muted">{label}</p>
            <strong>{formatNumber(value)}</strong>
          </article>
        ))}
      </div>

      <section className="panel">
        <h2>Финансовая сводка</h2>
        <p className="muted">Совокупный баланс по счетам: {formatNumber(stats?.total_balance)} ₽</p>
        <div className="badge-row">
          <span className="badge">На рассмотрении: {formatNumber(stats?.pending_applications)}</span>
          <span className="badge">Одобрено: {formatNumber(stats?.approved_applications)}</span>
          <span className="badge">Отклонено: {formatNumber(stats?.rejected_applications)}</span>
        </div>
      </section>

      <div className="dashboard-chart-grid">
        <section className="panel chart-panel">
          <div className="chart-panel__head">
            <div>
              <p className="eyebrow">Динамика</p>
              <h2>Операции за последние 7 дней</h2>
            </div>
            <p className="muted chart-panel__hint">График показывает, когда в системе растёт или снижается активность операций.</p>
          </div>
          <div className="chart-surface">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={operationsTrend} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="operationsArea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#5b8cff" stopOpacity={0.42} />
                    <stop offset="95%" stopColor="#5b8cff" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(180, 198, 230, 0.08)" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="date"
                  minTickGap={24}
                  tick={{ fill: "#9eb0d2", fontSize: 12 }}
                  tickFormatter={formatChartDateLabel}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tick={{ fill: "#9eb0d2", fontSize: 12 }}
                  tickLine={false}
                  width={34}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(8, 15, 27, 0.96)",
                    border: "1px solid rgba(143, 185, 255, 0.18)",
                    borderRadius: "16px",
                    boxShadow: "0 18px 48px rgba(0, 0, 0, 0.28)",
                  }}
                  formatter={(value) => formatChartTooltipValue(value, "Операций")}
                  labelFormatter={(value) => `Дата: ${formatChartDateLabel(value)}`}
                />
                <Area
                  dataKey="count"
                  fill="url(#operationsArea)"
                  fillOpacity={1}
                  name="Операций"
                  stroke="#6c97ff"
                  strokeWidth={3}
                  type="monotone"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel chart-panel">
          <div className="chart-panel__head">
            <div>
              <p className="eyebrow">Статусы</p>
              <h2>Заявки и сервисные запросы</h2>
            </div>
            <p className="muted chart-panel__hint">Сразу видно, где копится очередь и какие категории уже закрываются стабильно.</p>
          </div>
          <div className="status-chart-grid">
            <div className="mini-chart-card">
              <div className="mini-chart-card__title">Заявки на продукты</div>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={applicationStatuses} layout="vertical" margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(180, 198, 230, 0.08)" horizontal={false} />
                  <XAxis allowDecimals={false} axisLine={false} tick={{ fill: "#9eb0d2", fontSize: 12 }} tickLine={false} type="number" />
                  <YAxis
                    axisLine={false}
                    dataKey="status"
                    tick={{ fill: "#eef4ff", fontSize: 12 }}
                    tickLine={false}
                    type="category"
                    width={112}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(8, 15, 27, 0.96)",
                      border: "1px solid rgba(143, 185, 255, 0.18)",
                      borderRadius: "16px",
                      boxShadow: "0 18px 48px rgba(0, 0, 0, 0.28)",
                    }}
                    formatter={(value) => formatChartTooltipValue(value, "Заявок")}
                    labelFormatter={(value) => value}
                  />
                  <Bar dataKey="count" radius={[0, 10, 10, 0]}>
                    {applicationStatuses.map((item, index) => (
                      <Cell key={`app-status-${item.status}`} fill={statusChartColors[index % statusChartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mini-chart-card">
              <div className="mini-chart-card__title">Сервисные запросы</div>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={requestStatuses} layout="vertical" margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(180, 198, 230, 0.08)" horizontal={false} />
                  <XAxis allowDecimals={false} axisLine={false} tick={{ fill: "#9eb0d2", fontSize: 12 }} tickLine={false} type="number" />
                  <YAxis
                    axisLine={false}
                    dataKey="status"
                    tick={{ fill: "#eef4ff", fontSize: 12 }}
                    tickLine={false}
                    type="category"
                    width={112}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(8, 15, 27, 0.96)",
                      border: "1px solid rgba(143, 185, 255, 0.18)",
                      borderRadius: "16px",
                      boxShadow: "0 18px 48px rgba(0, 0, 0, 0.28)",
                    }}
                    formatter={(value) => formatChartTooltipValue(value, "Запросов")}
                    labelFormatter={(value) => value}
                  />
                  <Bar dataKey="count" radius={[0, 10, 10, 0]}>
                    {requestStatuses.map((item, index) => (
                      <Cell key={`request-status-${item.status}`} fill={statusChartColors[index % statusChartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function UsersView({ users, onOpenClient }) {
  return (
    <section className="panel">
      <h2>Список клиентов</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Клиент</th>
              <th>VK ID</th>
              <th>Счета</th>
              <th>Карты</th>
              <th>Заявки</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((item) => (
              <tr key={item.id}>
                <td>{item.full_name}</td>
                <td>{item.vk_id}</td>
                <td>{item.accounts_count}</td>
                <td>{item.cards_count}</td>
                <td>{item.applications_count}</td>
                <td>
                  <button className="button button--small" type="button" onClick={() => onOpenClient(item.vk_id)}>
                    Открыть
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ApplicationsView({ applications, canModerate, onApprove, onReject }) {
  return (
    <section className="panel">
      <h2>Заявки пользователей</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Клиент</th>
              <th>Продукт</th>
              <th>Статус</th>
              <th>Дата</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.user_full_name}</td>
                <td>{item.product_type}</td>
                <td>{item.status}</td>
                <td>{formatDate(item.created_at)}</td>
                <td className="action-cell">
                  <button className="button button--small" type="button" disabled={!canModerate} onClick={() => onApprove(item.id)}>
                    Одобрить
                  </button>
                  <button className="button button--small button--danger" type="button" disabled={!canModerate} onClick={() => onReject(item.id)}>
                    Отклонить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RequestsView({ items, canModerate, onStatusChange }) {
  return (
    <section className="panel">
      <h2>Сервисные запросы</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Клиент</th>
              <th>Тип</th>
              <th>Статус</th>
              <th>Дата</th>
              <th>Управление</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.user_full_name}</td>
                <td>{item.request_type}</td>
                <td>{item.status}</td>
                <td>{formatDate(item.created_at)}</td>
                <td>
                  <select
                    className="select-inline"
                    value={item.status}
                    disabled={!canModerate}
                    onChange={(event) => onStatusChange(item.id, event.target.value)}
                  >
                    {REQUEST_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SupportView({ items, onOpenClient }) {
  return (
    <section className="panel">
      <h2>Чат поддержки</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Клиент</th>
              <th>Источник</th>
              <th>Сообщение</th>
              <th>Дата</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.user_full_name}</td>
                <td>{item.sender_type}</td>
                <td>{item.message}</td>
                <td>{formatDate(item.created_at)}</td>
                <td>
                  <button className="button button--small" type="button" onClick={() => onOpenClient(item.user_vk_id)}>
                    Карточка
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ClientView({
  details,
  canManage,
  supportReply,
  onSupportReplyChange,
  onSubmitReply,
  balanceForm,
  onBalanceFormChange,
  onSubmitBalance,
  onUnblockCard,
}) {
  const user = details?.user;
  if (!user) {
    return (
      <section className="panel">
        <p className="muted">Сначала откройте карточку клиента из списка пользователей или поддержки.</p>
      </section>
    );
  }

  return (
    <section className="stack">
      <section className="panel">
        <p className="eyebrow">Клиент</p>
        <h2>{user.full_name}</h2>
        <div className="detail-grid">
          <div>
            <span className="muted">VK ID</span>
            <div>{user.vk_id}</div>
          </div>
          <div>
            <span className="muted">Телефон</span>
            <div>{user.phone || "—"}</div>
          </div>
          <div>
            <span className="muted">Регистрация</span>
            <div>{formatDate(user.created_at)}</div>
          </div>
        </div>
      </section>

      <div className="two-column">
        <section className="panel">
          <h3>Счета</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Счёт</th>
                  <th>Баланс</th>
                  <th>Валюта</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {details.accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.account_name}</td>
                    <td>{formatNumber(account.balance)}</td>
                    <td>{account.currency}</td>
                    <td>{account.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h3>Карты</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Карта</th>
                  <th>Маска</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {details.cards.map((card) => (
                  <tr key={card.id}>
                    <td>{card.card_name}</td>
                    <td>{card.card_number_mask}</td>
                    <td>{card.status}</td>
                    <td>
                      <button className="button button--small" type="button" disabled={!canManage} onClick={() => onUnblockCard(card.id)}>
                        Разблокировать
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="two-column">
        <section className="panel">
          <h3>Пополнение баланса</h3>
          <form className="stack" onSubmit={onSubmitBalance}>
            <label className="field">
              <span>Сумма</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={balanceForm.amount}
                onChange={(event) =>
                  onBalanceFormChange((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Комментарий</span>
              <input
                value={balanceForm.comment}
                onChange={(event) =>
                  onBalanceFormChange((current) => ({
                    ...current,
                    comment: event.target.value,
                  }))
                }
              />
            </label>
            <button className="button button--primary" type="submit" disabled={!canManage}>
              Зачислить
            </button>
          </form>
        </section>

        <section className="panel">
          <h3>Ответ поддержки</h3>
          <form className="stack" onSubmit={onSubmitReply}>
            <label className="field">
              <span>Сообщение</span>
              <textarea value={supportReply} onChange={(event) => onSupportReplyChange(event.target.value)} rows={5} />
            </label>
            <button className="button button--primary" type="submit">
              Отправить ответ
            </button>
          </form>
        </section>
      </div>

      <section className="panel">
        <h3>Последние операции</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Операция</th>
                <th>Тип</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {details.operations.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.created_at)}</td>
                  <td>{item.title}</td>
                  <td>{item.operation_type}</td>
                  <td>{formatNumber(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function AuditView({ items, filters, setFilters, staffOptions, canSeeStaff }) {
  return (
    <section className="stack">
      <section className="panel">
        <h2>{"\u0424\u0438\u043b\u044c\u0442\u0440\u044b \u0436\u0443\u0440\u043d\u0430\u043b\u0430"}</h2>
        <div className="filter-grid">
          {canSeeStaff ? (
            <label className="field">
              <span>{"\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a"}</span>
              <select
                value={filters.actor_staff_id}
                onChange={(event) => setFilters((current) => ({ ...current, actor_staff_id: event.target.value }))}
              >
                <option value="">{"\u0412\u0441\u0435"}</option>
                {staffOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.full_name} ({item.username})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>{"\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435"}</span>
            <input value={filters.action_type} onChange={(event) => setFilters((current) => ({ ...current, action_type: event.target.value }))} />
          </label>
          <label className="field">
            <span>{"\u0421\u0443\u0449\u043d\u043e\u0441\u0442\u044c"}</span>
            <input value={filters.target_type} onChange={(event) => setFilters((current) => ({ ...current, target_type: event.target.value }))} />
          </label>
          <label className="field">
            <span>{"\u0421 \u0434\u0430\u0442\u044b"}</span>
            <input value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} />
          </label>
          <label className="field">
            <span>{"\u041f\u043e \u0434\u0430\u0442\u0443"}</span>
            <input value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} />
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>{"\u0421\u043e\u0431\u044b\u0442\u0438\u044f \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u0438 \u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439"}</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{"\u041a\u043e\u0433\u0434\u0430"}</th>
                <th>{"\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a"}</th>
                <th>{"\u0420\u043e\u043b\u044c"}</th>
                <th>{"\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435"}</th>
                <th>{"\u041e\u0431\u044a\u0435\u043a\u0442"}</th>
                <th>{"\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442"}</th>
                <th>{"\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.created_at)}</td>
                  <td>{item.actor_username || "system"}</td>
                  <td>{item.actor_role || "\u2014"}</td>
                  <td>{item.action_type}</td>
                  <td>
                    {item.target_type || "\u2014"}
                    {item.target_id ? ` #${item.target_id}` : ""}
                  </td>
                  <td>{item.result}</td>
                  <td>{item.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function StaffView({
  currentStaff,
  items,
  createForm,
  onCreateFormChange,
  onCreate,
  staffPasswordMap,
  onStaffPasswordMapChange,
  onUpdateRole,
  onToggleActive,
  onResetPassword,
}) {
  const activeSuperadminCount = items.filter((item) => item.role === "superadmin" && item.is_active).length;
  return (
    <section className="stack">
      <section className="panel">
        <h2>Новый сотрудник</h2>
        <form className="filter-grid" onSubmit={onCreate}>
          <label className="field">
            <span>Логин</span>
            <input value={createForm.username} onChange={(event) => onCreateFormChange((current) => ({ ...current, username: event.target.value }))} />
          </label>
          <label className="field">
            <span>ФИО</span>
            <input value={createForm.full_name} onChange={(event) => onCreateFormChange((current) => ({ ...current, full_name: event.target.value }))} />
          </label>
          <label className="field">
            <span>Роль</span>
            <select value={createForm.role} onChange={(event) => onCreateFormChange((current) => ({ ...current, role: event.target.value }))}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              value={createForm.password}
              onChange={(event) => onCreateFormChange((current) => ({ ...current, password: event.target.value }))}
            />
          </label>
          <div className="field field--actions">
            <span>&nbsp;</span>
            <button className="button button--primary" type="submit">
              Создать сотрудника
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Управление ролями и доступом</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Логин</th>
                <th>ФИО</th>
                <th>Роль</th>
                <th>Статус</th>
                <th>Последний вход</th>
                <th>Пароль</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isSelf = currentStaff && item.id === currentStaff.id;
                const isLastActiveSuperadmin = item.role === "superadmin" && item.is_active && activeSuperadminCount <= 1;
                const roleLocked = isSelf || isLastActiveSuperadmin;
                const toggleLocked = isSelf || isLastActiveSuperadmin;
                const roleLockReason = isSelf
                  ? "Нельзя менять собственную роль через панель."
                  : "Нельзя понизить последнего активного суперадминистратора.";
                const toggleLockReason = isSelf
                  ? "Нельзя отключить собственную учетную запись."
                  : "Нельзя отключить последнего активного суперадминистратора.";

                return (
                <tr key={item.id}>
                  <td>{item.username}</td>
                  <td>{item.full_name}</td>
                  <td>
                    <select
                      value={item.role}
                      disabled={roleLocked}
                      title={roleLocked ? roleLockReason : ""}
                      onChange={(event) => onUpdateRole(item, event.target.value)}
                    >
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{item.is_active ? "Активен" : "Отключён"}</td>
                  <td>{formatDate(item.last_login_at)}</td>
                  <td>
                    <input
                      type="password"
                      value={staffPasswordMap[item.id] || ""}
                      onChange={(event) =>
                        onStaffPasswordMapChange((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                      placeholder="Новый пароль"
                    />
                  </td>
                  <td className="action-cell">
                    <button className="button button--small" type="button" onClick={() => onResetPassword(item)}>
                      Сбросить пароль
                    </button>
                    <button
                      className="button button--small button--ghost"
                      type="button"
                      disabled={toggleLocked}
                      title={toggleLocked ? toggleLockReason : ""}
                      onClick={() => onToggleActive(item)}
                    >
                      {item.is_active ? "Отключить" : "Включить"}
                    </button>
                  </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function App() {
  const [apiBase, setApiBase] = useState(() => {
    try {
      return localStorage.getItem("admin_api_base") || DEFAULT_API_BASE;
    } catch {
      return DEFAULT_API_BASE;
    }
  });
  const [staff, setStaff] = useState(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState("overview");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });

  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [applications, setApplications] = useState([]);
  const [serviceRequests, setServiceRequests] = useState([]);
  const [supportMessages, setSupportMessages] = useState([]);
  const [staffItems, setStaffItems] = useState([]);
  const [auditItems, setAuditItems] = useState([]);
  const [selectedUserVkId, setSelectedUserVkId] = useState("");
  const [clientDetails, setClientDetails] = useState(INITIAL_CLIENT);

  const [supportReply, setSupportReply] = useState("");
  const [balanceForm, setBalanceForm] = useState({ amount: "", comment: "Пополнение от администратора" });
  const [staffCreateForm, setStaffCreateForm] = useState({
    username: "",
    full_name: "",
    password: "",
    role: "operator",
  });
  const [staffPasswordMap, setStaffPasswordMap] = useState({});
  const [reloadTick, setReloadTick] = useState(0);
  const [auditFilters, setAuditFilters] = useState({
    actor_staff_id: "",
    action_type: "",
    target_type: "",
    date_from: "",
    date_to: "",
  });

  const menuItems = useMemo(
    () => [
      { id: "overview", label: "Сводка", minRole: "operator" },
      { id: "users", label: "Клиенты", minRole: "operator" },
      { id: "applications", label: "Заявки", minRole: "operator" },
      { id: "requests", label: "Сервисные запросы", minRole: "operator" },
      { id: "support", label: "Поддержка", minRole: "operator" },
      { id: "audit", label: "Аудит", minRole: "operator" },
      { id: "staff", label: "Сотрудники", minRole: "superadmin" },
    ],
    [],
  );

  useEffect(() => {
    try {
      localStorage.setItem("admin_api_base", apiBase);
    } catch {
      // ignore storage errors
    }
  }, [apiBase]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setBootstrapping(true);
      setError("");
      try {
        let currentStaff = null;
        let currentCsrf = "";

        try {
          currentStaff = await requestJson("/admin/auth/me", { base: apiBase });
        } catch {
          try {
            const refreshed = await requestJson("/admin/auth/refresh", { base: apiBase, method: "POST" });
            currentStaff = refreshed.staff || null;
            currentCsrf = refreshed.csrf_token || "";
          } catch {
            currentStaff = null;
          }
        }

        if (currentStaff) {
          const csrfPayload = await requestJson("/admin/auth/csrf", { base: apiBase });
          currentCsrf = csrfPayload.csrf_token || currentCsrf;
        }

        if (!cancelled) {
          setStaff(currentStaff);
          setCsrfToken(currentCsrf);
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(getErrorMessage(bootstrapError));
          setStaff(null);
          setCsrfToken("");
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (!staff) {
      return;
    }

    let cancelled = false;

    async function loadCurrentView() {
      setPageLoading(true);
      setError("");
      try {
        if (view === "overview") {
          const payload = await requestJson("/admin/stats", { base: apiBase });
          if (!cancelled) {
            setStats(payload);
          }
        } else if (view === "users") {
          const payload = await requestJson("/admin/users", { base: apiBase });
          if (!cancelled) {
            setUsers(Array.isArray(payload) ? payload : []);
          }
        } else if (view === "applications") {
          const payload = await requestJson("/admin/applications", { base: apiBase });
          if (!cancelled) {
            setApplications(Array.isArray(payload) ? payload : []);
          }
        } else if (view === "requests") {
          const payload = await requestJson("/admin/service-requests", { base: apiBase });
          if (!cancelled) {
            setServiceRequests(Array.isArray(payload) ? payload : []);
          }
        } else if (view === "support") {
          const payload = await requestJson("/admin/support-messages", { base: apiBase });
          if (!cancelled) {
            setSupportMessages(Array.isArray(payload) ? payload : []);
          }
        } else if (view === "audit") {
          if (canAccess(staff.role, "superadmin") && !staffItems.length) {
            const staffPayload = await requestJson("/admin/staff", { base: apiBase });
            if (!cancelled) {
              setStaffItems(Array.isArray(staffPayload.items) ? staffPayload.items : []);
            }
          }
          const query = new URLSearchParams();
          Object.entries(auditFilters).forEach(([key, value]) => {
            if (value) {
              query.set(key, value);
            }
          });
          const payload = await requestJson(`/admin/audit-logs${query.toString() ? `?${query.toString()}` : ""}`, {
            base: apiBase,
          });
          if (!cancelled) {
            setAuditItems(Array.isArray(payload.items) ? payload.items : []);
          }
        } else if (view === "staff" && canAccess(staff.role, "superadmin")) {
          const payload = await requestJson("/admin/staff", { base: apiBase });
          if (!cancelled) {
            setStaffItems(Array.isArray(payload.items) ? payload.items : []);
          }
        } else if (view === "client" && selectedUserVkId) {
          const payload = await requestJson(`/admin/users/${selectedUserVkId}/full`, { base: apiBase });
          if (!cancelled) {
            setClientDetails(payload);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (!cancelled) {
          setPageLoading(false);
        }
      }
    }

    loadCurrentView();
    return () => {
      cancelled = true;
    };
  }, [staff, view, selectedUserVkId, apiBase, auditFilters, reloadTick, staffItems.length]);

  async function refreshView(targetView = view) {
    setView(targetView);
    setReloadTick((current) => current + 1);
  }

  async function handleLogin(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setFlash("");
    try {
      const payload = await requestJson("/admin/auth/login", {
        base: apiBase,
        method: "POST",
        body: loginForm,
      });
      setStaff(payload.staff || null);
      setCsrfToken(payload.csrf_token || "");
      setView("overview");
      setFlash("Вход выполнен.");
      setLoginForm((current) => ({ ...current, password: "" }));
    } catch (loginError) {
      setError(getErrorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    if (!staff) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await requestJson("/admin/auth/logout", {
        base: apiBase,
        method: "POST",
        csrfToken,
      });
      setStaff(null);
      setCsrfToken("");
      setSelectedUserVkId("");
      setClientDetails(INITIAL_CLIENT);
      setFlash("Сессия завершена.");
    } catch (logoutError) {
      setError(getErrorMessage(logoutError));
    } finally {
      setSubmitting(false);
    }
  }

  async function mutate(path, { method = "POST", body, successMessage, nextView, clearForm } = {}) {
    setSubmitting(true);
    setError("");
    setFlash("");
    try {
      const payload = await requestJson(path, {
        base: apiBase,
        method,
        body,
        csrfToken,
      });
      setFlash(successMessage || payload.message || "Изменения сохранены.");
      if (typeof clearForm === "function") {
        clearForm();
      }
      setReloadTick((current) => current + 1);
      if ((nextView || view) === "staff" && canAccess(staff.role, "superadmin")) {
        const staffPayload = await requestJson("/admin/staff", { base: apiBase });
        setStaffItems(Array.isArray(staffPayload.items) ? staffPayload.items : []);
      }
      if ((nextView || view) === "audit") {
        const auditPayload = await requestJson("/admin/audit-logs", { base: apiBase });
        setAuditItems(Array.isArray(auditPayload.items) ? auditPayload.items : []);
      }
      if ((nextView || view) === "client" && selectedUserVkId) {
        const details = await requestJson(`/admin/users/${selectedUserVkId}/full`, { base: apiBase });
        setClientDetails(details);
      }
      if (nextView && nextView !== view) {
        setView(nextView);
      }
      return payload;
    } catch (mutationError) {
      setError(getErrorMessage(mutationError));
      throw mutationError;
    } finally {
      setSubmitting(false);
    }
  }

  function openClient(vkId) {
    setSelectedUserVkId(vkId);
    setSupportReply("");
    setBalanceForm({ amount: "", comment: "Пополнение от администратора" });
    setView("client");
  }

  async function handleSupportReply(event) {
    event.preventDefault();
    if (!selectedUserVkId || !supportReply.trim()) {
      return;
    }
    await mutate(`/admin/users/${selectedUserVkId}/support-reply`, {
      body: { message: supportReply.trim() },
      successMessage: "Ответ отправлен.",
      clearForm: () => setSupportReply(""),
    });
  }

  async function handleBalanceTopUp(event) {
    event.preventDefault();
    if (!selectedUserVkId) {
      return;
    }
    await mutate(`/admin/users/${selectedUserVkId}/add-balance`, {
      body: {
        amount: Number(balanceForm.amount),
        comment: balanceForm.comment,
      },
      successMessage: "Баланс пополнен.",
      clearForm: () => setBalanceForm({ amount: "", comment: "Пополнение от администратора" }),
    });
  }

  async function handleCreateStaff(event) {
    event.preventDefault();
    await mutate("/admin/staff", {
      body: staffCreateForm,
      successMessage: "Сотрудник создан.",
      nextView: "staff",
      clearForm: () =>
        setStaffCreateForm({
          username: "",
          full_name: "",
          password: "",
          role: "operator",
        }),
    });
  }

  const visibleMenuItems = menuItems.filter((item) => !staff || canAccess(staff.role, item.minRole));

  if (bootstrapping) {
    return (
      <main className="shell shell--centered">
        <section className="panel panel--narrow">
          <p className="eyebrow">ZF Bank Admin</p>
          <h1>Проверяем административную сессию</h1>
          <p className="muted">Сейчас подтянем сотрудника, роли и защитные токены.</p>
        </section>
      </main>
    );
  }

  if (!staff) {
    return (
      <main className="shell shell--centered">
        <section className="panel panel--narrow">
          <p className="eyebrow">Административный контур</p>
          <h1>Вход сотрудника</h1>
          <p className="muted">
            Панель больше не использует API-ключ в браузере. Вход выполняется по логину и паролю,
            а рабочая сессия хранится в защищённых cookie.
          </p>

          <form className="stack" onSubmit={handleLogin}>
            <label className="field">
              <span>API URL</span>
              <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder={DEFAULT_API_BASE} />
            </label>

            <label className="field">
              <span>Логин</span>
              <input
                autoComplete="username"
                value={loginForm.username}
                onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                placeholder="root"
              />
            </label>

            <label className="field">
              <span>Пароль</span>
              <input
                type="password"
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="Введите пароль"
              />
            </label>

            {error ? <p className="feedback feedback--error">{error}</p> : null}
            {flash ? <p className="feedback feedback--success">{flash}</p> : null}

            <button className="button button--primary" type="submit" disabled={submitting}>
              {submitting ? "Входим..." : "Войти"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar panel">
        <div className="sidebar__head">
          <p className="eyebrow">ZF Bank Admin</p>
          <h2>Панель сотрудников</h2>
          <p className="muted">
            {staff.full_name} · {ROLE_LABELS[staff.role] || staff.role}
          </p>
        </div>

        <nav className="menu">
          {visibleMenuItems.map((item) => (
            <button
              key={item.id}
              className={`menu__item ${view === item.id ? "menu__item--active" : ""}`}
              type="button"
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
          {selectedUserVkId ? (
            <button
              className={`menu__item ${view === "client" ? "menu__item--active" : ""}`}
              type="button"
              onClick={() => setView("client")}
            >
              Карточка клиента
            </button>
          ) : null}
        </nav>

        <div className="sidebar__foot">
          <div className="profile-card">
            <div>
              <strong>{staff.username}</strong>
              <div className="muted">Последний вход: {formatDate(staff.last_login_at)}</div>
            </div>
            <button className="button button--ghost" type="button" onClick={handleLogout} disabled={submitting}>
              Выйти
            </button>
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="content__header panel">
          <div>
            <p className="eyebrow">Рабочая область</p>
            <h1>{getViewTitle(view)}</h1>
          </div>
          <div className="header-actions">
            <button className="button button--ghost" type="button" onClick={() => refreshView()} disabled={pageLoading}>
              Обновить
            </button>
          </div>
        </header>

        {error ? <p className="feedback feedback--error">{error}</p> : null}
        {flash ? <p className="feedback feedback--success">{flash}</p> : null}
        {pageLoading ? <p className="muted">Загружаем данные...</p> : null}

        {view === "overview" ? <Overview stats={stats} /> : null}
        {view === "users" ? <UsersView users={users} onOpenClient={openClient} /> : null}
        {view === "applications" ? (
          <ApplicationsView
            applications={applications}
            canModerate={canAccess(staff.role, "admin")}
            onApprove={(id) => mutate(`/admin/applications/${id}/approve`, { successMessage: "Заявка одобрена." })}
            onReject={(id) => mutate(`/admin/applications/${id}/reject`, { successMessage: "Заявка отклонена." })}
          />
        ) : null}
        {view === "requests" ? (
          <RequestsView
            items={serviceRequests}
            canModerate={canAccess(staff.role, "admin")}
            onStatusChange={(id, status) =>
              mutate(`/admin/service-requests/${id}/status`, {
                body: { status },
                successMessage: "Статус обновлён.",
              })
            }
          />
        ) : null}
        {view === "support" ? <SupportView items={supportMessages} onOpenClient={openClient} /> : null}
        {view === "client" ? (
          <ClientView
            details={clientDetails}
            canManage={canAccess(staff.role, "admin")}
            supportReply={supportReply}
            onSupportReplyChange={setSupportReply}
            onSubmitReply={handleSupportReply}
            balanceForm={balanceForm}
            onBalanceFormChange={setBalanceForm}
            onSubmitBalance={handleBalanceTopUp}
            onUnblockCard={(cardId) => mutate(`/admin/cards/${cardId}/unblock`, { successMessage: "Карта разблокирована." })}
          />
        ) : null}
        {view === "audit" ? (
          <AuditView
            items={auditItems}
            filters={auditFilters}
            setFilters={setAuditFilters}
            staffOptions={staffItems}
            canSeeStaff={canAccess(staff.role, "superadmin")}
          />
        ) : null}
        {view === "staff" && canAccess(staff.role, "superadmin") ? (
          <StaffView
            currentStaff={staff}
            items={staffItems}
            createForm={staffCreateForm}
            onCreateFormChange={setStaffCreateForm}
            onCreate={handleCreateStaff}
            staffPasswordMap={staffPasswordMap}
            onStaffPasswordMapChange={setStaffPasswordMap}
            onUpdateRole={(item, role) =>
              mutate(`/admin/staff/${item.id}`, {
                method: "PATCH",
                body: { role },
                successMessage: "Роль обновлена.",
                nextView: "staff",
              })
            }
            onToggleActive={(item) =>
              mutate(`/admin/staff/${item.id}/${item.is_active ? "deactivate" : "activate"}`, {
                successMessage: item.is_active ? "Сотрудник отключён." : "Сотрудник активирован.",
                nextView: "staff",
              })
            }
            onResetPassword={(item) =>
              mutate(`/admin/staff/${item.id}/reset-password`, {
                body: { new_password: staffPasswordMap[item.id] || "" },
                successMessage: "Пароль обновлён.",
                nextView: "staff",
                clearForm: () =>
                  setStaffPasswordMap((current) => ({
                    ...current,
                    [item.id]: "",
                  })),
              })
            }
          />
        ) : null}
      </section>
    </main>
  );
}

export default App;
