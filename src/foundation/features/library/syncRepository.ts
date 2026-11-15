export const readingSyncEnabled =
  import.meta.env?.VITE_ENABLE_READING_SYNC === "true";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthClient } from "../auth/client";
export class ReadingError extends Error {
  constructor(
    message: string,
    public code = "network",
  ) {
    super(message);
  }
}
export function createReadingRepository(
  owner: string,
  supplied?: SupabaseClient | null,
) {
  return {
    async call<T = any>(
      action: string,
      data: Record<string, unknown> = {},
      operation?: string,
    ): Promise<T> {
      const client = supplied === undefined ? getAuthClient() : supplied;
      if (!client)
        throw new ReadingError("Sincronização indisponível neste ambiente.");
      const { data: auth, error: authError } = await client.auth.getSession();
      if (
        authError ||
        auth.session?.user.id !== owner ||
        !auth.session.access_token
      )
        throw new ReadingError(
          "A sessão mudou. Os dados deste dispositivo foram preservados.",
          "session",
        );
      try {
        const { data: result, error } = await client
          .rpc("reading_library", {
            p_action: action,
            p_data: data,
            p_operation: operation ?? null,
          })
          .setHeader("Authorization", `Bearer ${auth.session.access_token}`);
        if (error)
          throw new ReadingError(
            error.code === "40001"
              ? "Há dados mais recentes ou definições alteradas. Revê o conflito antes de sincronizar."
              : ["42P01", "42883", "PGRST202"].includes(error.code)
                ? "A biblioteca avançada ainda não está instalada neste ambiente."
                : error.code === "42501"
                  ? "Obra ou capítulo indisponível, ou sem permissão."
                  : error.code === "54000"
                    ? "Limite temporário de operações. Os dados locais foram preservados."
                    : "Não foi possível guardar. Revê os dados e tenta novamente.",
            error.code,
          );
        return result as T;
      } catch (e) {
        throw e instanceof ReadingError
          ? e
          : new ReadingError(
              "Falha de rede. Os dados locais foram preservados.",
            );
      }
    },
  };
}
export type ReadingRepository = ReturnType<typeof createReadingRepository>;
export interface ReadingSettings {
  sync: boolean;
  history: boolean;
  epoch: number;
  revision: number;
}
export interface Locator {
  kind: "prose" | "poetry" | "comic" | "manga" | "webtoon";
  block?: number;
  offset?: number;
  page?: number;
  pageId?: string;
  direction?: "ltr" | "rtl";
  vertical?: boolean;
}
export interface ReadingPoint {
  work: string;
  entry: string;
  position: number;
  locator: Locator;
  completed?: boolean;
  edition?: string;
  time: string;
}
export interface RemotePoint {
  publication_id: string;
  entry_id: string;
  position: number;
  locator: Locator;
  completed: boolean;
  edition: string;
  revision: number;
  seen_at: string | null;
  updated_at?: string;
  available: boolean;
  current_edition: boolean;
}
export interface ReadingWork {
  generation: number;
  revision: number;
  state: string | null;
  entries: RemotePoint[];
}
export interface AccountLibraryItem {
  id: string;
  available: boolean;
  title: string | null;
  author: string | null;
  format: string | null;
  genre: string | null;
  saved: boolean;
  favorite: boolean;
  later: boolean;
  following: boolean;
  state: string | null;
  revision: number | null;
  generation: number;
  last_entry: string | null;
  last_read_at: string | null;
  last_position: number | null;
  publication_updated_at: string | null;
  added_at: string | null;
}
export interface PrivateReadingList {
  id: string;
  name: string;
  description: string;
  revision: number;
  created_at: string;
  updated_at: string;
  count?: number;
  items?: {
    id: string;
    title: string | null;
    available: boolean;
    position: number;
  }[];
}
