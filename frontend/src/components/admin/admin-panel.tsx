"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  GraduationCap,
  Layers3,
  LockKeyhole,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  School,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ApiError, createApi } from "@/lib/api";
import type {
  AdminAuditLog,
  AdminUser,
  AdminUserPage,
  AdminUserPatch,
  GenerationLog,
  Organization,
  UserProfile,
} from "@/lib/types";
import {
  ACTION_LABELS,
  AGENT_LABELS,
  AUDIT_LABELS,
  USER_ROLES,
  dateLabel,
  duration,
  periodFilters,
} from "@/lib/admin-utils";
import { useAdminData, errorText } from "./admin-data";
import {
  Badge,
  Busy,
  DailyChart,
  Empty,
  Failure,
  Pagination,
} from "./admin-widgets";
import UserEditor from "./user-editor";
import s from "./admin.module.css";
type Api = ReturnType<typeof createApi>;
type Gate = "checking" | "login" | "allowed" | "denied" | "error";
type Tab = "analytics" | "users" | "organizations" | "logs";
export default function AdminPanel() {
  const [session, setSession] = useState<Session | null | undefined>(undefined),
    [me, setMe] = useState<UserProfile | null>(null),
    [gate, setGate] = useState<Gate>("checking"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [check, setCheck] = useState(0);
  const actor = useRef<string | undefined>(undefined);
  actor.current = session?.access_token;
  const api = useMemo(
    () => createApi(session?.access_token),
    [session?.access_token],
  );
  useEffect(() => {
    if (!supabase) {
      setSession(null);
      setGate("login");
      return;
    }
    let alive = true,
      sawEvent = false;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      sawEvent = true;
      if (alive) {
        setSession(next);
        setMe(null);
        setMessage("");
        setGate(next ? "checking" : "login");
      }
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (alive && !sawEvent) {
          setSession(data.session);
          setGate(error ? "error" : data.session ? "checking" : "login");
          if (error)
            setMessage("Не удалось восстановить сессию. Войдите заново.");
        }
      })
      .catch(() => {
        if (alive) {
          setSession(null);
          setGate("login");
        }
      });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  const onFailure = useCallback((error: unknown) => {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      setMe(null);
      setGate(error.status === 403 ? "denied" : "login");
      setMessage(
        error.status === 401
          ? "Сессия истекла. Войдите снова."
          : "У этой учётной записи нет прав администратора",
      );
    }
  }, []);
  useEffect(() => {
    if (!session?.access_token) return;
    const controller = new AbortController(),
      token = session.access_token;
    setGate("checking");
    setMe(null);
    api
      .adminMe(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && actor.current === token) {
          if (value.role !== "admin" || !value.is_active) {
            setGate("denied");
            return;
          }
          setMe(value);
          setGate("allowed");
          setMessage("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && actor.current === token) {
          if (error instanceof ApiError && [401, 403].includes(error.status))
            onFailure(error);
          else {
            setGate("error");
            setMessage(errorText(error));
          }
        }
      });
    return () => controller.abort();
  }, [api, session?.access_token, onFailure, check]);
  useEffect(() => {
    if (!session?.access_token || gate !== "allowed") return;
    const controller = new AbortController();
    const validate = () => {
      if (document.hidden) return;
      api
        .adminMe(controller.signal)
        .then((value) => {
          if (
            !controller.signal.aborted &&
            actor.current === session.access_token
          ) {
            if (value.role !== "admin" || !value.is_active) {
              setMe(null);
              setGate("denied");
            } else setMe(value);
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) onFailure(error);
        });
    };
    const timer = setInterval(validate, 60000);
    window.addEventListener("focus", validate);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", validate);
    };
  }, [api, session?.access_token, gate, onFailure]);
  async function logout() {
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase?.auth.signOut({ scope: "local" });
      if (result?.error) throw result.error;
      setSession(null);
      setMe(null);
      setGate("login");
    } catch {
      setMe(null);
      setGate("error");
      setMessage("Не удалось завершить выход. Повторите попытку.");
    } finally {
      setBusy(false);
    }
  }
  if (session === undefined || gate === "checking")
    return (
      <div className={s.auth}>
        <div className={s.authCard}>
          <Brand />
          <Busy label="Проверяем права администратора…" />
        </div>
      </div>
    );
  if (gate === "allowed" && me && session)
    return (
      <AdminWorkspace
        key={session.access_token}
        api={api}
        me={me}
        email={me.email || session.user.email || me.id}
        onFailure={onFailure}
        logout={logout}
        logoutBusy={busy}
        onSelfChanged={(profile) => {
          if (profile.role !== "admin" || !profile.is_active) {
            setMe(null);
            setGate("denied");
          } else setMe(profile);
        }}
      />
    );
  return (
    <div className={s.auth}>
      <div className={s.authCard}>
        <Brand />
        <div className={s.authIcon}>
          <LockKeyhole size={25} />
        </div>
        <span className={s.eyebrow}>УПРАВЛЕНИЕ ПЛАТФОРМОЙ</span>
        <h1>
          {gate === "denied"
            ? "Доступ ограничен"
            : gate === "error"
              ? "Проверка доступа недоступна"
              : "Вход в админ-панель"}
        </h1>
        {gate === "denied" ? (
          <>
            <p className={s.authDescription} role="alert">
              У этой учётной записи нет прав администратора
            </p>
            <div className={s.accountLine}>
              <Mail size={17} />
              {session?.user.email || "Текущий аккаунт"}
            </div>
            <button className={s.primary} disabled={busy} onClick={logout}>
              <LogOut size={17} />
              Выйти / Войти под другим аккаунтом
            </button>
          </>
        ) : gate === "error" ? (
          <>
            <p className={s.authDescription} role="alert">
              {message || "Не удалось проверить доступ к API."}
            </p>
            <button
              className={s.primary}
              onClick={() =>
                session ? setCheck((n) => n + 1) : setGate("login")
              }
            >
              Повторить проверку
            </button>
            {session && (
              <button className={s.outline} disabled={busy} onClick={logout}>
                Выйти под другим аккаунтом
              </button>
            )}
          </>
        ) : (
          <LoginForm message={message} />
        )}
        <Link href="/" className={s.backLink}>
          <ArrowLeft size={16} />
          Вернуться в рабочее пространство
        </Link>
        <div className={s.authFoot}>
          <ShieldCheck size={16} />
          Права проверяются на сервере
        </div>
      </div>
      <p className={s.authCopyright}>AiEdu · образовательная AI-платформа</p>
    </div>
  );
}
function Brand() {
  return (
    <div className={s.brand}>
      <span className={s.brandIcon}>
        <GraduationCap size={27} />
      </span>
      <strong>
        AiEdu <em>Admin</em>
      </strong>
    </div>
  );
}
function LoginForm({ message }: { message: string }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <p className={s.authDescription}>
        Войдите с учётной записью администратора, чтобы управлять доступами и
        видеть аналитику.
      </p>
      {!supabase && (
        <div className={s.inlineError} role="alert">
          Supabase Auth не настроен. Задайте NEXT_PUBLIC_SUPABASE_URL и
          NEXT_PUBLIC_SUPABASE_ANON_KEY, затем пересоберите frontend.
        </div>
      )}
      <form
        className={s.loginForm}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!supabase || busy) return;
          setBusy(true);
          setError("");
          try {
            const { error } = await supabase.auth.signInWithPassword({
              email: email.trim(),
              password,
            });
            if (error) {
              setError(
                error.code === "invalid_credentials"
                  ? "Неверный email или пароль."
                  : "Не удалось войти. Проверьте данные и доступность Supabase.",
              );
            } else setPassword("");
          } catch {
            setError("Нет соединения с сервисом авторизации.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy || !supabase} className={s.fields}>
          <label>
            Email
            <input
              type="email"
              value={email}
              autoComplete="username"
              required
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@college.kz"
            />
          </label>
          <label>
            Пароль
            <div className={s.passwordField}>
              <input
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Введите пароль"
              />
              <button
                type="button"
                aria-label={show ? "Скрыть пароль" : "Показать пароль"}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          <button className={s.primary} disabled={busy || !supabase}>
            {busy ? <span className={s.spinner} /> : <LockKeyhole size={17} />}
            Войти в админ-панель
          </button>
        </fieldset>
        {(error || message) && (
          <p className={s.inlineError} role="alert">
            {error || message}
          </p>
        )}
      </form>
    </>
  );
}
function AdminWorkspace({
  api,
  me,
  email,
  onFailure,
  logout,
  logoutBusy,
  onSelfChanged,
}: {
  api: Api;
  me: UserProfile;
  email: string;
  onFailure: (e: unknown) => void;
  logout: () => Promise<void>;
  logoutBusy: boolean;
  onSelfChanged: (value: UserProfile) => void;
}) {
  const [tab, setTab] = useState<Tab>("analytics"),
    [refresh, setRefresh] = useState(0),
    [notice, setNotice] = useState(""),
    [editing, setEditing] = useState<AdminUser | null>(null);
  const fetchOrganizations = useCallback(
    (signal: AbortSignal) => api.adminOrganizations(signal),
    [api],
  );
  const organizations = useAdminData(fetchOrganizations, onFailure, refresh);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 6000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const refreshAll = () => setRefresh((n) => n + 1);
  async function saveUser(body: AdminUserPatch) {
    if (!editing) return;
    try {
      const saved = await api.updateAdminUser(editing.id, body);
      setEditing(null);
      setNotice("Изменения сохранены и записаны в аудит");
      refreshAll();
      if (saved.id === me.id) onSelfChanged(saved);
    } catch (error) {
      onFailure(error);
      throw new Error(errorText(error));
    }
  }
  const tabs: [Tab, string, typeof BarChart3][] = [
    ["analytics", "Аналитика", BarChart3],
    ["users", "Пользователи и доступы", UsersRound],
    ["organizations", "Колледжи", School],
    ["logs", "Журнал и аудит", ScrollText],
  ];
  return (
    <div className={s.shell}>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Link
            href="/admin"
            aria-label="AiEdu Admin — обзор"
            onClick={(e) => {
              e.preventDefault();
              setTab("analytics");
            }}
          >
            <Brand />
          </Link>
          <div className={s.headerActions}>
            <span className={s.adminEmail} title={email}>
              <span className={s.avatar}>
                {email.slice(0, 2).toUpperCase()}
              </span>
              {email}
            </span>
            <Link className={s.outline} href="/">
              <ArrowLeft size={16} />В учительскую
            </Link>
            <button
              className={s.iconButton}
              title="Выйти"
              aria-label="Выйти"
              disabled={logoutBusy}
              onClick={logout}
            >
              <LogOut size={19} />
            </button>
          </div>
        </div>
      </header>
      <div className={s.navWrap}>
        <nav className={s.tabs} aria-label="Разделы админ-панели">
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? s.tabActive : s.tab}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
      </div>
      <main className={s.main}>
        <div className={s.breadcrumb}>
          <span>Администрирование</span>
          <ChevronRight size={13} />
          {tabs.find((t) => t[0] === tab)?.[1]}
        </div>
        <div className={s.pageHeading}>
          <div>
            <span className={s.eyebrow}>AIEDU PLATFORM</span>
            <h1>
              {tab === "analytics"
                ? "Обзор платформы"
                : tab === "users"
                  ? "Пользователи и доступы"
                  : tab === "organizations"
                    ? "Колледжи и организации"
                    : "Журнал генераций и аудит"}
            </h1>
            <p>
              {tab === "analytics"
                ? "Активность преподавателей, работа ИИ и учебные заведения — в одном месте."
                : tab === "users"
                  ? "Управляйте ролями, подписками и дневными лимитами."
                  : tab === "organizations"
                    ? "Официальные учебные заведения и привязанные преподаватели."
                    : "История обращений к моделям и изменений административных прав."}
            </p>
          </div>
          <button className={s.outline} onClick={refreshAll}>
            <RefreshCw size={16} />
            Обновить
          </button>
        </div>
        {organizations.error && (
          <Failure message={organizations.error} retry={refreshAll} />
        )}
        {tab === "analytics" && (
          <Overview
            api={api}
            refresh={refresh}
            onFailure={onFailure}
            retry={refreshAll}
          />
        )}{" "}
        {tab === "users" && (
          <Users
            api={api}
            organizations={organizations.data || []}
            organizationsLoading={organizations.loading}
            organizationsError={!!organizations.error}
            refresh={refresh}
            onFailure={onFailure}
            retry={refreshAll}
            edit={setEditing}
          />
        )}{" "}
        {tab === "organizations" && (
          <Organizations
            api={api}
            state={organizations}
            onFailure={onFailure}
            saved={() => {
              setNotice("Колледж добавлен");
              refreshAll();
            }}
          />
        )}
        {tab === "logs" && (
          <Logs
            api={api}
            organizations={organizations.data || []}
            refresh={refresh}
            onFailure={onFailure}
            retry={refreshAll}
          />
        )}
        <footer className={s.footer}>
          <span>AiEdu Admin</span>
          <span>
            <ShieldCheck size={14} />
            Административные операции фиксируются на сервере
          </span>
        </footer>
      </main>
      {notice && (
        <div className={s.toast} role="status">
          <CheckCircle2 size={19} />
          {notice}
          <button
            aria-label="Закрыть уведомление"
            onClick={() => setNotice("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {editing && (
        <UserEditor
          user={editing}
          organizations={organizations.data || []}
          onClose={() => setEditing(null)}
          onSave={saveUser}
        />
      )}
    </div>
  );
}
function Overview({
  api,
  refresh,
  onFailure,
  retry,
}: {
  api: Api;
  refresh: number;
  onFailure: (e: unknown) => void;
  retry: () => void;
}) {
  const [period, setPeriod] = useState("30");
  const loader = useCallback(
    (signal: AbortSignal) => api.adminAnalytics(periodFilters(period), signal),
    [api, period],
  );
  const state = useAdminData(loader, onFailure, refresh);
  const metrics = state.data;
  const format = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
  return (
    <>
      <div className={s.overviewToolbar}>
        <div className={s.sectionLabel}>
          <span className={s.liveDot} />
          Показатели платформы
        </div>
        <div className={s.periods} aria-label="Период аналитики">
          {[
            ["1", "Сегодня"],
            ["7", "7 дней"],
            ["30", "30 дней"],
            ["all", "Всё время"],
          ].map(([key, text]) => (
            <button
              key={key}
              aria-pressed={period === key}
              className={period === key ? s.periodActive : ""}
              onClick={() => setPeriod(key)}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      {state.loading ? (
        <>
          <div className={s.kpiGrid}>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className={s.skeleton} />
            ))}
          </div>
          <Busy />
        </>
      ) : state.error ? (
        <Failure message={state.error} retry={retry} />
      ) : (
        metrics && (
          <>
            <div className={s.periodCaption}>
              {dateLabel(metrics.date_from + "T12:00:00Z")} —{" "}
              {dateLabel(metrics.date_to + "T12:00:00Z")}{" "}
              <span>· {metrics.timezone}</span>
            </div>
            <div className={s.kpiGrid}>
              <Kpi
                icon={UsersRound}
                label="Всего преподавателей"
                value={format(metrics.total_teachers)}
                hint={`${format(metrics.total_users)} учётных записей всего`}
              />
              <Kpi
                icon={BookOpen}
                label="Активных за 24 часа"
                value={format(metrics.active_24h)}
                hint={`За 7 дней: ${format(metrics.active_7d)} пользователей`}
              />
              <Kpi
                icon={Sparkles}
                label="Генераций за период"
                value={format(metrics.total_generations)}
                hint={
                  metrics.in_flight_generations
                    ? `Незавершённых обращений: ${metrics.in_flight_generations}`
                    : "Учтены реальные обращения к моделям"
                }
              />
              <Kpi
                icon={CheckCircle2}
                label="Успешных / ошибок"
                value={
                  <>
                    {format(metrics.success)}{" "}
                    <span className={s.kpiDivider}>/</span>{" "}
                    <span className={s.errorValue}>
                      {format(metrics.error)}
                    </span>
                  </>
                }
                hint={
                  metrics.total_generations
                    ? `${Math.round((metrics.success / metrics.total_generations) * 100)}% обращений завершены успешно`
                    : "За период нет обращений"
                }
                warm
              />
              <Kpi
                icon={Clock3}
                label="Среднее время"
                value={
                  metrics.average_duration_ms === null
                    ? "—"
                    : duration(metrics.average_duration_ms)
                }
                hint={
                  metrics.average_duration_ms === null
                    ? "Нет завершённых измерений"
                    : "На одно обращение, включая ошибки"
                }
              />
            </div>
            <div className={s.chartGrid}>
              <section className={s.panel}>
                <div className={s.panelHead}>
                  <div>
                    <h2>Динамика генераций</h2>
                    <p>Обращения к ИИ-моделям по дням</p>
                  </div>
                  <div className={s.legend}>
                    <span>
                      <i />
                      Успешно
                    </span>
                    <span>
                      <i className={s.orangeDot} />
                      Ошибка
                    </span>
                  </div>
                </div>
                <DailyChart days={metrics.by_day} />
              </section>
              <section className={s.panel}>
                <div className={s.panelHead}>
                  <div>
                    <h2>Популярность агентов</h2>
                    <p>Количество реальных LLM-вызовов</p>
                  </div>
                  <Layers3 size={20} />
                </div>
                <div className={s.agentList}>
                  {Object.entries(AGENT_LABELS).map(([key, label], i) => {
                    const count =
                        metrics.by_agent[
                          key as keyof typeof metrics.by_agent
                        ] || 0,
                      max = Math.max(1, ...Object.values(metrics.by_agent));
                    return (
                      <div className={s.agentRow} key={key}>
                        <div>
                          <span className={i === 2 ? s.agentWarm : s.agentIcon}>
                            <Sparkles size={17} />
                          </span>
                          <strong>{label}</strong>
                          <span>{format(count)}</span>
                        </div>
                        <div className={s.progress}>
                          <span style={{ width: `${(count / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className={s.panelNote}>
                  Роли ИИ-агентов не связаны с ролями доступа пользователей.
                </p>
              </section>
            </div>
            <section className={s.panel}>
              <div className={s.panelHead}>
                <div>
                  <h2>Активность по колледжам</h2>
                  <p>
                    Привязанные преподаватели и генерации за выбранный период
                  </p>
                </div>
                <School size={21} />
              </div>
              <div className={s.tableScroll}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Учебное заведение</th>
                      <th>Преподаватели</th>
                      <th>Генерации</th>
                      <th>Успешно</th>
                      <th>Ошибки</th>
                      <th>Доля генераций</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.by_organization
                      .filter(
                        (row) =>
                          row.organization_id ||
                          row.generations ||
                          row.teachers,
                      )
                      .map((row) => (
                        <tr key={row.organization_id || "unassigned"}>
                          <td>
                            <div className={s.organizationName}>
                              <span className={s.schoolIcon}>
                                <School size={17} />
                              </span>
                              <strong>
                                {row.name || "Без привязки к колледжу"}
                              </strong>
                            </div>
                          </td>
                          <td>{format(row.teachers)}</td>
                          <td>
                            <strong>{format(row.generations)}</strong>
                          </td>
                          <td>{format(row.success)}</td>
                          <td>
                            <span className={row.error ? s.errorText : ""}>
                              {format(row.error)}
                            </span>
                          </td>
                          <td>
                            <div className={s.share}>
                              <div className={s.progress}>
                                <span
                                  style={{
                                    width: `${metrics.total_generations ? (row.generations / metrics.total_generations) * 100 : 0}%`,
                                  }}
                                />
                              </div>
                              <span>
                                {metrics.total_generations
                                  ? Math.round(
                                      (row.generations /
                                        metrics.total_generations) *
                                        100,
                                    )
                                  : 0}
                                %
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!metrics.by_organization.some(
                  (row) =>
                    row.organization_id || row.generations || row.teachers,
                ) && (
                  <Empty
                    title="Колледжи ещё не добавлены"
                    text="Добавьте официальные учебные заведения на вкладке «Колледжи»."
                  />
                )}
              </div>
            </section>
            <p className={s.meta}>
              Активность пользователей — обращения к API. Исторические
              генерации, для которых не велись логи, в эти показатели не
              добавляются.
            </p>
          </>
        )
      )}
    </>
  );
}
function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  warm = false,
}: {
  icon: typeof UsersRound;
  label: string;
  value: React.ReactNode;
  hint: string;
  warm?: boolean;
}) {
  return (
    <section className={s.kpi}>
      <div className={s.kpiTop}>
        <span>{label}</span>
        <span className={warm ? s.kpiWarm : s.kpiIcon}>
          <Icon size={19} />
        </span>
      </div>
      <div className={s.kpiValue}>{value}</div>
      <p>{hint}</p>
    </section>
  );
}
function Users({
  api,
  organizations,
  organizationsLoading,
  organizationsError,
  refresh,
  onFailure,
  retry,
  edit,
}: {
  api: Api;
  organizations: Organization[];
  organizationsLoading: boolean;
  organizationsError: boolean;
  refresh: number;
  onFailure: (error: unknown) => void;
  retry: () => void;
  edit: (user: AdminUser) => void;
}) {
  const [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [role, setRole] = useState(""),
    [org, setOrg] = useState(""),
    [active, setActive] = useState(""),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.adminUsers(
        {
          q,
          role: (role as AdminUser["role"]) || undefined,
          organization_id: org || undefined,
          is_active: active === "" ? undefined : active === "true",
          offset,
          limit: 20,
        },
        signal,
      ),
    [api, q, role, org, active, offset],
  );
  const state = useAdminData<AdminUserPage>(loader, onFailure, refresh);
  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <div>
          <h2>Пользователи платформы</h2>
          <p>
            {state.data
              ? `Найдено: ${state.data.total}`
              : "Учётные записи и доступ к генерациям"}
          </p>
        </div>
        <UsersRound size={21} />
      </div>
      <div className={s.filters}>
        <label className={s.searchField}>
          <span>Поиск по имени или email</span>
          <div>
            <Search size={18} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Имя или email"
            />
          </div>
        </label>
        <label>
          Колледж
          <select
            value={org}
            onChange={(e) => {
              setOrg(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Все колледжи</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Роль
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Все роли</option>
            {Object.entries(USER_ROLES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Статус аккаунта
          <select
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Все статусы</option>
            <option value="true">Активен</option>
            <option value="false">Заблокирован</option>
          </select>
        </label>
      </div>
      {state.loading ? (
        <Busy />
      ) : state.error ? (
        <Failure message={state.error} retry={retry} />
      ) : (
        state.data && (
          <>
            <div className={s.tableScroll}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Колледж</th>
                    <th>Роль</th>
                    <th>Статус доступа</th>
                    <th>Подписка до</th>
                    <th>Сегодня / лимит</th>
                    <th>Всего генераций</th>
                    <th>
                      <span className={s.srOnly}>Действия</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.map((user) => {
                    const college = organizations.find(
                        (o) => o.id === user.organization_id,
                      ),
                      expired =
                        !!user.subscription_until &&
                        Date.parse(user.subscription_until) < Date.now();
                    return (
                      <tr key={user.id}>
                        <td>
                          <strong>{user.full_name || "Без имени"}</strong>
                          <small>{user.email || user.id}</small>
                        </td>
                        <td>
                          {college?.name || user.institution || "Без привязки"}
                          {!college && user.institution && (
                            <small>Без официальной привязки</small>
                          )}
                        </td>
                        <td>
                          <Badge
                            tone={user.role === "admin" ? "blue" : "neutral"}
                          >
                            {USER_ROLES[user.role]}
                          </Badge>
                        </td>
                        <td>
                          <Badge
                            tone={
                              !user.is_active
                                ? "bad"
                                : expired || college?.is_active === false
                                  ? "warm"
                                  : "good"
                            }
                          >
                            {!user.is_active
                              ? "Заблокирован"
                              : expired
                                ? "Подписка истекла"
                                : college?.is_active === false
                                  ? "Колледж отключён"
                                  : "Активен"}
                          </Badge>
                        </td>
                        <td>
                          {user.subscription_until
                            ? dateLabel(user.subscription_until)
                            : "Бессрочно"}
                        </td>
                        <td>
                          <strong>{user.generations_today}</strong> /{" "}
                          {user.daily_limit}
                        </td>
                        <td>{user.generations_total}</td>
                        <td>
                          <button
                            className={s.textButton}
                            disabled={
                              organizationsLoading || organizationsError
                            }
                            onClick={() => edit(user)}
                            aria-label={`Изменить доступ: ${user.full_name || user.email || user.id}`}
                          >
                            <SlidersHorizontal size={16} />
                            Изменить
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!state.data.items.length && (
                <Empty
                  title="Пользователи не найдены"
                  text="Измените условия поиска или фильтры."
                />
              )}
            </div>
            <Pagination
              offset={offset}
              total={state.data.total}
              limit={20}
              onPage={setOffset}
            />
          </>
        )
      )}
    </section>
  );
}
function Organizations({
  api,
  state,
  onFailure,
  saved,
}: {
  api: Api;
  state: { data: Organization[] | null; loading: boolean; error: string };
  onFailure: (error: unknown) => void;
  saved: () => void;
}) {
  const [name, setName] = useState(""),
    [active, setActive] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className={s.organizationGrid}>
      <section className={s.panel}>
        <div className={s.panelHead}>
          <div>
            <h2>Официальные колледжи</h2>
            <p>Привязка учётных записей задаётся администратором.</p>
          </div>
          <School size={21} />
        </div>
        {state.loading ? (
          <Busy />
        ) : (
          state.data && (
            <div className={s.tableScroll}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Колледж</th>
                    <th>Преподаватели</th>
                    <th>Статус</th>
                    <th>Добавлен</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.map((org) => (
                    <tr key={org.id}>
                      <td>
                        <strong>{org.name}</strong>
                      </td>
                      <td>{org.teachers_count}</td>
                      <td>
                        <Badge tone={org.is_active ? "good" : "bad"}>
                          {org.is_active ? "Активен" : "Отключён"}
                        </Badge>
                      </td>
                      <td>{dateLabel(org.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!state.data.length && (
                <Empty
                  title="Колледжей пока нет"
                  text="Добавьте первое учебное заведение через форму."
                />
              )}
            </div>
          )
        )}
      </section>
      <section className={s.panel}>
        <div className={s.panelHead}>
          <div>
            <h2>Добавить колледж</h2>
            <p>Название будет доступно при назначении пользователей.</p>
          </div>
          <Plus size={21} />
        </div>
        <form
          className={s.createForm}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || busy) return;
            setBusy(true);
            setError("");
            try {
              await api.addAdminOrganization({
                name: name.trim(),
                is_active: active,
              });
              setName("");
              setActive(true);
              saved();
            } catch (error) {
              onFailure(error);
              setError(errorText(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Название колледжа
            <input
              value={name}
              maxLength={255}
              required
              disabled={busy}
              placeholder="Название учебного заведения"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className={s.checkboxLabel}>
            <input
              type="checkbox"
              checked={active}
              disabled={busy}
              onChange={(e) => setActive(e.target.checked)}
            />
            Активный колледж
          </label>
          {error && (
            <p role="alert" className={s.inlineError}>
              {error}
            </p>
          )}
          <button className={s.primary} disabled={busy || !name.trim()}>
            {busy ? <span className={s.spinner} /> : <Plus size={17} />}Добавить
            колледж
          </button>
          <p className={s.meta}>
            Существующие аккаунты не связываются с колледжем автоматически.
          </p>
        </form>
      </section>
    </div>
  );
}
function Logs({
  api,
  organizations,
  refresh,
  onFailure,
  retry,
}: {
  api: Api;
  organizations: Organization[];
  refresh: number;
  onFailure: (error: unknown) => void;
  retry: () => void;
}) {
  const [mode, setMode] = useState("generations");
  return (
    <>
      <div className={s.segmented} aria-label="Тип журнала">
        <button
          aria-pressed={mode === "generations"}
          className={mode === "generations" ? s.segmentActive : ""}
          onClick={() => setMode("generations")}
        >
          <Sparkles size={16} />
          Логи ИИ-генераций
        </button>
        <button
          aria-pressed={mode === "audit"}
          className={mode === "audit" ? s.segmentActive : ""}
          onClick={() => setMode("audit")}
        >
          <ShieldCheck size={16} />
          Аудит действий админа
        </button>
      </div>
      {mode === "generations" ? (
        <GenerationFeed
          api={api}
          organizations={organizations}
          refresh={refresh}
          onFailure={onFailure}
          retry={retry}
        />
      ) : (
        <AuditFeed
          api={api}
          organizations={organizations}
          refresh={refresh}
          onFailure={onFailure}
          retry={retry}
        />
      )}
    </>
  );
}
type FeedProps = {
  api: Api;
  organizations: Organization[];
  refresh: number;
  onFailure: (error: unknown) => void;
  retry: () => void;
};
function GenerationFeed({
  api,
  organizations,
  refresh,
  onFailure,
  retry,
}: FeedProps) {
  const [status, setStatus] = useState(""),
    [org, setOrg] = useState("");
  const loader = useCallback(
    (signal: AbortSignal) =>
      api.adminLogs(
        {
          status: (status as "success" | "error") || undefined,
          organization_id: org || undefined,
        },
        signal,
      ),
    [api, status, org],
  );
  const state = useAdminData<GenerationLog[]>(loader, onFailure, refresh);
  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <div>
          <h2>Последние генерации</h2>
          <p>До 100 последних обращений к моделям с учётом фильтров.</p>
        </div>
        <ScrollText size={21} />
      </div>
      <div className={s.filters}>
        <label>
          Статус
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Все статусы</option>
            <option value="success">Успешно</option>
            <option value="error">Ошибка</option>
          </select>
        </label>
        <label>
          Колледж
          <select value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">Все колледжи</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state.loading ? (
        <Busy />
      ) : state.error ? (
        <Failure message={state.error} retry={retry} />
      ) : (
        state.data && (
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Дата и пользователь</th>
                  <th>Колледж</th>
                  <th>Агент / действие</th>
                  <th>Модель</th>
                  <th>Время</th>
                  <th>Токены</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <strong>
                        {log.user_name || log.user_email || log.user_id}
                      </strong>
                      <small>{dateLabel(log.created_at, true)}</small>
                    </td>
                    <td>
                      {log.organization_name ||
                        organizations.find((o) => o.id === log.organization_id)
                          ?.name ||
                        "Без привязки"}
                    </td>
                    <td>
                      {AGENT_LABELS[
                        log.agent_type as keyof typeof AGENT_LABELS
                      ] || log.agent_type}
                      <small>
                        {ACTION_LABELS[log.action_type] || log.action_type}
                      </small>
                    </td>
                    <td>{log.model_name}</td>
                    <td>{duration(log.duration_ms)}</td>
                    <td>
                      {log.tokens_reported ? log.tokens_used : "Нет данных"}
                    </td>
                    <td>
                      <Badge tone={log.status === "success" ? "good" : "bad"}>
                        {log.status === "success" ? "Успешно" : "Ошибка"}
                      </Badge>
                      {log.error_message && (
                        <details className={s.errorDetails}>
                          <summary title={log.error_message}>
                            Текст ошибки
                          </summary>
                          <p>{log.error_message}</p>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!state.data.length && (
              <Empty
                title="Записей не найдено"
                text="Новые обращения к моделям появятся здесь после выполнения."
              />
            )}
          </div>
        )
      )}
    </section>
  );
}
function AuditFeed({
  api,
  organizations,
  refresh,
  onFailure,
  retry,
}: FeedProps) {
  const [offset, setOffset] = useState(0);
  const loader = useCallback(
    (signal: AbortSignal) => api.adminAudit(offset, signal),
    [api, offset],
  );
  const state = useAdminData<AdminAuditLog[]>(loader, onFailure, refresh);
  const value = (field: string, input: unknown): string => {
    if (input === null)
      return field === "subscription_until" ? "Бессрочно" : "Без привязки";
    if (field === "role")
      return USER_ROLES[input as keyof typeof USER_ROLES] || String(input);
    if (field === "organization_id")
      return organizations.find((o) => o.id === input)?.name || String(input);
    if (field === "is_active") return input ? "Включён" : "Заблокирован";
    if (field === "subscription_until") return dateLabel(String(input), true);
    return typeof input === "object" ? JSON.stringify(input) : String(input);
  };
  const fields: Record<string, string> = {
    role: "Роль",
    organization_id: "Колледж",
    is_active: "Доступ",
    subscription_until: "Подписка",
    daily_limit: "Дневной лимит",
  };
  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <div>
          <h2>Действия администраторов</h2>
          <p>Серверный журнал изменений прав и подписок.</p>
        </div>
        <ShieldCheck size={21} />
      </div>
      {state.loading ? (
        <Busy />
      ) : state.error ? (
        <Failure message={state.error} retry={retry} />
      ) : (
        state.data && (
          <>
            <div className={s.tableScroll}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Администратор</th>
                    <th>Пользователь</th>
                    <th>Действие</th>
                    <th>Изменения</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.map((log) => (
                    <tr key={log.id}>
                      <td>{dateLabel(log.created_at, true)}</td>
                      <td>
                        {log.admin_name || log.admin_id || "Системная команда"}
                      </td>
                      <td>
                        {log.target_user_name || log.target_user_id || "—"}
                      </td>
                      <td>{AUDIT_LABELS[log.action] || log.action}</td>
                      <td className={s.auditChanges}>
                        {Object.entries(
                          (typeof log.details.field === "string"
                            ? {
                                [log.details.field]: {
                                  before: log.details.before,
                                  after: log.details.after,
                                },
                              }
                            : log.details.changes || {}) as Record<
                            string,
                            { before: unknown; after: unknown }
                          >,
                        ).map(([key, change]) => (
                          <div key={key}>
                            <strong>{fields[key] || key}: </strong>
                            {value(key, change.before)} →{" "}
                            {value(key, change.after)}
                          </div>
                        ))}
                        {typeof log.details.name === "string" && (
                          <div>{log.details.name}</div>
                        )}
                        {typeof log.details.reason === "string" && (
                          <small>Причина: {log.details.reason}</small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!state.data.length && (
                <Empty
                  title="Действий пока нет"
                  text="Здесь фиксируются сохранённые изменения доступа и добавление колледжей."
                />
              )}
            </div>
            <div className={s.pagination}>
              <span>Страница {offset / 100 + 1}</span>
              <div>
                <button
                  className={s.outline}
                  disabled={!offset}
                  onClick={() => setOffset(Math.max(0, offset - 100))}
                >
                  Назад
                </button>
                <button
                  className={s.outline}
                  disabled={state.data.length < 100}
                  onClick={() => setOffset(offset + 100)}
                >
                  Далее
                </button>
              </div>
            </div>
          </>
        )
      )}
    </section>
  );
}
