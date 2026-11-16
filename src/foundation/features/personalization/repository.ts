import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthClient } from "../auth/client";
import { defaults, validateSnapshot, type PersonalSnapshot } from "./model";
export const personalizationSyncEnabled =
  import.meta.env?.VITE_ENABLE_GLOBAL_PERSONALIZATION === "true";
export function createPersonalizationRepository(
  owner: string,
  provided?: SupabaseClient | null,
) {
  const pending = new Map<string, string>();
  return {
    async call(action: "read" | "save", snapshot?: PersonalSnapshot) {
      const db = provided === undefined ? getAuthClient() : provided;
      if (!db)
        throw Error(
          "Sincronização indisponível. Os dados locais foram preservados.",
        );
      const { data: auth, error } = await db.auth.getSession();
      if (
        error ||
        auth.session?.user.id !== owner ||
        !auth.session.access_token
      )
        throw Error(
          "A conta mudou. Não foram transferidos dados entre contas.",
        );
      const key = JSON.stringify(snapshot),
        op =
          action === "save" ? (pending.get(key) ?? crypto.randomUUID()) : null;
      if (op) pending.set(key, op);
      const { data, error: failure } = await db
        .rpc("global_personalization", {
          p_action: action,
          p_payload: snapshot
            ? { settings: snapshot.settings, themes: snapshot.themes }
            : null,
          p_revision: snapshot?.revision ?? null,
          p_operation: op,
        })
        .setHeader("Authorization", `Bearer ${auth.session.access_token}`);
      if (failure)
        throw Object.assign(
          Error(
            failure.code === "40001"
              ? "Há alterações noutro dispositivo. Recarrega e concilia antes de guardar."
              : ["42883", "42P01", "PGRST202"].includes(failure.code)
                ? "A migration de personalização ainda não está instalada."
                : "Não foi possível confirmar a gravação. Os dados locais foram preservados.",
          ),
          { code: failure.code },
        );
      const result =
        data.settings === null ? defaults() : validateSnapshot(data);
      if (op) pending.delete(key);
      return result;
    },
  };
}
