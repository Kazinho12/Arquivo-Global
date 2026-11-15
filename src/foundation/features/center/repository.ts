import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthClient } from "../auth/client";
import { getPublicClient } from "../catalog/repository";
export interface CenterItem {
  id: string;
  kind: string;
  slug: string;
  title: string;
  body: string;
  state?: string;
  severity: string;
  starts_at: string;
  ends_at: string | null;
  updated_at: string;
  verified_at: string | null;
  image?: { publication: string; asset: string } | null;
  image_publication?: string | null;
  image_asset?: string | null;
  image_permission?: boolean;
  legal_approved?: boolean;
  revision?: number;
  created_at?: string;
}
export interface Ticket {
  id: string;
  title: string;
  category: string;
  status: string;
  created_at: string;
  updated_at: string;
  case_source?: string;
  case_id?: string;
}
export interface CenterMessage {
  id: string;
  body: string;
  administrative: boolean;
  created_at: string;
}
export interface OfficialNotification {
  id: string;
  title: string;
  body: string;
  kind: string;
  read_at: string | null;
  context: Record<string, string>;
  created_at: string;
}
export class CenterError extends Error {}
export function createCenterRepository(
  client?: SupabaseClient | null,
  owner?: string,
) {
  const pending = new Map<string, string>();
  return {
    async publicItems(
      kind: string,
      slug?: string,
      before?: CenterItem,
    ): Promise<CenterItem[]> {
      const db = client === undefined ? getPublicClient() : client;
      if (!db)
        throw new CenterError(
          "O serviço institucional não está configurado neste ambiente.",
        );
      try {
        const { data, error } = await db.rpc("center_public", {
          p_kind: kind,
          p_slug: slug ?? null,
          p_before: before?.starts_at ?? null,
          p_before_id: before?.id ?? null,
          p_limit: 12,
        });
        if (error)
          throw new CenterError(
            "Não foi possível carregar as informações institucionais. Tenta novamente.",
          );
        if (!Array.isArray(data))
          throw new CenterError("Resposta institucional inválida.");
        return data;
      } catch (e) {
        throw e instanceof CenterError
          ? e
          : new CenterError("Falha de rede no serviço institucional.");
      }
    },
    async member<T = any>(
      action: string,
      payload: Record<string, unknown> = {},
      write = false,
    ): Promise<T> {
      const db = client === undefined ? getAuthClient() : client;
      if (!db)
        throw new CenterError("O serviço de conta não está configurado.");
      const { data: session, error } = await db.auth.getSession();
      if (error || !session.session)
        throw new CenterError("Inicia sessão para acompanhar o pedido.");
      if (owner && session.session.user.id !== owner)
        throw new CenterError("A sessão mudou. Atualiza a página.");
      const key = JSON.stringify([action, payload]),
        operation = write ? (pending.get(key) ?? crypto.randomUUID()) : null;
      if (operation) pending.set(key, operation);
      try {
        const { data, error } = await db
          .rpc("center_member", {
            p_action: action,
            p_data: payload,
            p_operation: operation,
          })
          .setHeader("Authorization", `Bearer ${session.session.access_token}`);
        if (error)
          throw new CenterError(
            error.code === "54000"
              ? "Demasiados pedidos. Aguarda antes de repetir."
              : error.code === "42501"
                ? "Pedido indisponível ou sem permissão."
                : "Não foi possível confirmar o pedido. Revê os campos e tenta novamente.",
          );
        if (write && data?.ok !== true)
          throw new CenterError("O servidor não confirmou o pedido.");
        if (operation) pending.delete(key);
        return data;
      } catch (e) {
        throw e instanceof CenterError
          ? e
          : new CenterError(
              "Falha de rede. Os dados do formulário foram preservados.",
            );
      }
    },
  };
}
export type CenterRepository = ReturnType<typeof createCenterRepository>;
export class AdminNotFound extends Error {}
export function createAdminRepository(
  client?: SupabaseClient | null,
  owner?: string,
  fetcher: typeof fetch = fetch,
) {
  const pending = new Map<string, string>();
  return {
    async call<T = any>(
      action: string,
      payload: Record<string, unknown> = {},
      write = false,
    ): Promise<T> {
      const db = client === undefined ? getAuthClient() : client;
      if (!db) throw new AdminNotFound();
      const { data, error } = await db.auth.getSession();
      if (error || !data.session || (owner && data.session.user.id !== owner))
        throw new AdminNotFound();
      const key = JSON.stringify([action, payload]),
        operation = write ? (pending.get(key) ?? crypto.randomUUID()) : null;
      if (operation) pending.set(key, operation);
      let response;
      try {
        response = await fetcher("/api/admin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.session.access_token}`,
          },
          body: JSON.stringify({ action, payload, operation }),
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
        });
      } catch {
        throw new CenterError(
          "Falha de rede. Repete a operação para confirmar o resultado.",
        );
      }
      if (response.status === 404) throw new AdminNotFound();
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new CenterError(
          typeof result?.message === "string"
            ? result.message
            : "A operação não foi confirmada.",
        );
      if (write && result?.ok !== true)
        throw new CenterError("A operação não foi confirmada.");
      if (operation) pending.delete(key);
      return result;
    },
  };
}
export type AdminRepository = ReturnType<typeof createAdminRepository>;

export function centerLabel(value: string) {
  const labels: Record<string, string> = {
    open: "Aberto",
    new: "Recebida",
    reviewing: "Em análise",
    awaiting_user: "Aguarda resposta",
    resolved: "Resolvido",
    closed: "Encerrado",
    actioned: "Tratado",
    dismissed: "Sem ação",
    draft: "Rascunho",
    published: "Publicado",
    withdrawn: "Retirado",
    campaign: "Campanha",
    notice: "Aviso",
    update: "Atualização",
    status: "Estado",
    policy: "Documento",
    work: "Obra",
    profile: "Perfil",
    comment: "Comentário",
    no_action: "Sem ação",
    warn: "Advertência",
    hide_comment: "Comentário ocultado",
    restore_comment: "Comentário restaurado",
    restrict_work: "Publicação restringida",
    restore_work: "Publicação restaurada",
  };
  return Object.hasOwn(labels, value) ? labels[value] : value;
}
