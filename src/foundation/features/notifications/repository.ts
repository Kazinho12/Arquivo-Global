import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthClient } from "../auth/client";
export const notificationsAnalyticsEnabled =
  import.meta.env?.VITE_ENABLE_NOTIFICATIONS_ANALYTICS === "true";
export interface InboxItem {
  id: string;
  kind: "social" | "official" | "service";
  category: string | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  group_count: number;
  path: string | null;
  context: Record<string, string>;
}
export interface NotificationPreferences {
  followers: boolean;
  likes: boolean;
  comments: boolean;
  replies: boolean;
  authors: boolean;
  works: boolean;
  official: boolean;
  revision: number;
}
export function createNotificationRepository(
  owner: string,
  provided?: SupabaseClient | null,
) {
  const pending = new Map<string, string>();
  async function rpc<T = any>(name: string, args: Record<string, unknown>) {
    const db = provided === undefined ? getAuthClient() : provided;
    if (!db) throw Error("Serviço indisponível neste ambiente.");
    const { data: auth, error: sessionError } = await db.auth.getSession();
    if (
      sessionError ||
      auth.session?.user.id !== owner ||
      !auth.session.access_token
    )
      throw Error("A sessão mudou. Atualiza a página para continuar.");
    try {
      const { data, error } = await db
        .rpc(name, args)
        .setHeader("Authorization", `Bearer ${auth.session.access_token}`);
      if (error)
        throw Error(
          error.code === "40001"
            ? "As preferências foram alteradas noutro dispositivo. Atualiza antes de guardar."
            : ["42883", "42P01", "PGRST202"].includes(error.code)
              ? "A F5.4 ainda não está instalada neste ambiente."
              : error.code === "54000"
                ? "Demasiadas operações. Aguarda antes de tentar novamente."
                : error.code === "P0002" || error.code === "42501"
                  ? "Dados indisponíveis ou sem permissão."
                  : "Não foi possível confirmar a operação.",
        );
      return data as T;
    } catch (e) {
      throw e instanceof Error ? e : Error("Falha de rede. Tenta novamente.");
    }
  }
  return {
    async member<T = any>(
      action: string,
      data: Record<string, unknown> = {},
      write = false,
    ): Promise<T> {
      const key = JSON.stringify([action, data]);
      const operation = write
        ? (pending.get(key) ?? crypto.randomUUID())
        : null;
      if (operation) pending.set(key, operation);
      const result = await rpc<T>("notification_member", {
        p_action: action,
        p_data: data,
        p_operation: operation,
      });
      if (write) {
        if ((result as any)?.ok !== true)
          throw Error("O servidor não confirmou a operação.");
        pending.delete(key);
      }
      return result;
    },
    analytics(action: string, work?: string, before?: string, period = 30) {
      return rpc("author_analytics", {
        p_action: action,
        p_work: work ?? null,
        p_before: before ?? null,
        p_period: period,
      });
    },
    diagnostics(retry?: string) {
      return rpc("notification_diagnostics", { p_retry: retry ?? null });
    },
  };
}
export type NotificationRepository = ReturnType<
  typeof createNotificationRepository
>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function notificationLink(n: InboxItem) {
  if (n.kind === "social")
    return n.path &&
      (/^\/obras\/[a-f0-9-]{36}(?:\/capitulos\/[a-f0-9-]{36})?$/.test(n.path) ||
        /^\/utilizadores\/[a-z0-9_]{3,30}$/.test(n.path))
      ? n.path
      : null;
  if (uuid.test(n.context.ticket_id ?? ""))
    return "/suporte?pedido=" + n.context.ticket_id;
  if (
    uuid.test(n.context.case_id ?? "") &&
    ["center", "social"].includes(n.context.source)
  )
    return `/suporte?categoria=appeal&caso=${n.context.case_id}&origem=${n.context.source}`;
  return null;
}
