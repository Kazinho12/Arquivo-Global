import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthClient } from "../auth/client";
import { getPublicClient } from "../catalog/repository";
export const socialEnabled = import.meta.env?.VITE_ENABLE_SOCIAL === "true";
export interface SocialState {
  favorites?: number;
  likes: number;
  comments: number;
  followers: number;
  views: number;
  visitors: number;
  liked: boolean;
  following: boolean;
  saved: boolean;
  favorite: boolean;
  later: boolean;
  can_moderate: boolean;
}
export interface SocialComment {
  id: string;
  parent_id: string | null;
  body: string;
  status: "visible" | "deleted" | "hidden";
  author_name: string | null;
  author_username: string | null;
  created_at: string;
  edited_at: string | null;
  own: boolean | null;
  likes: number;
  liked: boolean;
}
export interface SocialItem {
  following?: boolean;
  id: string;
  title: string | null;
  format: string | null;
  available: boolean;
  saved: boolean;
  favorite: boolean;
  later: boolean;
  updated_at: string;
}
export type SocialAction =
  | "like"
  | "follow"
  | "saved"
  | "favorite"
  | "later"
  | "comment"
  | "edit_comment"
  | "delete_comment"
  | "comment_like"
  | "report"
  | "hide"
  | "restore_comment"
  | "dismiss_report";
export function socialError(code?: string) {
  if (["42P01", "42883", "PGRST202"].includes(code ?? ""))
    return "As interações ainda não estão instaladas neste ambiente.";
  if (code === "42501")
    return "Conteúdo indisponível ou sem permissão. Confirma a tua sessão.";
  if (code === "54000")
    return "Demasiadas operações. Aguarda um pouco antes de tentar novamente.";
  if (["22023", "22P02", "23514"].includes(code ?? ""))
    return "Revê o comentário e os dados da operação.";
  return "Não foi possível comunicar com as interações. Tenta novamente.";
}
export function parseSocialState(value: unknown): SocialState {
  const v = value as SocialState;
  if (
    !v ||
    ["likes", "comments", "followers", "views", "visitors"].some(
      (k) =>
        !Number.isSafeInteger(v[k as keyof SocialState]) ||
        Number(v[k as keyof SocialState]) < 0,
    ) ||
    ["liked", "following", "saved", "favorite", "later", "can_moderate"].some(
      (k) => typeof v[k as keyof SocialState] !== "boolean",
    )
  )
    throw Error("Resposta social inválida.");
  if (
    v.favorites !== undefined &&
    (!Number.isSafeInteger(v.favorites) || v.favorites < 0)
  )
    throw Error("Resposta social inválida.");
  return v;
}
class SocialServiceError extends Error {}
export function createSocialRepository(
  client?: SupabaseClient | null,
  expectedOwner?: string,
) {
  const pending = new Map<string, string>();
  async function call(
    name: string,
    args: Record<string, unknown>,
    write = false,
  ) {
    const db =
      client === undefined
        ? write
          ? getAuthClient()
          : (getAuthClient() ?? getPublicClient())
        : client;
    if (!db)
      throw Error("As interações não estão configuradas neste ambiente.");
    let token: string | undefined;
    if (write) {
      const { data, error } = await db.auth.getSession();
      if (error || !data.session?.access_token)
        throw Error("Inicia sessão para interagir.");
      if (expectedOwner && data.session.user.id !== expectedOwner)
        throw Error("A sessão mudou. Atualiza a página antes de interagir.");
      token = data.session.access_token;
    }
    try {
      const request = db.rpc(name, args);
      const { data, error } = await (token
        ? request.setHeader("Authorization", `Bearer ${token}`)
        : request);
      if (error) throw new SocialServiceError(socialError(error.code));
      return data;
    } catch (e) {
      throw Error(e instanceof SocialServiceError ? e.message : socialError());
    }
  }
  return {
    async state(work: string, entry?: string) {
      return parseSocialState(
        await call("read_social_state", {
          p_work: work,
          p_entry: entry ?? null,
        }),
      );
    },
    async mutate(
      work: string,
      entry: string | undefined,
      action: SocialAction,
      payload: Record<string, unknown>,
    ) {
      const key = JSON.stringify([work, entry, action, payload]),
        operation = pending.get(key) ?? crypto.randomUUID();
      pending.set(key, operation);
      const result = await call(
        "mutate_social",
        {
          p_work: work,
          p_entry: entry ?? null,
          p_action: action,
          p_payload: payload,
          p_operation: operation,
        },
        true,
      );
      if (result?.ok !== true)
        throw Error("O servidor não confirmou a operação.");
      pending.delete(key);
      return result;
    },
    async comments(
      work: string,
      entry?: string,
      before?: SocialComment,
    ): Promise<SocialComment[]> {
      const rows = await call("read_social_comments", {
        p_work: work,
        p_entry: entry ?? null,
        p_before: before?.created_at ?? null,
        p_before_id: before?.id ?? null,
        p_limit: 20,
      });
      if (
        !Array.isArray(rows) ||
        rows.some(
          (r) =>
            !r ||
            typeof r.id !== "string" ||
            typeof r.body !== "string" ||
            !["visible", "hidden", "deleted"].includes(r.status),
        )
      )
        throw Error("Comentários inválidos.");
      return rows;
    },
    async library(before?: SocialItem): Promise<SocialItem[]> {
      const rows = await call(
        "read_social_library",
        {
          p_before: before?.updated_at ?? null,
          p_before_id: before?.id ?? null,
          p_limit: 24,
        },
        true,
      );
      if (!Array.isArray(rows)) throw Error("Biblioteca inválida.");
      return rows;
    },
    async removeLibrary(work: string, field = "all") {
      await call(
        "remove_social_library",
        { p_work: work, p_field: field },
        true,
      );
    },
    async author(
      id: string,
    ): Promise<{ followers: number; followed: number; following: boolean }> {
      return call("read_author_follow", { p_author: id });
    },
    async followAuthor(id: string, value: boolean) {
      return call("set_author_follow", { p_author: id, p_value: value }, true);
    },
    async reports(): Promise<
      {
        id: string;
        comment_id: string;
        reason: string;
        body: string;
        publication_id: string;
        entry_id: string | null;
      }[]
    > {
      return call("read_social_reports", {}, true);
    },
  };
}
export type SocialRepository = ReturnType<typeof createSocialRepository>;
