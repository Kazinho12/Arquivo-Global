import { createHash, timingSafeEqual } from "node:crypto";
import { readAuthConfig } from "../src/foundation/features/auth/config.js";
export function createNotificationJobsHandler(
  env: Record<string, string | undefined>,
  fetcher: typeof fetch = fetch,
) {
  return async (request: Request) => {
    const headers = {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Robots-Tag": "noindex, nofollow",
    };
    const reply = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers });
    if (request.method !== "POST")
      return reply(404, { message: "Indisponível." });
    const secret = env.SOCIAL_METRICS_SECRET,
      token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (
      !secret ||
      secret.length < 32 ||
      !token ||
      token.length > 4096 ||
      !timingSafeEqual(
        createHash("sha256").update(secret).digest(),
        createHash("sha256").update(token).digest(),
      )
    )
      return reply(404, { message: "Indisponível." });
    const config = readAuthConfig({
      VITE_SUPABASE_URL: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY:
        env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY,
    });
    if (!config.ready)
      return reply(503, { message: "Processamento não configurado." });
    try {
      const response = await fetcher(
        new URL("/rest/v1/rpc/process_social_jobs", config.url),
        {
          method: "POST",
          headers: {
            apikey: config.key,
            "Content-Type": "application/json",
            ...(config.legacyAnon
              ? { Authorization: `Bearer ${config.key}` }
              : {}),
          },
          body: JSON.stringify({ p_proof: secret, p_limit: 100 }),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok)
        return reply(503, { message: "Não foi possível processar o lote." });
      const data = await response.json();
      if (
        typeof data.enabled !== "boolean" ||
        !Number.isSafeInteger(data.processed) ||
        !Number.isSafeInteger(data.delivered)
      )
        throw Error("Invalid response");
      return reply(200, {
        enabled: data.enabled,
        processed: data.processed,
        delivered: data.delivered,
      });
    } catch {
      return reply(503, { message: "Falha temporária no processamento." });
    }
  };
}
