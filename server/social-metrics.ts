import { readAuthConfig } from "../src/foundation/features/auth/config.js";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cookieName = "__Host-ag_reader";
const ttl = 30 * 86400;
export function createSocialMetricsHandler(
  env: Record<string, string | undefined>,
  fetcher: typeof fetch = fetch,
  now = Date.now,
) {
  return async (request: Request): Promise<Response> => {
    const headers: Record<string, string> = {
      "Cache-Control": "private, no-store",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
    };
    const reply = (
      status: number,
      message: string,
      code = "METRICS_UNAVAILABLE",
    ) => new Response(JSON.stringify({ message, code }), { status, headers });
    if (request.headers.get("Origin") !== new URL(request.url).origin)
      return reply(403, "Pedido não autorizado.");
    if (request.method === "DELETE") {
      headers["Set-Cookie"] =
        `${cookieName}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
      return new Response(null, { status: 204, headers });
    }
    if (!["POST", "GET"].includes(request.method))
      return reply(405, "Método indisponível.");
    if (
      request.method === "POST" &&
      request.headers.get("Content-Type")?.split(";")[0] !== "application/json"
    )
      return reply(403, "Pedido não autorizado.");
    const secret = env.SOCIAL_METRICS_SECRET;
    const supabase = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const key =
      env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const publicConfig = readAuthConfig({
      VITE_SUPABASE_URL: supabase,
      VITE_SUPABASE_PUBLISHABLE_KEY: key,
    });
    // Trust only headers overwritten by Vercel's edge, never an arbitrary direct proxy.
    const ip =
      env.VERCEL === "1"
        ? request.headers.get("x-vercel-forwarded-for")?.trim()
        : null;
    if (
      !publicConfig.ready ||
      !secret ||
      secret.length < 32 ||
      !supabase ||
      !key ||
      !ip ||
      !isIP(ip)
    )
      return reply(503, "Métricas indisponíveis neste ambiente.");
    async function rpc(name: string, payload: Record<string, unknown>) {
      const url = new URL("/rest/v1/rpc/" + name, supabase);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co"))
        throw Error("Invalid provider");
      return fetcher(url, {
        method: "POST",
        headers: {
          apikey: key!,
          "Content-Type": "application/json",
          ...(publicConfig.ready && publicConfig.legacyAnon
            ? { Authorization: `Bearer ${key}` }
            : {}),
        },
        body: JSON.stringify(payload),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
    }
    async function rpcFailure(response: Response) {
      const failure = await response.json().catch(() => null);
      if (
        failure?.code === "42501" &&
        failure.message === "Public content unavailable"
      )
        return reply(
          404,
          "A publicação já não está disponível para contagem.",
          "METRICS_CONTENT_UNAVAILABLE",
        );
      if (
        failure?.code === "42501" &&
        failure.message === "Server proof required"
      )
        return reply(
          503,
          "A configuração de métricas precisa de validação administrativa.",
          "METRICS_PROOF_REJECTED",
        );
      if (failure?.code === "PGRST202" || failure?.code === "42883")
        return reply(
          503,
          "A função de métricas ainda não está disponível neste ambiente.",
          "METRICS_SCHEMA_UNAVAILABLE",
        );
      if (
        failure?.code === "42501" ||
        response.status === 401 ||
        response.status === 403
      )
        return reply(
          503,
          "As permissões da integração de métricas precisam de revisão.",
          "METRICS_PERMISSION_DENIED",
        );
      return reply(
        503,
        "O serviço de dados não confirmou a contagem.",
        "METRICS_RPC_FAILED",
      );
    }
    if (request.method === "GET") {
      try {
        const response = await rpc("social_metrics_status", {
          p_proof: secret,
        });
        if (!response.ok) return rpcFailure(response);
        const result = await response.json();
        if (result?.ready !== true)
          return reply(
            503,
            "Diagnóstico de métricas inválido.",
            "METRICS_INVALID_RESPONSE",
          );
        return new Response(JSON.stringify({ ready: true }), { headers });
      } catch {
        return reply(
          503,
          "Não foi possível contactar o serviço de métricas.",
          "METRICS_NETWORK_ERROR",
        );
      }
    }
    const hash = (text: string) =>
      createHmac("sha256", secret).update(text).digest("hex");
    let body: { work?: string; entry?: string | null };
    try {
      const reader = request.body?.getReader();
      if (!reader) return reply(400, "Pedido inválido.");
      let size = 0,
        text = "";
      const decoder = new TextDecoder();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 512) {
          await reader.cancel();
          return reply(413, "Pedido demasiado grande.");
        }
        text += decoder.decode(part.value, { stream: true });
      }
      body = JSON.parse(text + decoder.decode());
      if (
        !body ||
        !uuid.test(body.work ?? "") ||
        (body.entry != null && !uuid.test(body.entry))
      )
        return reply(400, "Alvo inválido.");
    } catch {
      return reply(400, "Pedido inválido.");
    }
    const seconds = Math.floor(now() / 1000);
    let identity = "";
    const token =
      request.headers
        .get("cookie")
        ?.split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1) ?? "";
    const [candidate, expires, signature] = token.split(".");
    if (
      /^[a-f0-9]{48}$/.test(candidate ?? "") &&
      /^\d{10}$/.test(expires ?? "") &&
      Number(expires) > seconds &&
      Number(expires) <= seconds + ttl &&
      /^[a-f0-9]{64}$/.test(signature ?? "")
    ) {
      if (
        timingSafeEqual(
          Buffer.from(hash(candidate + "." + expires)),
          Buffer.from(signature),
        )
      )
        identity = candidate;
    }
    if (!identity) {
      identity = randomBytes(24).toString("hex");
      const value = identity + "." + (seconds + ttl);
      headers["Set-Cookie"] =
        `${cookieName}=${value}.${hash(value)}; Path=/; Max-Age=${ttl}; Secure; HttpOnly; SameSite=Lax`;
    }
    try {
      const response = await rpc("record_social_view", {
        p_work: body.work,
        p_entry: body.entry ?? null,
        p_visitor: hash(
          "visitor:" +
            body.work +
            ":" +
            (body.entry ?? "work") +
            ":" +
            identity,
        ),
        p_network: hash(
          "network:" + new Date(now()).toISOString().slice(0, 10) + ":" + ip,
        ),
        p_proof: secret,
      });
      if (!response.ok) return rpcFailure(response);
      const result = await response.json();
      if (typeof result?.counted !== "boolean")
        return reply(503, "Resposta de métricas inválida.");
      return new Response(JSON.stringify({ counted: result.counted }), {
        headers,
      });
    } catch {
      return reply(
        503,
        "Métricas temporariamente indisponíveis.",
        "METRICS_NETWORK_ERROR",
      );
    }
  };
}
