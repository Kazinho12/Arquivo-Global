import type { SupabaseClient } from "@supabase/supabase-js";
export const publicVisualReaderEnabled =
  import.meta.env?.VITE_ENABLE_PUBLIC_VISUAL_READER === "true";
export const PUBLIC_VISUAL_BATCH = 20;
export interface PublicVisualPage {
  id: string;
  position: number;
  width: number;
  height: number;
}
export interface PublicVisualBatch {
  total: number;
  items: PublicVisualPage[];
}
export interface PublicVisualRepository {
  pages(
    workId: string,
    entryId: string,
    offset: number,
  ): Promise<PublicVisualBatch | null>;
}
export const isPublicVisualId = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export function publicVisualImageUrl(
  work: string,
  entry: string,
  page: string,
) {
  if (![work, entry, page].every(isPublicVisualId))
    throw Error("Identificador público inválido.");
  return `https://arquivo-global-api.killiandesigner.workers.dev/media/editorial-public/${work}/${entry}/${page}`;
}
export function parsePublicVisualBatch(
  value: any,
  offset: number,
): PublicVisualBatch | null {
  if (value === null) return null;
  if (
    !value ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0 ||
    !Array.isArray(value.items) ||
    value.items.length > PUBLIC_VISUAL_BATCH ||
    value.items.length !==
      Math.min(PUBLIC_VISUAL_BATCH, Math.max(0, value.total - offset))
  )
    throw Error("Sequência pública inválida.");
  const ids = new Set();
  const items = value.items.map((p: any, i: number) => {
    if (
      !isPublicVisualId(p.id) ||
      ids.has(p.id) ||
      p.position !== offset + i + 1 ||
      !Number.isSafeInteger(p.width) ||
      !Number.isSafeInteger(p.height) ||
      p.width < 1 ||
      p.height < 1 ||
      p.width > 16384 ||
      p.height > 65535 ||
      p.width * p.height > 40000000
    )
      throw Error("Página pública inválida.");
    ids.add(p.id);
    return { id: p.id, position: p.position, width: p.width, height: p.height };
  });
  return { total: value.total, items };
}
export function createPublicVisualRepository(
  client: SupabaseClient | null,
): PublicVisualRepository {
  return {
    async pages(workId, entryId, offset) {
      if (
        !isPublicVisualId(workId) ||
        !isPublicVisualId(entryId) ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      )
        return null;
      if (!client) throw Error("Leitura pública não configurada.");
      try {
        const { data, error } = await client.rpc("read_public_visual_pages", {
          p_public_id: workId,
          p_entry_id: entryId,
          p_offset: offset,
          p_limit: PUBLIC_VISUAL_BATCH,
        });
        if (error) throw error;
        return parsePublicVisualBatch(data, offset);
      } catch {
        throw Error(
          "Não foi possível carregar as páginas. Verifica a ligação e tenta novamente.",
        );
      }
    },
  };
}
// Editorial order is stable; only the gesture/key meaning changes for RTL.
export function visualStep(key: string, direction: "ltr" | "rtl") {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return 0;
  return (key === "ArrowRight") === (direction === "ltr") ? 1 : -1;
}
