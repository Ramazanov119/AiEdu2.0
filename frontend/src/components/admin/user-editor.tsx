"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ShieldCheck, X, CalendarDays } from "lucide-react";
import type {
  AdminUser,
  AdminUserPatch,
  Organization,
  UserRole,
} from "@/lib/types";
import {
  USER_ROLES,
  dateLabel,
  dayValue,
  endOfBusinessDay,
  userPatch,
} from "@/lib/admin-utils";
import s from "./admin.module.css";
export default function UserEditor({
  user,
  organizations,
  onClose,
  onSave,
}: {
  user: AdminUser;
  organizations: Organization[];
  onClose: () => void;
  onSave: (body: AdminUserPatch) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [role, setRole] = useState<UserRole>(user.role),
    [org, setOrg] = useState(user.organization_id || ""),
    [active, setActive] = useState(user.is_active),
    [until, setUntil] = useState<string | null>(user.subscription_until),
    [limit, setLimit] = useState(String(user.daily_limit)),
    [limitV1, setLimitV1] = useState(
      user.daily_limit_v1 !== undefined && user.daily_limit_v1 !== null
        ? String(user.daily_limit_v1)
        : "",
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const patch = userPatch(
    user,
    {
      role,
      organization_id: org || null,
      is_active: active,
      subscription_until: until,
      daily_limit: Number(limit),
      daily_limit_v1: limitV1 === "" ? null : Number(limitV1),
    },
    reason,
  );
  const dirty = Object.keys(patch).length > 0;
  function extend(days: number) {
    setUntil(
      new Date(
        Math.max(Date.now(), until ? Date.parse(until) : 0) + days * 86400000,
      ).toISOString(),
    );
  }
  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby="edit-user-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className={s.dialogHead}>
        <div className={s.dialogIcon}>
          <ShieldCheck size={23} />
        </div>
        <button
          className={s.iconButton}
          disabled={busy}
          aria-label="Закрыть редактирование"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <h2 id="edit-user-title">Доступ пользователя</h2>
      <p className={s.subtext}>
        {user.full_name || "Без имени"} · {user.email || user.id}
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!dirty || busy) return;
          if (
            !Number.isInteger(Number(limit)) ||
            Number(limit) < 0 ||
            Number(limit) > 1000000 ||
            !limit
          ) {
            setError("Укажите целый дневной лимит AiEdu 2.0 от 0 до 1 000 000.");
            return;
          }
          if (
            limitV1 !== "" &&
            (!Number.isInteger(Number(limitV1)) ||
              Number(limitV1) < 0 ||
              Number(limitV1) > 1000000)
          ) {
            setError("Укажите целый дневной лимит AiEdu 1.0 от 0 до 1 000 000.");
            return;
          }
          if (reason.trim().length < 3) {
            setError("Укажите причину изменения: минимум 3 символа.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            await onSave(patch);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Не удалось сохранить изменения.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className={s.fields}>
          <div className={s.formColumns}>
            <label>
              Роль
              <select
                aria-label="Роль"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
              >
                {Object.entries(USER_ROLES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Официальный колледж
              <select value={org} onChange={(e) => setOrg(e.target.value)}>
                <option value="">Без привязки</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {!o.is_active ? " · отключён" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={s.switchRow}>
            <div>
              <strong>Доступ включён</strong>
              <small>При выключении новые генерации будут запрещены.</small>
            </div>
            <input
              aria-label="Доступ включён"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
          </label>
          <div className={s.expiryBox}>
            <div className={s.fieldHeading}>
              <CalendarDays size={18} />
              <strong>Срок подписки</strong>
              <span>{until ? dateLabel(until) : "Бессрочно"}</span>
            </div>
            <label>
              Подписка действует до
              <input
                type="date"
                value={until ? dayValue(until) : ""}
                onChange={(e) =>
                  setUntil(
                    e.target.value ? endOfBusinessDay(e.target.value) : null,
                  )
                }
              />
            </label>
            <div className={s.quickButtons}>
              <button type="button" onClick={() => extend(30)}>
                +30 дней
              </button>
              <button type="button" onClick={() => extend(90)}>
                +90 дней
              </button>
              <button type="button" onClick={() => setUntil(null)}>
                Бессрочно
              </button>
              <button
                type="button"
                title="Вернуть исходную дату"
                onClick={() => setUntil(user.subscription_until)}
              >
                Сбросить
              </button>
            </div>
            <p className={s.meta}>
              Сбросить — вернуть исходную дату. Выбранная дата действует до
              конца суток Asia/Almaty.
            </p>
          </div>
          <div className={s.formColumns}>
            <label>
              Дневной лимит AiEdu 2.0
              <input
                type="number"
                min="0"
                max="1000000"
                step="1"
                required
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
              <small>
                Сегодня использовано: {user.generations_today}. Лимит 0 запрещает
                генерации.
              </small>
            </label>
            <label>
              Дневной лимит AiEdu 1.0
              <input
                type="number"
                min="0"
                max="1000000"
                step="1"
                placeholder="20"
                value={limitV1}
                onChange={(e) => setLimitV1(e.target.value)}
              />
              <small>
                Лимит для версии AiEdu 1.0. Лимит 0 запрещает генерации.
              </small>
            </label>
          </div>
          <label>
            Причина изменения
            <textarea
              rows={2}
              minLength={3}
              maxLength={1000}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: продление по подтверждённой оплате"
            />
          </label>
          <div className={s.auditNote}>
            <ShieldCheck size={16} />
            <span>
              Роль, доступ, колледж и лимиты изменятся только после сохранения.
              Операция попадёт в журнал аудита.
            </span>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className={s.inlineError}>
            {error}
          </p>
        )}
        <div className={s.dialogActions}>
          <button
            type="button"
            className={s.outline}
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button className={s.primary} disabled={busy || !dirty}>
            {busy ? <span className={s.spinner} /> : <Check size={17} />}
            Сохранить изменения
          </button>
        </div>
      </form>
    </dialog>
  );
}
