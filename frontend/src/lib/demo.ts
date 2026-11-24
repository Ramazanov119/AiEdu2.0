import { Lesson, OfficeEvent, ROLES, Role, Message } from "./types";
export const DEMO_SUBJECTS = [
  "Информационно-коммуникационные технологии",
  "Архитектура компьютерных систем",
  "Кураторский час: цифровая гигиена",
];
export function demoLessons(step: number): Lesson[] {
  const names = [
    "Разработка алгоритмов и структур БД",
    "Принципы защиты корпоративных сетей",
    "Профилактика кибербуллинга и мошенничества",
  ];
  return names.map((topic, i) => ({
    id: "demo-" + i,
    portfolio_file_id: "demo-rup",
    topic,
    subject: DEMO_SUBJECTS[i],
    group_name: i === 0 ? "МТОРАМ 9-25-2" : i === 1 ? "ПО 9-24-1" : "УА 9-25-1",
    hours: "2",
    lesson_type: "Учебное занятие",
    created_at: new Date().toISOString(),
    schedule: {
      date: new Date().toLocaleDateString("en-CA"),
      pair: i + 1,
      start: ["08:30", "10:15", "14:00"][i],
      end: ["09:15", "11:00", "14:45"][i],
      module: i === 0 ? "Модуль 3" : "Модуль 2",
    },
    status: i === 1 && step < 7 ? "running" : "completed",
    agent_progress: Object.fromEntries(
      ROLES.map((r, j) => [
        r,
        i === 1 && j === Math.min(3, Math.floor(step / 2))
          ? "running"
          : "completed",
      ]),
    ),
    materials: ["plan", "lecture", "practice", "presentation"].map(
      (type, j) => ({
        id: `demo-${i}-${type}`,
        material_type: type,
        title: ["План урока", "Лекция", "Практическая работа", "Презентация"][
          j
        ],
        content:
          "ДЕМОНСТРАЦИОННЫЙ МАТЕРИАЛ\n\nТема: " +
          topic +
          "\n\nЭтот пример иллюстрирует интерфейс. Он не создан LLM и не является учебным материалом для публикации.",
        status:
          i === 1
            ? step > j + 2
              ? "completed"
              : step === j + 2
                ? "running"
                : "pending"
            : "completed",
      }),
    ),
  }));
}
export function demoEvents(step: number): OfficeEvent[] {
  return [
    "lesson_queued",
    "analysis_started",
    "material_started",
    "material_completed",
    "material_started",
    "material_completed",
    "lesson_completed",
    "lesson_review",
  ]
    .slice(0, step + 1)
    .map((action, i) => ({
      id: i + 1,
      agent: ROLES[Math.min(3, Math.floor(i / 2))],
      action,
      at: new Date(Date.now() - (step - i) * 4000).toISOString(),
      details: {
        lesson_id: "demo-1",
        material_type: [
          "plan",
          "plan",
          "plan",
          "plan",
          "lecture",
          "presentation",
        ][i],
        topic: "Принципы защиты корпоративных сетей",
      },
    }));
}
export function demoMessages(): Message[] {
  return [
    {
      id: "demo-message",
      role: "coordinator",
      content:
        "Демонстрационная сцена: персонажи показывают последовательность подготовки. Запросы к LLM и запись пользовательских данных отключены.",
      attachments: [],
    },
  ];
}
export function demoAgents(step: number) {
  return ROLES.map((role, index) => ({
    role: role as Role,
    name: {
      coordinator: "Координатор",
      methodist: "Методист",
      creative: "Креативный агент",
      assessment: "Проверяющий",
    }[role],
    description: "Демонстрация поведения",
    status: (Math.min(3, Math.floor(step / 2)) === index && step < 7
      ? "running"
      : "idle") as "running" | "idle",
    task: "Демо: защита корпоративных сетей",
    lessonId: "demo-1",
  }));
}
