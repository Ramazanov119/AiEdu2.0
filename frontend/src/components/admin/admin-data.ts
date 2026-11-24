"use client";
import { useEffect, useState } from "react";
export function errorText(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError")
      return "Сервер не ответил вовремя. Попробуйте ещё раз.";
    if (error.message === "Failed to fetch")
      return "Нет соединения с API. Проверьте адрес сервера и подключение.";
    return error.message;
  }
  return "Не удалось выполнить запрос.";
}
export function useAdminData<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  onFailure: (error: unknown) => void,
  refresh: number,
) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    loader(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          onFailure(error);
          setError(errorText(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loader, onFailure, refresh]);
  return { data, loading, error };
}
