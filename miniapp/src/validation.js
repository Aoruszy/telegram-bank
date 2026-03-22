const MAX_AMOUNT = 50_000_000;
const MAX_MESSAGE_LEN = 2000;
const MAX_DETAILS_LEN = 4000;

export function validatePin(pin) {
  const p = String(pin || "").replace(/\s/g, "");
  if (!/^\d{4,6}$/.test(p)) return "Введите PIN из 4–6 цифр";
  return null;
}

export function validateAmount(value, max = MAX_AMOUNT) {
  const n = Number(String(value || "").replace(",", ".").replace(/\s/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "Укажите сумму больше нуля";
  if (n > max) return `Сумма не более ${max.toLocaleString("ru-RU")} ₽`;
  return null;
}

export function validateRequired(value, label) {
  if (value == null || String(value).trim() === "") return `Заполните поле «${label}»`;
  return null;
}

export function validatePhoneRu(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 11 && (d.startsWith("7") || d.startsWith("8")))
    return /^\+?7\d{10}$/.test(`+7${d.slice(1)}`) ? null : "Неверный формат телефона";
  if (d.length === 10) return null;
  return "Нужен российский номер в формате +7…";
}

export function validateMessage(text) {
  const s = String(text || "");
  if (s.trim().length < 1) return "Введите текст сообщения";
  if (s.length > MAX_MESSAGE_LEN) return `Не более ${MAX_MESSAGE_LEN} символов`;
  return null;
}

export function validateDetails(text) {
  const s = String(text || "");
  if (s.length > MAX_DETAILS_LEN) return `Не более ${MAX_DETAILS_LEN} символов`;
  return null;
}

export function validateAccountName(name) {
  const s = String(name || "").trim();
  if (s.length < 2) return "Название счёта — минимум 2 символа";
  if (s.length > 120) return "Слишком длинное название";
  return null;
}

export function sanitizeDigitsOnly(pin) {
  return String(pin || "").replace(/\D/g, "").slice(0, 6);
}
