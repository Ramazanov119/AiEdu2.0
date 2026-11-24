"use client";
import { Activity, Inbox, RefreshCw } from "lucide-react";
import type { AdminAnalytics } from "@/lib/types";
import s from "./admin.module.css";
export function Busy({ label = "Загружаем данные…" }: { label?: string }) {
  return (
    <div className={s.loading} role="status" aria-label={label}>
      <span className={s.spinner} />
      {label}
    </div>
  );
}
export function Empty({
  title = "Данных пока нет",
  text = "Здесь появятся реальные данные платформы.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className={s.empty}>
      <Inbox size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Failure({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className={s.failure} role="alert">
      <Activity size={20} />
      <div>
        <strong>Не удалось загрузить данные</strong>
        <p>{message}</p>
      </div>
      <button className={s.outline} onClick={retry}>
        <RefreshCw size={16} />
        Повторить
      </button>
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "good" | "bad" | "warm" | "neutral" | "blue";
}) {
  return <span className={`${s.badge} ${s[tone]}`}>{children}</span>;
}
export function Pagination({
  offset,
  total,
  limit,
  onPage,
  loading = false,
}: {
  offset: number;
  total: number;
  limit: number;
  onPage: (offset: number) => void;
  loading?: boolean;
}) {
  return (
    <div className={s.pagination}>
      <span>
        {total ? offset + 1 : 0}–{Math.min(offset + limit, total)} из {total}
      </span>
      <div>
        <button
          className={s.outline}
          disabled={loading || offset === 0}
          onClick={() => onPage(Math.max(0, offset - limit))}
        >
          Назад
        </button>
        <button
          className={s.outline}
          disabled={loading || offset + limit >= total}
          onClick={() => onPage(offset + limit)}
        >
          Далее
        </button>
      </div>
    </div>
  );
}
export function DailyChart({ days }: { days: AdminAnalytics["by_day"] }) {
  if (!days.some((day) => day.generations > 0))
    return (
      <Empty
        title="Генераций за период пока нет"
        text="График появится после первых обращений к модели."
      />
    );
  // Summation preserves totals for long periods; the exact daily records stay in the API.
  const step = Math.max(1, Math.ceil(days.length / 60));
  const buckets = Array.from(
    { length: Math.ceil(days.length / step) },
    (_, index) => {
      const part = days.slice(index * step, (index + 1) * step);
      return {
        date: part[0].date,
        end: part.at(-1)!.date,
        generations: part.reduce((n, d) => n + d.generations, 0),
        success: part.reduce((n, d) => n + d.success, 0),
        error: part.reduce((n, d) => n + d.error, 0),
      };
    },
  );
  const max = Math.max(1, ...buckets.map((d) => d.generations)),
    scale = 10 ** Math.floor(Math.log10(max)),
    top = Math.max(4, Math.ceil(max / (scale * 4)) * scale * 4);
  const left = 40,
    right = 730,
    bottom = 203,
    height = 165,
    width = (right - left) / buckets.length;
  return (
    <>
      <div className={s.chart}>
        <svg
          viewBox="0 0 750 245"
          role="img"
          aria-label={`Динамика генераций: с ${days[0]?.date} по ${days.at(-1)?.date}. Всего ${days.reduce((n, d) => n + d.generations, 0)}.`}
        >
          {Array.from({ length: 5 }, (_, i) => {
            const y = bottom - (i * height) / 4;
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={right}
                  y1={y}
                  y2={y}
                  stroke="#e6ecf3"
                  strokeDasharray="4 5"
                />
                <text
                  x={left - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill="#56647a"
                  fontSize="12"
                >
                  {Math.round((top * i) / 4)}
                </text>
              </g>
            );
          })}
          {buckets.map((d, i) => (
            <g key={d.date}>
              <rect
                x={left + i * width + width * 0.18}
                y={bottom - (d.success / top) * height}
                width={Math.max(1, width * 0.64)}
                height={(d.success / top) * height}
                rx="3"
                fill="#3868dc"
              >
                <title>
                  {d.date}
                  {d.end !== d.date ? " — " + d.end : ""}: успешно {d.success},
                  ошибок {d.error}
                </title>
              </rect>
              <rect
                x={left + i * width + width * 0.18}
                y={bottom - (d.generations / top) * height}
                width={Math.max(1, width * 0.64)}
                height={(d.error / top) * height}
                rx="2"
                fill="#e68536"
              >
                <title>
                  {d.date}: ошибок {d.error}
                </title>
              </rect>
            </g>
          ))}
          {[0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]
            .filter((n, i, a) => a.indexOf(n) === i)
            .map((index) => (
              <text
                key={index}
                x={left + (index + 0.5) * width}
                y="230"
                textAnchor={
                  index === 0
                    ? "start"
                    : index === buckets.length - 1
                      ? "end"
                      : "middle"
                }
                fill="#56647a"
                fontSize="12"
              >
                {new Intl.DateTimeFormat("ru-RU", {
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                }).format(new Date(buckets[index].date + "T12:00:00Z"))}
              </text>
            ))}
        </svg>
      </div>
      {step > 1 && (
        <p className={s.meta}>
          Для читаемости суммы объединены в интервалы до {step} дней. Общее
          число генераций сохранено.
        </p>
      )}
    </>
  );
}
