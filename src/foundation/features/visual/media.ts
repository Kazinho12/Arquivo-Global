import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthClient } from "../auth/client";
import { inspectFile } from "./image";
import { readVisualAsset, VISUAL_LIMITS, type VisualLimits } from "./types";
const API = "https://arquivo-global-api.killiandesigner.workers.dev";
export function visualMedia(
  ownerId: string,
  injected?: SupabaseClient | null,
  fetcher: typeof fetch = fetch,
) {
  async function request(path: string, init: RequestInit) {
    const client = injected === undefined ? getAuthClient() : injected;
    if (!client) throw Error("Serviço de conta indisponível.");
    const { data, error } = await client.auth.getSession();
    if (
      error ||
      data.session?.user.id !== ownerId ||
      !data.session.access_token
    )
      throw Error("Inicia sessão na conta proprietária.");
    let response: Response;
    try {
      response = await fetcher(API + path, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${data.session.access_token}`,
        },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch (e) {
      throw Error(
        init.signal?.aborted
          ? "Envio interrompido; podes repetir."
          : "Falha de rede. As alterações locais foram preservadas.",
      );
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message =
        typeof body?.message === "string"
          ? body.message
              .replace(/Bearer\s+\S+/gi, "[oculto]")
              .replace(
                /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
                "[oculto]",
              )
              .slice(0, 200)
          : "Operação indisponível.";
      throw Error(`Media editorial (HTTP ${response.status}): ${message}`);
    }
    const current = await client.auth.getSession();
    if (current.data.session?.user.id !== ownerId || init.signal?.aborted)
      throw Error("A sessão mudou ou o pedido foi interrompido.");
    return response;
  }
  return {
    async limits(): Promise<VisualLimits> {
      const r = await request("/media/editorial/limits", { method: "GET" });
      const v = await r.json();
      for (const k of ["bytes", "pixels", "width", "height", "pages"] as const)
        if (
          !Number.isSafeInteger(v[k]) ||
          v[k] < 1 ||
          (k !== "pages" && v[k] > VISUAL_LIMITS[k])
        )
          throw Error("Limites do editor inválidos.");
      return { ...v, concurrent: 2 };
    },
    async upload(
      workId: string,
      entryId: string,
      file: File,
      signal?: AbortSignal,
    ) {
      await inspectFile(file);
      const filename =
        Array.from(file.name.replace(/[\x00-\x1f\x7f]/g, "").trim())
          .slice(0, 255)
          .join("") || "imagem";
      const r = await request(
        `/media/editorial/works/${workId}/entries/${entryId}`,
        {
          method: "POST",
          body: file,
          headers: {
            "Content-Type": file.type,
            "X-File-Name": encodeURIComponent(filename),
          },
          signal,
        },
      );
      return readVisualAsset(await r.json());
    },
    async read(
      workId: string,
      entryId: string,
      assetId: string,
      signal?: AbortSignal,
    ) {
      const r = await request(
        `/media/editorial/private/${workId}/${entryId}/${assetId}`,
        { method: "GET", signal },
      );
      const blob = await r.blob();
      if (
        blob.size > 20971520 ||
        !["image/jpeg", "image/png", "image/webp"].includes(blob.type)
      )
        throw Error("Imagem recebida inválida.");
      return blob;
    },
    async cleanup() {
      const r = await request("/media/editorial/cleanup", { method: "POST" });
      const data = await r.json();
      if (!Number.isSafeInteger(data.removed) || data.removed < 0)
        throw Error("Resposta de limpeza inválida.");
      return data.removed as number;
    },
  };
}
export async function mapLimited<T>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(items.length, Math.max(1, limit)) },
    async () => {
      while (!signal?.aborted) {
        const i = cursor++;
        if (i >= items.length) return;
        await run(items[i], i);
      }
    },
  );
  await Promise.all(workers);
}
// Original downloads are bounded independently of upload concurrency.
let active = 0;
const queue: (() => Promise<void>)[] = [];
function drain() {
  while (active < 2 && queue.length) {
    active++;
    const task = queue.shift()!;
    void Promise.resolve()
      .then(task)
      .finally(() => {
        active--;
        drain();
      });
  }
}
export function readSlot<T>(
  task: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        if (signal.aborted) throw Error("Pedido interrompido.");
        resolve(await task());
      } catch (error) {
        reject(error);
      }
    });
    drain();
  });
}
