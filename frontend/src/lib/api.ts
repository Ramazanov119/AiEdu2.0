import { apiUrl } from "./supabase";
import type {
  UserProfile,
  Organization,
  AdminUserPage,
  AdminAnalytics,
  AdminUserPatch,
  GenerationLog,
  AdminAuditLog,
} from "./types";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
function queryString(
  values: Record<string, string | number | boolean | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return params.size ? "?" + params.toString() : "";
}
export function createApi(token?: string) {
  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(options.headers);
    if (token) headers.set("Authorization", "Bearer " + token);
    const response = await fetch(apiUrl + path, {
      ...options,
      headers,
      cache: "no-store",
      signal:
        path.startsWith("/api/admin/") || path === "/profile/access"
          ? options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
            : AbortSignal.timeout(20000)
          : options.signal,
    });
    if (!response.ok) {
      let detail = "";
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        const reason = data.detail ?? data.message;
        detail = typeof reason === "string" ? reason : reason ? JSON.stringify(reason) : "";
      } catch {
        detail = text.trim().slice(0, 1000);
      }
      throw new ApiError(detail || `API: ${response.status}`, response.status);
    }
    return response.json() as Promise<T>;
  }
  return {
    profileAccess: (signal?: AbortSignal) =>
      request<UserProfile>("/profile/access", { signal }),
    adminMe: (signal?: AbortSignal) =>
      request<UserProfile>("/api/admin/me", { signal }),
    adminAnalytics: (
      filters: {
        date_from?: string;
        date_to?: string;
        all_time?: boolean;
      } = {},
      signal?: AbortSignal,
    ) =>
      request<AdminAnalytics>("/api/admin/analytics" + queryString(filters), {
        signal,
      }),
    adminUsers: (
      filters: {
        q?: string;
        role?: string;
        organization_id?: string;
        is_active?: boolean;
        limit?: number;
        offset?: number;
      } = {},
      signal?: AbortSignal,
    ) =>
      request<AdminUserPage>("/api/admin/users" + queryString(filters), {
        signal,
      }),
    updateAdminUser: (id: string, body: AdminUserPatch, signal?: AbortSignal) =>
      request<UserProfile>("/api/admin/users/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      }),
    adminOrganizations: (signal?: AbortSignal) =>
      request<Organization[]>("/api/admin/organizations", { signal }),
    addAdminOrganization: (
      body: { name: string; is_active: boolean },
      signal?: AbortSignal,
    ) =>
      request<Omit<Organization, "teachers_count">>(
        "/api/admin/organizations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
      ),
    adminLogs: (
      filters: { status?: string; organization_id?: string } = {},
      signal?: AbortSignal,
    ) =>
      request<GenerationLog[]>("/api/admin/logs" + queryString(filters), {
        signal,
      }),
    adminAudit: (offset = 0, signal?: AbortSignal) =>
      request<AdminAuditLog[]>(
        "/api/admin/audit" + queryString({ offset, limit: 100 }),
        { signal },
      ),
    get: <T>(path: string, signal?: AbortSignal) =>
      request<T>(path, { signal }),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    async upload<T>(body: FormData): Promise<T> {
      try {
        return await request<T>("/portfolio/upload", { method: "POST", body, signal: AbortSignal.timeout(120000) });
      } catch (cause) {
        if (cause instanceof ApiError) throw cause;
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error("Нет ответа от сервера загрузки. Проверьте соединение; сервер может запускаться. Причина: " + reason);
      }
    },
    async download(path: string, filename: string) {
      const headers = new Headers();
      if (token) headers.set("Authorization", "Bearer " + token);
      const response = await fetch(apiUrl + path, {
        headers,
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error("Не удалось скачать материал: " + response.status);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
