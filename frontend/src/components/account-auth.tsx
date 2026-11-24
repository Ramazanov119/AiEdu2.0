"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

const colleges = ["ETEC", "META", "ALT", "Q", "ATKK"] as const;

function authError(error: unknown, registering: boolean): string {
  const reason = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error || "Неизвестная ошибка");
  const explanations: Record<string, string> = {
    "Invalid login credentials": "Проверьте email и пароль.",
    "Email not confirmed": "Подтвердите email по ссылке в письме.",
    "User already registered": "Этот email уже зарегистрирован. Перейдите в режим «Войти».",
    "Database error saving new user": "Supabase не смог сохранить пользователя. Причина может быть в обработке профиля на сервере.",
    "Failed to fetch": "Не удалось связаться с Supabase. Проверьте соединение и повторите попытку.",
  };
  return `${registering ? "Не удалось зарегистрироваться" : "Не удалось войти"}. ${explanations[reason] || ""} Причина: ${reason}`;
}

export default function AccountAuth({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [college, setCollege] = useState<string>("ETEC");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const registering = mode === "register";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setNotice("");
    if (registering && (!fullName.trim() || !colleges.some((value) => value === college))) {
      setError("Укажите ФИО преподавателя и выберите колледж.");
      return;
    }
    if (!supabase) {
      setError("Supabase Auth не настроен. Обратитесь к администратору.");
      return;
    }
    setPending(true);
    try {
      if (registering) {
        const result = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim(), college } },
        });
        if (result.error) throw result.error;
        setPassword("");
        if (result.data.session) onAuthenticated();
        else setNotice("Заявка на регистрацию отправлена. Проверьте почту и подтвердите email, затем войдите в аккаунт.");
      } else {
        const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw result.error;
        setPassword("");
        onAuthenticated();
      }
    } catch (cause) {
      setError(authError(cause, registering));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)} aria-busy={pending}>
      <div className="auth-modes" role="group" aria-label="Режим аккаунта">
        {(["login", "register"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={mode === value} disabled={pending}
            className={mode === value ? "primary" : "secondary"}
            onClick={() => { setMode(value); setError(""); setNotice(""); }}>
            {value === "login" ? "Войти" : "Регистрация"}
          </button>
        ))}
      </div>
      {registering && <>
        <label htmlFor="auth-full-name">ФИО преподавателя
          <input id="auth-full-name" name="full_name" autoComplete="name" required maxLength={200}
            value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={pending} />
        </label>
        <label htmlFor="auth-college">Колледж
          <select id="auth-college" name="college" required value={college}
            onChange={(event) => setCollege(event.target.value)} disabled={pending}>
            {colleges.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </>}
      <label htmlFor="auth-email">Email
        <input id="auth-email" name="email" type="email" autoComplete="email" required value={email}
          onChange={(event) => setEmail(event.target.value)} disabled={pending} />
      </label>
      <label htmlFor="auth-password">Пароль
        <input id="auth-password" name="password" type="password" autoComplete={registering ? "new-password" : "current-password"}
          required minLength={registering ? 6 : undefined} value={password}
          onChange={(event) => setPassword(event.target.value)} disabled={pending} />
      </label>
      {error && <div className="auth-feedback error" role="alert">{error}</div>}
      {notice && <div className="auth-feedback" role="status">{notice}</div>}
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Подождите…" : registering ? "Создать аккаунт" : "Войти в аккаунт"}
      </button>
    </form>
  );
}
