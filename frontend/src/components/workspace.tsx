"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { UserProfile } from "@/lib/types";
import type { Session } from "@supabase/supabase-js";
import dynamic from "next/dynamic";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MonitorPlay,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  Users,
  X,
  Zap,
  AlertTriangle,
  Play,
  Pause,
  ArrowRight,
  Layers,
  Loader2,
  CircleHelp,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { createApi } from "@/lib/api";
import { translations, Tab } from "@/lib/i18n";
import {
  Lesson,
  LlmStatus,
  Material,
  Message,
  OfficeEvent,
  PortfolioFile,
  ROLE_NAMES,
  ROLES,
  Role,
  RupData,
  STATUS_NAMES,
  MATERIAL_NAMES,
  Task,
  agentsFrom,
} from "@/lib/types";
import { demoAgents, demoEvents, demoLessons, demoMessages } from "@/lib/demo";
const OfficeScene = dynamic(() => import("./office/OfficeScene"), {
  ssr: false,
  loading: () => (
    <div className="scene-loading">
      <Loader2 className="spin" /> Загружаем виртуальную учительскую…
    </div>
  ),
});
const eventNames: Record<string, string> = {
  lesson_queued: "Задача создана",
  analysis_started: "Анализ РУП начат",
  material_started: "Агент начал работу",
  material_completed: "Материал создан",
  material_failed: "Ошибка создания материала",
  lesson_completed: "Комплект готов к проверке преподавателем",
  lesson_failed: "Не удалось завершить комплект",
  lesson_review: "Решение преподавателя",
  material_edited: "Материал отредактирован",
  confirm_rup: "РУП подтверждена",
  upload_document: "Документ загружен",
  create_task_plan: "План задачи создан",
  final_review: "Методическая проверка завершена",
  generate_plan: "Подготовка плана",
  generate_lecture: "Подготовка лекции",
  generate_practice: "Подготовка практики",
  generate_presentation: "Подготовка презентации",
};
export function eventLabel(e: OfficeEvent) {
  return (
    (eventNames[e.action] || e.action) +
    (e.details.material_type
      ? " · " +
        (MATERIAL_NAMES[e.details.material_type] || e.details.material_type)
      : "") +
    (e.details.decision
      ? " · " +
        (e.details.decision === "approved" ? "Утверждено" : "На доработку")
      : "")
  );
}
function Badge({
  status,
  children,
}: {
  status: string;
  children?: React.ReactNode;
}) {
  return (
    <span className={"badge " + status}>
      {status === "completed" || status === "approved" ? (
        <CheckCircle2 size={13} />
      ) : status === "running" ? (
        <Loader2 size={13} className="spin" />
      ) : status === "failed" ? (
        <AlertTriangle size={13} />
      ) : (
        <Clock3 size={13} />
      )}{" "}
      {children || STATUS_NAMES[status] || status}
    </span>
  );
}
function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <BookOpen size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function SpritePortrait({ role }: { role: Role }) {
  return <span className={"portrait portrait-" + role} aria-hidden="true" />;
}
export default function Workspace() {
  const [tab, setTab] = useState<Tab>("home");
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [demo, setDemo] = useState(false);
  const [step, setStep] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [eco, setEco] = useState(false);
  const [files, setFiles] = useState<PortfolioFile[]>([]),
    [lessons, setLessons] = useState<Lesson[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [messages, setMessages] = useState<Message[]>([]),
    [events, setEvents] = useState<OfficeEvent[]>([]);
  const [llm, setLlm] = useState<LlmStatus | null>(null);
  const [profile, setProfile] = useState<{
    full_name?: string;
    institution?: string;
  }>({});
  const [accessProfile, setAccessProfile] = useState<UserProfile | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false),
    [notifications, setNotifications] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedFile, setSelectedFile] = useState<PortfolioFile | null>(null);
  const [preview, setPreview] = useState<Lesson | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [chatTab, setChatTab] = useState("agents");
  const [chatText, setChatText] = useState("");
  const [chatDrafts, setChatDrafts] = useState<Message[]>([]);
  const [stage, setStage] = useState<number | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const api = useMemo(
    () => createApi(session?.access_token),
    [session?.access_token],
  );
  const fetching = useRef(false);
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setAuthReady(true);
      setFiles([]);
      setLessons([]);
      setTasks([]);
      setMessages([]);
      setEvents([]);
      setSelectedFile(null);
      setPreview(null);
      setProfile({});
      setAccessProfile(null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    setAccessProfile(null);
    if (!session?.access_token || demo) return;
    const controller = new AbortController();
    const check = () =>
      api
        .profileAccess(controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setAccessProfile(value);
        })
        .catch(() => {
          if (!controller.signal.aborted) setAccessProfile(null);
        });
    void check();
    const timer = setInterval(() => {
      if (!document.hidden) void check();
    }, 60000);
    const focus = () => {
      void check();
    };
    window.addEventListener("focus", focus);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [api, session?.access_token, demo]);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (demo || !authReady || fetching.current) return;
      fetching.current = true;
      try {
        const results = await Promise.all([
          api.get<PortfolioFile[]>("/portfolio", signal),
          api.get<Lesson[]>("/lessons", signal),
          api.get<Task[]>("/tasks", signal),
          api.get<Message[]>("/chat/messages", signal),
          api.get<OfficeEvent[]>("/events", signal),
        ]);
        if (signal?.aborted) return;
        setFiles(results[0]);
        setLessons(results[1]);
        setTasks(results[2]);
        setMessages(results[3]);
        setEvents(results[4]);
        setError("");
      } catch (e) {
        if (!signal?.aborted)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить данные",
          );
      } finally {
        fetching.current = false;
        if (!signal?.aborted) setLoading(false);
      }
    },
    [api, demo, authReady],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(!demo);
    if (demo) {
      setError("");
      return () => controller.abort();
    }
    void refresh(controller.signal);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh(controller.signal);
    }, 6000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh, demo]);
  useEffect(() => {
    if (demo || !authReady) return;
    const c = new AbortController();
    const check = () =>
      api
        .get<LlmStatus>("/llm/status", c.signal)
        .then(setLlm)
        .catch(() => {});
    void check();
    api
      .get<typeof profile>("/profile", c.signal)
      .then(setProfile)
      .catch(() => {});
    const timer = setInterval(() => {
      if (!document.hidden) void check();
    }, 60000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [api, demo, authReady]);
  useEffect(() => {
    if (!demo || !playing) return;
    const t = setInterval(
      () =>
        setStep((s) => {
          if (s >= 7) {
            setPlaying(false);
            return s;
          }
          return s + 1;
        }),
      4500,
    );
    return () => clearInterval(t);
  }, [demo, playing]);
  const shownLessons = demo ? demoLessons(step) : lessons;
  const shownEvents = demo ? demoEvents(step) : events;
  const shownMessages = demo ? [...demoMessages(), ...chatDrafts] : messages;
  const agents = demo ? demoAgents(step) : agentsFrom(lessons, tasks);
  const agentLesson = shownLessons.find(
    (l) => l.id === agents.find((a) => a.role === selectedRole)?.lessonId,
  );
  const selectedLesson =
    shownLessons.find((l) => l.id === activeLessonId) ||
    shownLessons.find((l) => l.status === "running") ||
    shownLessons[0];
  const ready = shownLessons.filter((l) => l.status === "completed");
  const inProgress = shownLessons.filter((l) =>
    ["running", "pending", "assigned"].includes(l.status),
  );
  const needsReview = ready.filter((l) => l.review !== "approved");
  const failed = shownLessons.filter((l) => l.status === "failed");
  const allApproved =
    ready.length > 0 &&
    ready.length === shownLessons.length &&
    ready.every((l) => l.review === "approved");
  const latestEvent = shownEvents.at(-1);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Операция не выполнена");
    } finally {
      setBusy(false);
    }
  }
  async function review(lesson: Lesson, decision: "approved" | "revision") {
    if (demo) {
      setNotice(
        "Демонстрация: решение не сохраняется в пользовательские данные.",
      );
      return;
    }
    await api.post("/lessons/" + lesson.id + "/review", { decision });
    setNotice(
      decision === "approved"
        ? "Комплект утверждён преподавателем"
        : "Комплект помечен для доработки. Отредактируйте материалы или запустите повторную генерацию.",
    );
    await refresh();
  }
  async function download(lesson: Lesson, material: Material) {
    if (demo) {
      setNotice(
        "Демонстрационный материал: скачивание реального результата доступно в рабочем режиме.",
      );
      return;
    }
    await api.download(
      `/lessons/${lesson.id}/materials/${material.id}/download`,
      `${lesson.topic}-${material.material_type}.${material.material_type === "presentation" ? "pptx" : "docx"}`,
    );
  }
  function openPreview(lesson: Lesson) {
    setActiveLessonId(lesson.id);
    setPreview(lesson);
    const material =
      lesson.materials.find((m) => m.status === "completed") ||
      lesson.materials[0];
    setSelectedMaterial(material?.id || null);
    setDraft(material?.content || "");
  }
  async function openRup(id: string) {
    await run(async () => {
      const result = await api.get<PortfolioFile>("/portfolio/" + id);
      setSelectedFile(result);
    });
  }
  async function upload(file: File) {
    await run(async () => {
      const body = new FormData();
      body.append("category", "РУП");
      body.append("file", file);
      const r = await api.upload<{ id: string }>(body);
      await refresh();
      setSelectedFile(await api.get("/portfolio/" + r.id));
      setNotice("Документ распознан. Проверьте темы и подтвердите РУП.");
    });
  }
  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    if (demo) {
      setChatDrafts((s) => [
        ...s,
        {
          id: "demo-" + Date.now(),
          role: "teacher",
          content: text,
          attachments: [],
        },
        {
          id: "demo-reply-" + Date.now(),
          role: "coordinator",
          content:
            "Демонстрация: сообщение не отправлено backend. Для настоящей генерации выключите Demo Mode.",
          attachments: [],
        },
      ]);
      setChatText("");
      return;
    }
    await run(async () => {
      try {
        const r = await api.post<{ message?: string }>("/chat/messages", {
          content: text,
        });
        setNotice(r.message || "Сообщение отправлено");
        setChatText("");
      } finally {
        await refresh();
      }
    });
  }
  const elapsed = useMemo(() => {
    const spans = shownEvents
      .filter((e) => e.action === "lesson_completed" && e.at)
      .map((end) => {
        const start = shownEvents.find(
          (e) =>
            e.action === "analysis_started" &&
            e.details.lesson_id === end.details.lesson_id &&
            e.at,
        );
        return start?.at
          ? Math.max(0, (Date.parse(end.at!) - Date.parse(start.at)) / 1000)
          : null;
      })
      .filter((v): v is number => v !== null);
    return spans.length
      ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length)
      : null;
  }, [shownEvents]);
  const lessonCards = shownLessons.filter((l) =>
    filter === "ready"
      ? l.status === "completed"
      : filter === "running"
        ? ["running", "pending"].includes(l.status)
        : true,
  );
  const toggleDemo = () => {
    setDemo((v) => !v);
    setPlaying(false);
    setStep(2);
    setPreview(null);
    setSelectedRole(null);
    setNotice("");
    setChatDrafts([]);
  };
  return (
    <div className="workspace">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setTab("home")}
          aria-label="AI EDU — Главная"
        >
          <span className="brand-mark">AI</span>
          <span>
            <strong>
              AI EDU 2.0 <small>2.0 Autopilot</small>
            </strong>
            <span className="brand-subtitle">
              Виртуальная учительская <i />{" "}
              {demo
                ? "Демо-колледж"
                : profile.institution || "Ваше учебное пространство"}
            </span>
          </span>
        </button>
        <nav aria-label="Основная навигация">
          {(Object.keys(translations.ru) as Tab[]).map((key) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setSelectedRole(null);
              }}
            >
              {translations.ru[key]}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button
            aria-label="Демо"
            className={"demo-toggle " + (demo ? "enabled" : "")}
            onClick={toggleDemo}
            aria-pressed={demo}
          >
            <Sparkles size={14} />
            <span>Демо</span>
          </button>
          <button
            className="icon-button notification-button"
            aria-label="Уведомления"
            onClick={() => setNotifications(!notifications)}
          >
            <Bell size={19} />
            {(failed.length > 0 || needsReview.length > 0) && <i />}
          </button>
          <button
            className="profile-button"
            onClick={() => setProfileOpen(true)}
          >
            <span className="profile-avatar">
              {demo
                ? "ДМ"
                : (profile.full_name || "П").slice(0, 2).toUpperCase()}
            </span>
            <span>
              <b>
                {demo
                  ? "Демо-преподаватель"
                  : profile.full_name || "Преподаватель"}
              </b>
              <small>
                {session
                  ? "Личный кабинет"
                  : supabase
                    ? "Войти в аккаунт"
                    : "Локальная разработка"}
              </small>
            </span>
          </button>
        </div>
      </header>
      {demo && (
        <div className="demo-banner">
          <Sparkles size={15} />
          <strong>Демонстрационный режим</strong>
          <span>
            Симуляция интерфейса и анимаций. LLM не вызывается. Данные не
            сохраняются.
          </span>
          <button onClick={toggleDemo}>
            В рабочий режим <ArrowRight size={14} />
          </button>
        </div>
      )}
      <main className="main-content" aria-busy={busy}>
        {(notice || error) && (
          <div
            className={"notice " + (error ? "error" : "")}
            role={error ? "alert" : "status"}
          >
            {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            <span>{error || notice}</span>
            <button
              className="icon-button"
              aria-label="Закрыть сообщение"
              onClick={() => {
                setNotice("");
                setError("");
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {tab === "home" && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">
                  ЛИЧНОЕ ПРОСТРАНСТВО ПРЕПОДАВАТЕЛЯ
                </span>
                <h1>Главная</h1>
              </div>
              <span className="date-label">
                <CalendarDays size={16} />
                {new Date().toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "long",
                  weekday: "long",
                })}
              </span>
            </div>
            <section className="hero">
              <div className="hero-copy">
                <div className="hero-kicker">
                  <Sun size={19} /> Утренний автокомплект <span>•</span>{" "}
                  {demo ? "Знакомство с платформой" : "Ваши учебные материалы"}
                </div>
                <h2>
                  {allApproved
                    ? "Все материалы проверены и утверждены!"
                    : failed.length > 0
                      ? "Некоторые материалы требуют внимания"
                      : ready.length > 0 && inProgress.length === 0
                        ? "Ваш рабочий комплект готов к проверке!"
                        : inProgress.length
                          ? "Агенты готовят ваш следующий урок"
                          : "Ваш следующий урок начинается здесь"}
                </h2>
                <p>
                  {shownLessons.length
                    ? "Планы, лекции, практика и презентации — в одном пространстве. Проверьте материалы и утвердите готовые комплекты."
                    : "Загрузите РУП, подтвердите темы и поручите подготовку ИИ-агентам. Вы контролируете каждый этап и утверждаете результат."}
                </p>
                <button
                  className="hero-button"
                  disabled={busy || allApproved}
                  onClick={() =>
                    ready.length
                      ? void run(async () => {
                          if (demo) {
                            setNotice(
                              "Демонстрация: утверждение не сохраняется.",
                            );
                            return;
                          }
                          for (const lesson of needsReview)
                            await api.post(
                              "/lessons/" + lesson.id + "/review",
                              { decision: "approved" },
                            );
                          setNotice("Готовые комплекты утверждены");
                          await refresh();
                        })
                      : setTab("rup")
                  }
                >
                  <CheckCircle2 size={19} />
                  {ready.length
                    ? "Утвердить все уроки (1-Click)"
                    : "Загрузить первую РУП"}
                  <ArrowRight size={17} />
                </button>
                <small className="hero-footnote">
                  {demo
                    ? "Демонстрационные данные"
                    : "Ночная автогенерация не включена. Подготовку запускаете вы."}
                </small>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="art-halo" />
                <div className="art-books">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="art-clipboard">
                  <div className="clipboard-binding">
                    <i />
                    <i />
                  </div>
                  {[0, 1, 2].map((i) => (
                    <div className="clipboard-row" key={i}>
                      <span>
                        <Check size={18} />
                      </span>
                      <i />
                    </div>
                  ))}
                </div>
                <div className="art-ai">AI</div>
                <span className="art-spark spark-one">✦</span>
                <span className="art-spark spark-two">✦</span>
              </div>
            </section>
            <section className="stats-grid" aria-label="Показатели">
              <Stat
                icon={<CalendarDays />}
                value={
                  demo
                    ? "3"
                    : shownLessons.filter(
                        (l) =>
                          l.schedule?.date ===
                          new Date().toLocaleDateString("en-CA"),
                      ).length || "—"
                }
                label="Уроков сегодня"
                detail="Без подключённого расписания уроки не привязываются к дате"
              />
              <Stat
                icon={<CheckCircle2 />}
                value={ready.length}
                label="Готово"
                color="green"
              />
              <Stat
                icon={<Clock3 />}
                value={inProgress.length}
                label="В работе"
              />
              <Stat
                icon={<AlertTriangle />}
                value={needsReview.length + failed.length}
                label="Требуют проверки"
                color="orange"
              />
              <Stat
                icon={<Zap />}
                value={elapsed !== null ? elapsed + " с" : "—"}
                label="Время подготовки"
                detail="Среднее фактическое время завершённых задач по событиям backend. Экономия времени не рассчитывается."
              />
            </section>
            <div className="section-heading">
              <div>
                <h2>{demo ? "Расписание на сегодня" : "Ваши занятия"}</h2>
                {!demo && (
                  <p>Из подтверждённых РУП · расписание ещё не подключено</p>
                )}
              </div>
              <div className="segmented">
                {[
                  ["all", "Все уроки", shownLessons.length],
                  ["ready", "Готово", ready.length],
                  ["running", "В работе", inProgress.length],
                ].map(([id, label, count]) => (
                  <button
                    key={id}
                    className={filter === id ? "active" : ""}
                    onClick={() => setFilter(String(id))}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>
            </div>
            <div className="lesson-list">
              {lessonCards.map((l, i) => (
                <LessonCard
                  key={l.id}
                  lesson={l}
                  index={i}
                  onPreview={() => openPreview(l)}
                  onReview={(d) => void run(() => review(l, d))}
                  onRetry={() =>
                    void run(async () => {
                      if (demo) {
                        setNotice("Демо: перезапустите сценарий в офисе");
                        return;
                      }
                      await api.post("/lessons/" + l.id + "/retry");
                      await refresh();
                    })
                  }
                  busy={busy}
                />
              ))}
              {!lessonCards.length && (
                <Empty
                  title={
                    loading
                      ? "Загружаем занятия…"
                      : "Место для ваших будущих уроков"
                  }
                  description="Загрузите рабочую учебную программу — из её тем вы сможете создать первый комплект материалов."
                  action={
                    <button className="primary" onClick={() => setTab("rup")}>
                      <Plus size={16} /> Добавить РУП
                    </button>
                  }
                />
              )}
            </div>
            <div className="dashboard-footer">
              <ShieldCheck size={17} />
              <span>Результат всегда остаётся под вашим контролем</span>
              <button onClick={() => setTab("office")}>
                Заглянуть в виртуальную учительскую <ArrowRight size={15} />
              </button>
            </div>
          </>
        )}
        {tab === "office" && (
          <>
            <div className="page-heading office-heading">
              <div>
                <span className="eyebrow">ВАША КОМАНДА ИИ-АГЕНТОВ</span>
                <h1>Виртуальный офис</h1>
              </div>
              <div className="office-toolbar">
                {demo && (
                  <>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        if (step >= 7) setStep(0);
                        setPlaying(!playing);
                      }}
                    >
                      {playing ? <Pause size={15} /> : <Play size={15} />}{" "}
                      {playing ? "Пауза" : "Запустить сценарий"}
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Сбросить демонстрацию"
                      onClick={() => {
                        setStep(0);
                        setPlaying(false);
                      }}
                    >
                      <RefreshCw size={16} />
                    </button>
                  </>
                )}
                <button
                  className={"secondary compact " + (eco ? "chosen" : "")}
                  onClick={() => setEco(!eco)}
                  aria-pressed={eco}
                >
                  <Zap size={15} />
                  {eco ? "Экономный режим" : "Плавная анимация"}
                </button>
                <span className="live-indicator">
                  <i />
                  {demo ? "Симуляция" : "Данные backend · 6 с"}
                </span>
              </div>
            </div>
            <section className="office-scene-card">
              <OfficeScene
                key={demo ? "demo" : "live"}
                agents={agents}
                selected={selectedRole}
                onSelect={setSelectedRole}
                eco={eco}
              />
              <div className="scene-rail">
                <button
                  className="active"
                  aria-label="Обзор офиса"
                  onClick={() => setSelectedRole(null)}
                >
                  <LayoutDashboard size={20} />
                </button>
                <button aria-label="Открыть РУП" onClick={() => setTab("rup")}>
                  <CalendarDays size={20} />
                </button>
                <button
                  aria-label="Материалы"
                  onClick={() => setTab("materials")}
                >
                  <FileText size={20} />
                </button>
                <button
                  aria-label="Команда"
                  onClick={() => setSelectedRole("coordinator")}
                >
                  <Users size={20} />
                </button>
                <button
                  aria-label="Настройки анимации"
                  onClick={() => setEco(!eco)}
                >
                  <Settings2 size={20} />
                </button>
              </div>
              <div className="scene-top-label">
                <span className="scene-status-dot" />
                {demo
                  ? "Демонстрационная учительская"
                  : inProgress.length
                    ? "Команда за работой"
                    : "Офис открыт · агенты свободны"}
              </div>
              <div className="scene-clock">
                <Clock3 size={20} />
                <div>
                  <b>
                    {new Date().toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </b>
                  <small>
                    {new Date().toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "long",
                    })}
                  </small>
                </div>
              </div>
              <div className="task-board">
                <b>Текущая задача</b>
                {[
                  "Анализ РУП",
                  "План урока",
                  "Лекция",
                  "Практика",
                  "Презентация",
                ].map((label, i) => (
                  <span key={label}>
                    <CheckCircle2
                      size={12}
                      className={
                        selectedLesson &&
                        (i === 0 ||
                          selectedLesson.materials[i - 1]?.status ===
                            "completed")
                          ? "done"
                          : ""
                      }
                    />
                    {label}
                  </span>
                ))}
              </div>
            </section>
            <div
              className="accessible-agents"
              aria-label="Выбрать агента с клавиатуры"
            >
              {agents.map((a) => (
                <button
                  key={a.role}
                  onClick={() => setSelectedRole(a.role)}
                  className={selectedRole === a.role ? "selected" : ""}
                >
                  <SpritePortrait role={a.role} />
                  {a.name}
                  <span>
                    {a.status === "running" ? "Работает" : "Свободен"}
                  </span>
                </button>
              ))}
            </div>
            <Pipeline
              lesson={selectedLesson}
              events={shownEvents}
              onStage={setStage}
            />
            <div className="office-bottom-grid">
              <section className="panel queue-panel">
                <h2>
                  Очередь задач{" "}
                  <span>
                    {shownLessons.length + (!demo ? tasks.length : 0)}
                  </span>
                </h2>
                {[
                  [
                    "В работе",
                    inProgress.length +
                      (demo
                        ? 0
                        : tasks.filter((t) =>
                            ["pending", "assigned", "running"].includes(
                              t.status,
                            ),
                          ).length),
                    "purple",
                  ],
                  ["На проверке", needsReview.length, "orange"],
                  [
                    "Утверждено",
                    shownLessons.filter((l) => l.review === "approved").length,
                    "green",
                  ],
                  [
                    "Ошибки",
                    failed.length +
                      (demo
                        ? 0
                        : tasks.filter((t) => t.status === "failed").length),
                    "red",
                  ],
                ].map(([label, n, color]) => (
                  <button
                    className={"queue-row " + color}
                    key={label}
                    onClick={() => {
                      setTab("materials");
                      setFilter(label === "В работе" ? "running" : "all");
                    }}
                  >
                    <span>
                      <Layers size={16} />
                      {label}
                    </span>
                    <b>{n}</b>
                  </button>
                ))}
                {!demo && tasks.length > 0 && (
                  <details className="chat-task-list">
                    <summary>Задания чата ({tasks.length})</summary>
                    {tasks.map((task) => (
                      <div key={task.id}>
                        <b>{task.title}</b>
                        <Badge status={task.status} />
                        {task.error && (
                          <p className="error-text">{task.error}</p>
                        )}
                        {task.steps.map((step, i) => (
                          <p key={i}>
                            {ROLE_NAMES[step.agent]} · {step.title} ·{" "}
                            {STATUS_NAMES[step.status]}
                          </p>
                        ))}
                      </div>
                    ))}
                  </details>
                )}
                <p className="small-muted">
                  {demo
                    ? "Все задачи — демонстрационные"
                    : "Пользовательские занятия и задания"}
                </p>
              </section>
              <section className="panel agent-list-panel">
                <h2>Текущие задачи агентов</h2>
                {agents.map((a) => (
                  <button
                    key={a.role}
                    className={
                      "agent-row " + (selectedRole === a.role ? "selected" : "")
                    }
                    onClick={() => setSelectedRole(a.role)}
                  >
                    <SpritePortrait role={a.role} />
                    <span>
                      <b>{a.name}</b>
                      <small>{a.task || "Ожидает нового поручения"}</small>
                    </span>
                    <span className={"agent-dot " + a.status} />
                    <ChevronRight size={14} />
                  </button>
                ))}
                <div className="office-health">
                  <i className={llm?.available ? "green-dot" : "amber-dot"} />
                  {demo
                    ? "LLM отключена в Demo Mode"
                    : llm?.available
                      ? llm.verified === false
                        ? "LLM настроена · не проверена"
                        : "LLM доступна"
                      : "LLM ожидает настройки"}
                </div>
              </section>
              <section className="panel chat-panel">
                <h2>
                  Командный чат <MessageCircle size={15} />
                </h2>
                <div className="segmented chat-tabs">
                  {[
                    ["agents", "Агенты"],
                    ["me", "Со мной"],
                    ["events", "События"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={chatTab === id ? "active" : ""}
                      onClick={() => setChatTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="chat-scroll" aria-live="polite">
                  {chatTab === "events"
                    ? shownEvents.slice(-25).map((e) => (
                        <div className="chat-event" key={e.id}>
                          <span
                            className={
                              "event-dot " +
                              (e.action.includes("failed") ? "failed" : "")
                            }
                          />
                          <div>
                            <b>{eventLabel(e)}</b>
                            <small>
                              {e.at
                                ? new Date(e.at).toLocaleTimeString("ru-RU", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "Время не записано"}
                            </small>
                            {e.details.error && <p>{e.details.error}</p>}
                          </div>
                        </div>
                      ))
                    : shownMessages
                        .filter((m) => chatTab === "me" || m.role !== "teacher")
                        .slice(-30)
                        .map((m) => (
                          <div
                            className={
                              "chat-message " +
                              (m.role === "teacher" ? "teacher" : "")
                            }
                            key={m.id}
                          >
                            {ROLES.includes(m.role as Role) ? (
                              <SpritePortrait role={m.role as Role} />
                            ) : (
                              <span className="message-initial">
                                {m.role === "teacher" ? "Вы" : "AI"}
                              </span>
                            )}
                            <div>
                              <b>
                                {ROLE_NAMES[m.role as Role] ||
                                  (m.role === "teacher" ? "Вы" : "Система")}
                              </b>
                              <p>{m.content}</p>
                              {m.attachments.map((a, i) => (
                                <button
                                  key={i}
                                  className="text-button"
                                  onClick={() =>
                                    void run(() =>
                                      api.download(
                                        `/documents/${a.document_id}/download?kind=${a.kind || "main"}`,
                                        a.filename || "material.docx",
                                      ),
                                    )
                                  }
                                >
                                  <Download size={12} />
                                  {a.filename}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                  {!(chatTab === "events" ? shownEvents : shownMessages)
                    .length && (
                    <div className="chat-empty">
                      <MessageCircle size={24} />
                      <p>
                        {chatTab === "events"
                          ? "Здесь появятся реальные события задач"
                          : "Напишите команде. Сначала подтвердите РУП."}
                      </p>
                    </div>
                  )}
                </div>
                <form onSubmit={sendChat} className="chat-form">
                  <input
                    ref={inputRef}
                    aria-label="Сообщение команде"
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    placeholder="Написать сообщение…"
                    maxLength={4000}
                  />
                  <button
                    aria-label="Отправить сообщение"
                    disabled={busy || !chatText.trim()}
                  >
                    <Send size={17} />
                  </button>
                </form>
              </section>
            </div>
            <section className="panel office-analytics">
              <h2>
                Аналитика офиса{" "}
                <small>{demo ? "демонстрация" : "по текущим данным"}</small>
              </h2>
              <div>
                <Stat
                  icon={<FileText />}
                  value={shownLessons.length}
                  label="Занятий"
                />
                <Stat
                  icon={<CheckCircle2 />}
                  value={ready.length}
                  label="Завершено"
                  color="green"
                />
                <Stat
                  icon={<Clock3 />}
                  value={inProgress.length}
                  label="В работе"
                />
                <Stat
                  icon={<AlertTriangle />}
                  value={needsReview.length}
                  label="На проверке"
                  color="orange"
                />
                <Stat
                  icon={<Clock3 />}
                  value={elapsed !== null ? elapsed + " с" : "—"}
                  label="Среднее время"
                />
              </div>
            </section>
          </>
        )}
        {tab === "rup" && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">ИСТОЧНИКИ ЗНАНИЙ</span>
                <h1>РУП и темы</h1>
              </div>
              <span className="muted">Рабочая учебная программа</span>
            </div>
            {demo ? (
              <Empty
                title="Демонстрационные РУП не загружаются"
                description="Вернитесь в рабочий режим для загрузки собственных документов."
                action={
                  <button className="primary" onClick={toggleDemo}>
                    В рабочий режим
                  </button>
                }
              />
            ) : (
              <div className="rup-grid">
                <section className="panel rup-sidebar">
                  <h2>Ваши программы</h2>
                  <label className="upload-zone">
                    <Upload size={28} />
                    <b>Загрузить РУП</b>
                    <span>DOCX, XLSX или PDF · до 20 МБ</span>
                    <input
                      type="file"
                      aria-label="Загрузить файл РУП"
                      accept=".docx,.pdf,.xlsx"
                      disabled={busy}
                      onChange={(e) => {
                        if (e.target.files?.[0]) void upload(e.target.files[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {files
                    .filter((f) => f.category === "РУП")
                    .map((f) => (
                      <button
                        key={f.id}
                        className={
                          "file-item " +
                          (f.id === selectedFile?.id ? "selected" : "")
                        }
                        onClick={() => void openRup(f.id)}
                      >
                        <FileText size={19} />
                        <span>
                          <b>{f.filename}</b>
                          <small>
                            {f.confirmed ? "Подтверждена" : "Ожидает проверки"}
                          </small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                </section>
                <section className="panel rup-editor">
                  {selectedFile ? (
                    <>
                      <div className="section-heading">
                        <h2>{selectedFile.filename}</h2>
                        <Badge
                          status={
                            selectedFile.confirmed ? "completed" : "pending"
                          }
                        >
                          {selectedFile.confirmed
                            ? "Подтверждена"
                            : "Проверьте данные"}
                        </Badge>
                      </div>
                      <div className="form-grid">
                        {[
                          ["subject", "Дисциплина"],
                          ["groups", "Группы"],
                        ].map(([field, label]) => (
                          <label key={field}>
                            {label}
                            <input
                              value={String(
                                selectedFile.structured_data?.[
                                  field as keyof RupData
                                ] || "",
                              )}
                              onChange={(e) =>
                                setSelectedFile({
                                  ...selectedFile,
                                  structured_data: {
                                    topics: [],
                                    ...selectedFile.structured_data,
                                    [field]: e.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <div className="section-heading">
                        <h3>Темы и параметры занятия</h3>
                        <button
                          className="secondary compact"
                          onClick={() =>
                            setSelectedFile({
                              ...selectedFile,
                              structured_data: {
                                ...selectedFile.structured_data,
                                topics: [
                                  ...(selectedFile.structured_data?.topics ||
                                    []),
                                  { title: "", hours: "", lesson_type: "" },
                                ],
                              },
                            })
                          }
                        >
                          <Plus size={14} />
                          Добавить тему
                        </button>
                      </div>
                      {selectedFile.structured_data?.topics.map((topic, i) => (
                        <div className="topic-row" key={i}>
                          {(["title", "hours", "lesson_type"] as const).map(
                            (field, j) => (
                              <input
                                key={field}
                                aria-label={
                                  ["Тема", "Часы", "Вид занятия"][j] +
                                  " " +
                                  (i + 1)
                                }
                                placeholder={
                                  ["Название темы", "Часы", "Вид занятия"][j]
                                }
                                value={topic[field] || ""}
                                onChange={(e) =>
                                  setSelectedFile({
                                    ...selectedFile,
                                    structured_data: {
                                      ...selectedFile.structured_data!,
                                      topics:
                                        selectedFile.structured_data!.topics.map(
                                          (t, n) =>
                                            n === i
                                              ? {
                                                  ...t,
                                                  [field]: e.target.value,
                                                }
                                              : t,
                                        ),
                                    },
                                  })
                                }
                              />
                            ),
                          )}
                          <button
                            className="icon-button"
                            aria-label={"Удалить тему " + (i + 1)}
                            onClick={() =>
                              setSelectedFile({
                                ...selectedFile,
                                structured_data: {
                                  ...selectedFile.structured_data!,
                                  topics:
                                    selectedFile.structured_data!.topics.filter(
                                      (_, n) => n !== i,
                                    ),
                                },
                              })
                            }
                          >
                            <X size={14} />
                          </button>
                          {selectedFile.confirmed && (
                            <button
                              className="primary compact"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  const result = await api.post<{ id: string }>(
                                    "/lessons/generate",
                                    {
                                      portfolio_file_id: selectedFile.id,
                                      topic: topic.title,
                                      hours: topic.hours || null,
                                      lesson_type: topic.lesson_type || null,
                                      group_name:
                                        selectedFile.structured_data?.groups ||
                                        null,
                                    },
                                  );
                                  setActiveLessonId(result.id);
                                  setTab("office");
                                  await refresh();
                                })
                              }
                            >
                              Создать комплект <ArrowRight size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                      <label className="full-label">
                        Критерии оценивания
                        <textarea
                          rows={4}
                          value={
                            selectedFile.structured_data?.assessment_criteria ||
                            ""
                          }
                          onChange={(e) =>
                            setSelectedFile({
                              ...selectedFile,
                              structured_data: {
                                topics: [],
                                ...selectedFile.structured_data,
                                assessment_criteria: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      <div className="form-footer">
                        <p>
                          Подтверждайте только проверенные вами темы, часы и
                          критерии.
                        </p>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api.post(
                                "/portfolio/" + selectedFile.id + "/confirm",
                                selectedFile.structured_data,
                              );
                              setSelectedFile(
                                await api.get("/portfolio/" + selectedFile.id),
                              );
                              setNotice("Данные РУП сохранены и подтверждены");
                              await refresh();
                            })
                          }
                        >
                          <CheckCircle2 size={16} />
                          {selectedFile.confirmed
                            ? "Сохранить и подтвердить изменения"
                            : "Подтвердить РУП"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <Empty
                      title="Начните с рабочей программы"
                      description="Выберите документ слева или загрузите РУП. Распознанные данные можно отредактировать перед подтверждением."
                    />
                  )}
                </section>
              </div>
            )}
          </>
        )}
        {tab === "materials" && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">ВАША БИБЛИОТЕКА</span>
                <h1>Занятия</h1>
              </div>
              <button className="primary" onClick={() => setTab("rup")}>
                <Plus size={16} />
                Создать из РУП
              </button>
            </div>
            <div className="lesson-list">
              {shownLessons.map((l, i) => (
                <LessonCard
                  key={l.id}
                  lesson={l}
                  index={i}
                  onPreview={() => openPreview(l)}
                  onReview={(d) => void run(() => review(l, d))}
                  onRetry={() =>
                    void run(async () => {
                      if (demo) return;
                      await api.post("/lessons/" + l.id + "/retry");
                      await refresh();
                    })
                  }
                  busy={busy}
                />
              ))}
              {!shownLessons.length && (
                <Empty
                  title="Материалов пока нет"
                  description="Создайте занятие по теме из подтверждённой РУП."
                />
              )}
            </div>
          </>
        )}
        {tab === "history" && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">ПРОЗРАЧНЫЙ ПРОЦЕСС</span>
                <h1>История</h1>
              </div>
              <History size={24} />
            </div>
            <section className="panel history-panel">
              <h2>История занятий и РУП</h2>
              {shownLessons.map((l) => (
                <button
                  className="history-row"
                  key={l.id}
                  onClick={() => openPreview(l)}
                >
                  <BookOpen size={20} />
                  <span>
                    <b>{l.topic}</b>
                    <small>
                      {l.created_at
                        ? new Date(l.created_at).toLocaleString("ru-RU")
                        : "Дата не записана"}
                    </small>
                  </span>
                  <Badge status={l.status} />
                  <ChevronRight size={16} />
                </button>
              ))}
              {shownEvents
                .slice()
                .reverse()
                .map((e) => (
                  <div className="history-row" key={"event-" + e.id}>
                    <span className="event-dot" />
                    <span>
                      <b>{eventLabel(e)}</b>
                      <small>
                        {e.at
                          ? new Date(e.at).toLocaleString("ru-RU")
                          : "Историческая запись без времени"}
                      </small>
                    </span>
                  </div>
                ))}
              {!shownLessons.length && !shownEvents.length && (
                <Empty
                  title="Всё начинается с первого урока"
                  description="Здесь сохраняются реальные события и результаты работы."
                />
              )}
            </section>
          </>
        )}
      </main>
      {selectedRole && tab === "office" && (
        <aside
          className="agent-drawer"
          role="dialog"
          aria-modal="false"
          aria-label={ROLE_NAMES[selectedRole]}
        >
          <button
            className="drawer-close icon-button"
            aria-label="Закрыть панель агента"
            onClick={() => setSelectedRole(null)}
          >
            <X size={20} />
          </button>
          <div className="drawer-agent-art">
            <SpritePortrait role={selectedRole} />
          </div>
          <span className="eyebrow">ИИ-АГЕНТ</span>
          <h2>{ROLE_NAMES[selectedRole]}</h2>
          <p>{agents.find((a) => a.role === selectedRole)?.description}</p>
          <Badge
            status={
              agents.find((a) => a.role === selectedRole)?.status || "idle"
            }
          />
          <h3>Текущее поручение</h3>
          <p>
            {agents.find((a) => a.role === selectedRole)?.task ||
              "Активных задач нет. Агент находится в режиме ожидания."}
          </p>
          <h3>Последние события</h3>
          <div className="drawer-events">
            {shownEvents
              .filter((e) => e.agent === selectedRole)
              .slice(-5)
              .reverse()
              .map((e) => (
                <p key={e.id}>{eventLabel(e)}</p>
              ))}
            {!shownEvents.some((e) => e.agent === selectedRole) && (
              <p>Событий пока нет</p>
            )}
          </div>
          <button
            className="primary"
            onClick={() => {
              setChatTab("me");
              setChatText("@" + ROLE_NAMES[selectedRole] + " ");
              setSelectedRole(null);
              setTimeout(() => inputRef.current?.focus(), 50);
            }}
          >
            <MessageCircle size={16} />
            Написать агенту
          </button>
          {agentLesson && (
            <button
              className="secondary"
              onClick={() => {
                openPreview(agentLesson);
                setSelectedRole(null);
              }}
            >
              <Eye size={16} />
              Открыть результат
            </button>
          )}
          {agentLesson?.status === "failed" && (
            <button
              className="secondary"
              disabled={busy || demo}
              onClick={() =>
                void run(async () => {
                  await api.post("/lessons/" + agentLesson.id + "/retry");
                  await refresh();
                })
              }
            >
              <RefreshCw size={16} />
              Повторить задачу
            </button>
          )}
        </aside>
      )}
      {stage !== null && (
        <Modal
          title={
            [
              "РУП",
              "Анализ",
              "План",
              "Лекция",
              "Практика",
              "Презентация",
              "Проверка",
              "Готово",
            ][stage]
          }
          onClose={() => setStage(null)}
        >
          <p>
            Этапы отражают сохранённые данные backend. Даты не подставляются по
            таймеру.
          </p>
          {selectedLesson ? (
            <>
              <p>
                <b>{selectedLesson.topic}</b>
              </p>
              {(stage < 2 || stage > 5) && (
                <StageTimes
                  stage={stage}
                  lesson={selectedLesson}
                  events={shownEvents}
                />
              )}{" "}
              {stage >= 2 && stage <= 5 ? (
                (() => {
                  const m = selectedLesson.materials.find(
                    (m) =>
                      m.material_type ===
                      ["", "", "plan", "lecture", "practice", "presentation"][
                        stage
                      ],
                  );
                  const ev = shownEvents.filter(
                    (e) =>
                      e.details.lesson_id === selectedLesson.id &&
                      e.details.material_type === m?.material_type,
                  );
                  return (
                    <>
                      <Badge status={m?.status || "pending"} />
                      <p>
                        Агент:{" "}
                        {stage === 5
                          ? "Креативный агент"
                          : stage === 4
                            ? "Проверяющий"
                            : "Методист"}
                      </p>
                      <p>
                        Начало:{" "}
                        {ev.find((e) => e.action === "material_started")?.at ||
                          "Не записано"}
                      </p>
                      <p>
                        Завершение:{" "}
                        {ev.find((e) => e.action === "material_completed")
                          ?.at || "Не записано"}
                      </p>
                      {m?.error && <p className="error-text">{m.error}</p>}
                      {m?.status === "completed" && (
                        <button
                          className="primary"
                          onClick={() => {
                            openPreview(selectedLesson);
                            setStage(null);
                          }}
                        >
                          Открыть материал
                        </button>
                      )}
                    </>
                  );
                })()
              ) : (
                <>
                  <p>
                    {stage === 6
                      ? "Проверка преподавателем: " +
                        (selectedLesson.review === "approved"
                          ? "утверждено"
                          : "не завершена")
                      : stage === 7
                        ? "Завершение: " +
                          (selectedLesson.review === "approved"
                            ? "утверждено"
                            : "ожидается утверждение")
                        : stage === 0
                          ? "РУП подтверждена перед созданием занятия"
                          : "Анализ отражается событием начала генерации"}
                  </p>
                  {stage === 6 && (
                    <small>
                      Автоматическая методическая проверка качества в пути
                      занятий пока ограничена длиной и наличием темы.
                    </small>
                  )}
                </>
              )}
            </>
          ) : (
            <p>Выберите или создайте занятие.</p>
          )}
        </Modal>
      )}
      {preview && (
        <Modal title={preview.topic} onClose={() => setPreview(null)} wide>
          <div className="material-tabs">
            {preview.materials.map((m) => (
              <button
                key={m.id}
                className={selectedMaterial === m.id ? "active" : ""}
                onClick={() => {
                  setSelectedMaterial(m.id);
                  setDraft(m.content);
                }}
              >
                {MATERIAL_NAMES[m.material_type] || m.title}
                <span className={"mini-dot " + m.status} />
              </button>
            ))}
          </div>
          {(() => {
            const m = preview.materials.find((m) => m.id === selectedMaterial);
            return m ? (
              <>
                <div className="preview-meta">
                  <Badge status={m.status} />
                  <span>
                    Текстовый предпросмотр ·{" "}
                    {m.material_type === "presentation" ? "PPTX" : "DOCX"}
                  </span>
                </div>
                {m.error && <p className="error-text">{m.error}</p>}
                <textarea
                  aria-label="Содержимое материала"
                  className="material-editor"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Результат появится после успешной генерации"
                  disabled={["pending", "running"].includes(preview.status)}
                />
                <div className="modal-actions">
                  <button
                    className="secondary"
                    disabled={busy || m.status !== "completed"}
                    onClick={() => void run(() => download(preview, m))}
                  >
                    <Download size={16} />
                    Скачать{" "}
                    {m.material_type === "presentation" ? "PPTX" : "DOCX"}
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      ["pending", "running"].includes(preview.status) ||
                      !draft.trim()
                    }
                    onClick={() =>
                      void run(async () => {
                        if (demo) {
                          setNotice("Демо: правка не сохранена");
                          return;
                        }
                        await api.put(
                          `/lessons/${preview.id}/materials/${m.id}`,
                          { content: draft },
                        );
                        setPreview({
                          ...preview,
                          materials: preview.materials.map((item) =>
                            item.id === m.id
                              ? { ...item, content: draft, status: "completed" }
                              : item,
                          ),
                        });
                        setNotice("Текст и экспортный файл обновлены");
                        await refresh();
                      })
                    }
                  >
                    Сохранить изменения
                  </button>
                </div>
              </>
            ) : (
              <p>Материалы ещё не созданы</p>
            );
          })()}
        </Modal>
      )}
      {profileOpen && (
        <Modal
          title={session ? "Профиль преподавателя" : "Ваш аккаунт"}
          onClose={() => setProfileOpen(false)}
        >
          {supabase && !session ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const result = await supabase!.auth.signInWithPassword({
                    email,
                    password,
                  });
                  if (result.error) throw result.error;
                  setProfileOpen(false);
                });
              }}
              className="auth-form"
            >
              <label>
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Пароль
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                Войти
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await supabase!.auth.signUp({ email, password });
                    if (r.error) throw r.error;
                    setNotice("Проверьте почту для подтверждения регистрации");
                  })
                }
              >
                Регистрация
              </button>
            </form>
          ) : (
            <div className="auth-form">
              <p>
                {!supabase
                  ? "Локальный режим разработки. Не предназначен для публичного доступа."
                  : "Сессия Supabase Auth"}
              </p>
              <label>
                Имя
                <input
                  value={profile.full_name || ""}
                  onChange={(e) =>
                    setProfile({ ...profile, full_name: e.target.value })
                  }
                />
              </label>
              <label>
                Организация
                <input
                  value={profile.institution || ""}
                  onChange={(e) =>
                    setProfile({ ...profile, institution: e.target.value })
                  }
                />
              </label>
              <button
                className="primary"
                disabled={busy || demo}
                onClick={() =>
                  void run(async () => {
                    await api.put("/profile", profile);
                    setNotice("Профиль сохранён");
                    setProfileOpen(false);
                  })
                }
              >
                Сохранить профиль
              </button>
              {!demo &&
                accessProfile?.role === "admin" &&
                accessProfile.is_active && (
                  <Link
                    href="/admin"
                    className="secondary"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: 12,
                      borderRadius: 10,
                    }}
                  >
                    <ShieldCheck size={16} />
                    Админ-панель
                  </Link>
                )}
              {session && (
                <button
                  className="secondary"
                  onClick={() =>
                    void run(async () => {
                      await supabase?.auth.signOut();
                      setProfileOpen(false);
                    })
                  }
                >
                  <LogOut size={16} />
                  Выйти
                </button>
              )}
            </div>
          )}
        </Modal>
      )}
      {notifications && (
        <Modal title="Уведомления" onClose={() => setNotifications(false)}>
          <p>
            {failed.length
              ? `Не удалось завершить занятий: ${failed.length}`
              : "Ошибок в загруженных занятиях нет."}
          </p>
          <p>Ожидают проверки преподавателя: {needsReview.length}</p>
          {!demo && (
            <p className="small-muted">
              {llm?.error || "Настройки LLM загружаются"}
            </p>
          )}
          {latestEvent && <p>Последнее событие: {eventLabel(latestEvent)}</p>}
        </Modal>
      )}
    </div>
  );
}
function Stat({
  icon,
  value,
  label,
  color = "",
  detail,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  color?: string;
  detail?: string;
}) {
  return (
    <div className={"stat-card " + color} title={detail}>
      <span className="stat-icon">{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>
          {label}
          {detail && <CircleHelp size={10} />}
        </small>
      </div>
    </div>
  );
}
function LessonCard({
  lesson: l,
  index,
  onPreview,
  onReview,
  onRetry,
  busy,
}: {
  lesson: Lesson;
  index: number;
  onPreview: () => void;
  onReview: (d: "approved" | "revision") => void;
  onRetry: () => void;
  busy: boolean;
}) {
  const percent = Math.round(
    (l.materials.filter((m) => m.status === "completed").length /
      Math.max(1, l.materials.length)) *
      100,
  );
  return (
    <article className="lesson-card">
      <div className="lesson-time">
        <b>
          {l.schedule ? l.schedule.pair + " пара" : "Занятие " + (index + 1)}
        </b>
        <small>
          {l.schedule
            ? l.schedule.start + " – " + l.schedule.end
            : "Время не задано"}
        </small>
      </div>
      <div className="lesson-info">
        <div className="lesson-title-row">
          <h3>{l.subject || "Дисциплина из РУП"}</h3>
          <Badge
            status={
              l.review === "approved"
                ? "approved"
                : l.review === "revision"
                  ? "review"
                  : l.status
            }
          >
            {l.review === "approved"
              ? "Утверждено"
              : l.review === "revision"
                ? "На доработке"
                : l.status === "completed"
                  ? `Готово ${percent}%`
                  : STATUS_NAMES[l.status]}
          </Badge>
        </div>
        <p>
          Группа: {l.group_name || "не указана"}{" "}
          {l.schedule?.module && <> · {l.schedule.module}</>}
        </p>
        <div className="lesson-topic">
          <BookOpen size={14} />
          <span>
            <b>Тема:</b> {l.topic}
          </span>
        </div>
        <div className="material-chips">
          {["plan", "lecture", "practice", "presentation", "test"].map(
            (type) => {
              const material = l.materials.find(
                (m) => m.material_type === type,
              );
              return (
                <span
                  className={material?.status || "unavailable"}
                  key={type}
                  title={
                    material
                      ? STATUS_NAMES[material.status]
                      : "Генерация теста доступна через отдельное задание чата"
                  }
                >
                  {type === "presentation" ? (
                    <MonitorPlay size={12} />
                  ) : (
                    <FileText size={12} />
                  )}{" "}
                  {MATERIAL_NAMES[type]} {type === "test" && !material && "—"}
                </span>
              );
            },
          )}
        </div>
      </div>
      <div className="lesson-actions">
        <button className="secondary compact" onClick={onPreview}>
          <Eye size={15} />
          Просмотреть
        </button>
        <div className="lesson-decision">
          {l.status === "completed" && l.review !== "approved" && (
            <button
              className="approve-button"
              disabled={busy}
              onClick={() => onReview("approved")}
            >
              <Check size={14} />
              Утвердить
            </button>
          )}
          {l.status === "completed" && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => onReview("revision")}
            >
              На доработку
            </button>
          )}
          {(l.status === "failed" || l.review === "revision") && (
            <button
              className="secondary compact"
              disabled={busy}
              onClick={onRetry}
            >
              <RefreshCw size={14} />
              Повторить
            </button>
          )}
          {l.status === "completed" && (
            <button className="text-button" onClick={onPreview}>
              <Download size={13} /> Скачать
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
function Pipeline({
  lesson,
  events,
  onStage,
}: {
  lesson?: Lesson;
  events: OfficeEvent[];
  onStage: (n: number) => void;
}) {
  const names = [
    "РУП",
    "Анализ",
    "План",
    "Лекция",
    "Практика",
    "Презентация",
    "Проверка",
    "Готово",
  ];
  const status = names.map((_, i) =>
    !lesson
      ? "pending"
      : i === 0
        ? "completed"
        : i === 1
          ? events.some(
              (e) =>
                e.details.lesson_id === lesson.id &&
                e.action === "analysis_started",
            ) || lesson.materials.some((m) => m.status === "completed")
            ? "completed"
            : "pending"
          : i >= 2 && i <= 5
            ? lesson.materials.find(
                (m) =>
                  m.material_type ===
                  ["", "", "plan", "lecture", "practice", "presentation"][i],
              )?.status || "pending"
            : lesson.review === "approved"
              ? "completed"
              : i === 6 && lesson.status === "completed"
                ? "review"
                : "pending",
  );
  const complete = status.filter((s) => s === "completed").length;
  return (
    <section className="pipeline panel">
      <div className="pipeline-title">
        <b>
          Процесс подготовки урока {lesson && <span>· {lesson.topic}</span>}
        </b>
        {lesson && <Badge status={lesson.status} />}
      </div>
      <div className="pipeline-track">
        {names.map((name, i) => (
          <button key={name} onClick={() => onStage(i)} className={status[i]}>
            <span>
              {status[i] === "completed" ? (
                <Check size={13} />
              ) : status[i] === "failed" ? (
                <X size={12} />
              ) : status[i] === "running" ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <span>{i + 1}</span>
              )}
            </span>
            <small>{name}</small>
          </button>
        ))}
      </div>
      <div className="pipeline-progress">
        <strong>{Math.round((complete / 8) * 100)}%</strong>
        <span
          className="progress-ring"
          style={{
            background: `conic-gradient(#7940ff ${(complete / 8) * 360}deg,#e9e7f7 0deg)`,
          }}
        />
        <small>Завершено этапов</small>
      </div>
    </section>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Закрыть окно"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function StageTimes({
  stage,
  lesson,
  events,
}: {
  stage: number;
  lesson: Lesson;
  events: OfficeEvent[];
}) {
  const relevant = events.filter((e) =>
    stage === 0
      ? e.action === "confirm_rup" &&
        e.details.file_id === lesson.portfolio_file_id
      : e.details.lesson_id === lesson.id,
  );
  const start = relevant.find(
    (e) =>
      e.action ===
      (
        {
          0: "confirm_rup",
          1: "analysis_started",
          6: "lesson_completed",
          7: "lesson_review",
        } as Record<number, string>
      )[stage],
  );
  const end = relevant.find(
    (e) =>
      e.action ===
        (
          {
            0: "confirm_rup",
            1: "material_started",
            6: "lesson_review",
            7: "lesson_review",
          } as Record<number, string>
        )[stage] &&
      (stage !== 7 || e.details.decision === "approved"),
  );
  return (
    <div className="stage-times">
      <p>
        Ответственный:{" "}
        {stage >= 6
          ? "Преподаватель"
          : stage === 0
            ? "Методист / преподаватель"
            : "Координатор"}
      </p>
      <p>
        Начало:{" "}
        {start?.at ? new Date(start.at).toLocaleString("ru-RU") : "Не записано"}
      </p>
      <p>
        Завершение:{" "}
        {end?.at ? new Date(end.at).toLocaleString("ru-RU") : "Не записано"}
      </p>
    </div>
  );
}
