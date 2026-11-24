import type { AdminUser, AdminUserPatch, UserRole } from "./types";
export const USER_ROLES: Record<UserRole, string> = {
  teacher: "Преподаватель",
  methodist: "Методист",
  admin: "Администратор",
};
export const AGENT_LABELS = {
  coordinator: "Координатор",
  methodist: "Методист",
  creative: "Креативщик",
  assessment: "Оценщик",
};
export const ACTION_LABELS: Record<string, string> = {
  plan: "План урока",
  lecture: "Лекция",
  practice: "Практическая работа",
  presentation: "Презентация",
  chat: "Сообщение",
  assessment: "Контрольная работа",
  creative_case: "Практический кейс",
  review_sources: "Проверка источников",
  final_review: "Итоговая проверка",
  rup: "РУП",
  ktp: "КТП",
};
export const AUDIT_LABELS: Record<string, string> = {
  change_role: "Изменение роли",
  block: "Блокировка доступа",
  unblock: "Возобновление доступа",
  change_subscription: "Изменение подписки",
  change_organization: "Перевод в колледж",
  change_daily_limit: "Изменение лимита",
  create_organization: "Добавление колледжа",
  bootstrap_initial_admin: "Первый администратор",
};
export function dateLabel(value: string | null | undefined, withTime = false) {
  if (!value) return "—";
  const date = new Date(
    value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : value + "Z",
  );
  return isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Asia/Almaty",
        day: "2-digit",
        month: "short",
        year: "numeric",
        ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
      }).format(date);
}
export function dayValue(value: Date | string = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return ["year", "month", "day"]
    .map((key) => parts.find((p) => p.type === key)!.value)
    .join("-");
}
export function periodFilters(period: string) {
  if (period === "all") return { all_time: true };
  const today = dayValue();
  const start = new Date(today + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() - (Number(period) - 1));
  return { date_from: start.toISOString().slice(0, 10), date_to: today };
}
export function endOfBusinessDay(day: string) {
  const anchor = new Date(day + "T12:00:00Z");
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Almaty",
    timeZoneName: "longOffset",
  })
    .formatToParts(anchor)
    .find((p) => p.type === "timeZoneName")!
    .value.replace("GMT", "");
  return new Date(day + "T23:59:59.999" + (offset || "+00:00")).toISOString();
}
export function duration(value: number | null) {
  if (value === null) return "Нет данных";
  return value < 1000
    ? `${value} мс`
    : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value / 1000)} с`;
}
export function userPatch(
  user: AdminUser,
  state: {
    role: UserRole;
    organization_id: string | null;
    is_active: boolean;
    subscription_until: string | null;
    daily_limit: number;
  },
  reason: string,
): AdminUserPatch {
  const changes: AdminUserPatch = {};
  for (const key of [
    "role",
    "organization_id",
    "is_active",
    "subscription_until",
    "daily_limit",
  ] as const) {
    const current = state[key],
      before = user[key];
    const same =
      key === "subscription_until" && current && before
        ? Date.parse(String(current)) === Date.parse(String(before))
        : current === before;
    if (!same) Object.assign(changes, { [key]: current });
  }
  return Object.keys(changes).length
    ? { ...changes, reason: reason.trim() }
    : changes;
}
