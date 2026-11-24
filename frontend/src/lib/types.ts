export type Role = "coordinator" | "methodist" | "creative" | "assessment";
export type Status =
  | "pending"
  | "assigned"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "review";
export interface Topic {
  title: string;
  hours?: string | null;
  lesson_type?: string | null;
}
export interface RupData {
  subject?: string;
  grade?: string;
  groups?: string;
  topics: Topic[];
  assessment_criteria?: string;
}
export interface PortfolioFile {
  id: string;
  filename: string;
  category: string;
  confirmed: boolean;
  structured_data?: RupData;
}
export interface Material {
  id: string;
  material_type: string;
  title: string;
  content: string;
  status: Status;
  error?: string;
  file_path?: string;
}
export interface ScheduleEntry {
  date: string;
  pair: number;
  start: string;
  end: string;
  module?: string;
}
export interface Lesson {
  id: string;
  portfolio_file_id: string;
  topic: string;
  subject?: string;
  group_name?: string;
  hours?: string;
  lesson_type?: string;
  status: Status;
  agent_progress: Partial<Record<Role, Status>>;
  created_at?: string;
  materials: Material[];
  review?: "approved" | "revision";
  schedule?: ScheduleEntry | null;
}
export interface Task {
  id: string;
  title: string;
  status: Status;
  assigned_agent?: Role;
  error?: string;
  steps: { agent: Role; title: string; status: Status; error?: string }[];
}
export interface OfficeEvent {
  id: number;
  agent: string;
  action: string;
  at?: string;
  details: {
    at?: string;
    lesson_id?: string;
    material_id?: string;
    material_type?: string;
    topic?: string;
    error?: string;
    decision?: string;
    [key: string]: unknown;
  };
}
export interface Message {
  id: string;
  role: string;
  content: string;
  attachments: { document_id?: string; kind?: string; filename?: string }[];
}
export interface LlmStatus {
  available: boolean;
  verified?: boolean;
  configured?: boolean;
  provider?: string;
  model?: string;
  error?: string;
}
export interface AgentState {
  role: Role;
  name: string;
  description: string;
  status: Status | "idle";
  task?: string;
  lessonId?: string;
}
export const ROLES: Role[] = [
  "coordinator",
  "methodist",
  "creative",
  "assessment",
];
export const ROLE_NAMES: Record<Role, string> = {
  coordinator: "Координатор",
  methodist: "Методист",
  creative: "Креативный агент",
  assessment: "Проверяющий",
};
export const MATERIAL_NAMES: Record<string, string> = {
  plan: "План урока",
  lecture: "Лекция",
  practice: "Практическая работа",
  presentation: "Презентация",
  test: "Тест",
};
export const STATUS_NAMES: Record<string, string> = {
  pending: "В очереди",
  assigned: "Назначено",
  running: "В работе",
  completed: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено",
  review: "На проверке",
  idle: "Свободен",
};
export function agentsFrom(lessons: Lesson[], tasks: Task[]): AgentState[] {
  return ROLES.map((role) => {
    const lesson = lessons.find(
      (l) => l.status === "running" && l.agent_progress[role] === "running",
    );
    const task = tasks.find(
      (t) =>
        t.status === "running" &&
        t.steps.some((s) => s.agent === role && s.status === "running"),
    );
    const failed = lessons.find(
      (l) => l.status === "failed" && l.agent_progress[role] === "failed",
    );
    return {
      role,
      name: ROLE_NAMES[role],
      description: {
        coordinator: "Распределяет задачи",
        methodist: "Готовит план и лекцию",
        creative: "Создаёт презентацию",
        assessment: "Готовит практику и оценивание",
      }[role],
      status: lesson || task ? "running" : failed ? "failed" : "idle",
      task: lesson?.topic || task?.title || failed?.topic,
      lessonId: lesson?.id || failed?.id,
    };
  });
}

// Account permissions are separate from Role (the four AI-agent identities).
export type UserRole = "teacher" | "methodist" | "admin";
export interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  institution: string | null;
  role: UserRole;
  organization_id: string | null;
  is_active: boolean;
  subscription_until: string | null;
  daily_limit: number;
  daily_limit_v1?: number | null;
  created_at: string | null;
  last_active_at: string | null;
}
export interface Organization {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  teachers_count: number;
}
export interface AdminUser extends UserProfile {
  generations_today: number;
  generations_total: number;
}
export interface AdminUserPage {
  items: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}
export interface AdminAnalytics {
  date_from: string;
  date_to: string;
  timezone: string;
  all_time: boolean;
  total_users: number;
  total_teachers: number;
  enabled_users: number;
  active_24h: number;
  active_7d: number;
  total_generations: number;
  success: number;
  error: number;
  average_duration_ms: number | null;
  tokens_used_reported: number;
  generations_without_token_data: number;
  in_flight_generations: number;
  by_organization: {
    organization_id: string | null;
    name: string | null;
    teachers: number;
    generations: number;
    success: number;
    error: number;
  }[];
  by_agent: Record<Role, number>;
  by_day: {
    date: string;
    generations: number;
    success: number;
    error: number;
  }[];
}
export interface GenerationLog {
  id: string;
  user_id: string;
  user_name?: string | null;
  user_email?: string | null;
  organization_id: string | null;
  organization_name?: string | null;
  agent_type: Role;
  action_type: string;
  model_name: string;
  tokens_used: number;
  tokens_reported: boolean;
  duration_ms: number;
  status: "success" | "error";
  error_message: string | null;
  created_at: string;
}
export interface AdminAuditLog {
  id: string;
  admin_id: string | null;
  admin_name: string | null;
  target_user_id: string | null;
  target_user_name: string | null;
  action: string;
  details: {
    field?: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    name?: string;
    organization_id?: string;
    [key: string]: unknown;
  };
  created_at: string;
}
export interface AdminUserPatch {
  role?: UserRole;
  organization_id?: string | null;
  is_active?: boolean;
  subscription_until?: string | null;
  daily_limit?: number;
  daily_limit_v1?: number | null;
  reason?: string;
}
