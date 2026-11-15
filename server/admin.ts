import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readAuthConfig } from "../src/foundation/features/auth/config.js";
export const ADMIN_COOKIE = "__Host-ag_admin";
export function createAdminHandler(
  env: Record<string, string | undefined>,
  fetcher: typeof fetch = fetch,
  readIndex = () => readFile(join(process.cwd(), "dist/index.html"), "utf8"),
  now = Date.now,
) {
  return async (request: Request): Promise<Response> => {
    const headers: Record<string, string> = {
      "Cache-Control": "private, no-store",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    };
    const fail = (status = 404, message = "Página não encontrada.") =>
      new Response(JSON.stringify({ message }), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    const url = new URL(request.url),
      session = url.searchParams.get("resource") === "session",
      page = url.searchParams.get("resource") === "page";
    if (url.searchParams.has("resource") && !session && !page) return fail();
    if (
      request.method !== "GET" &&
      request.headers.get("Origin") !== url.origin
    )
      return fail();
    if (session && request.method === "DELETE") {
      headers["Set-Cookie"] =
        `${ADMIN_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
      return new Response(null, { status: 204, headers });
    }
    if (
      !(
        (page && request.method === "GET") ||
        (!page && request.method === "POST")
      )
    )
      return fail();
    const config = readAuthConfig({
      VITE_SUPABASE_URL: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY:
        env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY,
    });
    if (!config.ready) return fail();
    let token = "";
    if (page) {
      const cookie = request.headers
        .get("cookie")
        ?.split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(ADMIN_COOKIE + "="));
      try {
        token = decodeURIComponent(
          cookie?.slice(ADMIN_COOKIE.length + 1) ?? "",
        );
      } catch {
        return fail();
      }
    } else
      token =
        request.headers
          .get("Authorization")
          ?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1] ?? "";
    if (!token || token.length > 8192) return fail();
    const rpc = async (name: string, payload: Record<string, unknown>) =>
      fetcher(new URL("/rest/v1/rpc/" + name, config.url), {
        method: "POST",
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
    let authorized = false;
    try {
      const identity = await fetcher(new URL("/auth/v1/user", config.url), {
        headers: { apikey: config.key, Authorization: `Bearer ${token}` },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!identity.ok) return fail();
      const user = await identity.json();
      if (typeof user?.id !== "string") return fail();
      const permission = await rpc("read_admin_bootstrap", {});
      if (!permission.ok) return fail();
      const grant = await permission.json();
      if (grant?.authorized !== true || grant.id !== user.id) return fail();
      authorized = true;
      if (session) {
        const claims = JSON.parse(
          Buffer.from(token.split(".")[1], "base64url").toString(),
        );
        const age = Math.min(
          300,
          Number(claims.exp) - Math.floor(now() / 1000),
        );
        if (!Number.isFinite(age) || age < 1) return fail();
        headers["Set-Cookie"] =
          `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(age)}; Secure; HttpOnly; SameSite=Strict`;
        return new Response(null, { status: 204, headers });
      }
      if (page)
        return new Response(await readIndex(), {
          headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
        });
      const reader = request.body?.getReader();
      if (!reader) return fail(400, "Pedido inválido.");
      let bytes = 0,
        text = "";
      const decoder = new TextDecoder();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 32768) {
          await reader.cancel();
          return fail(413, "Pedido demasiado grande.");
        }
        text += decoder.decode(part.value, { stream: true });
      }
      let body;
      try {
        body = JSON.parse(text + decoder.decode());
      } catch {
        return fail(400, "Pedido inválido.");
      }
      if (
        !body ||
        typeof body.action !== "string" ||
        !body.payload ||
        typeof body.payload !== "object" ||
        Array.isArray(body.payload)
      )
        return fail(400, "Pedido inválido.");
      const result = await rpc("admin_console", {
        p_action: body.action,
        p_data: body.payload,
        p_operation: body.operation ?? null,
      });
      if (!result.ok) {
        const error = await result.json().catch(() => null);
        if (error?.code === "P0002" || result.status === 401) return fail();
        if (error?.code === "40001")
          return fail(
            409,
            "O registo mudou. Recupera a versão atual antes de guardar.",
          );
        if (error?.code === "54000")
          return fail(429, "Aguarda antes de repetir a operação.");
        return fail(
          400,
          "Revê os dados e confirma as permissões e os requisitos da operação.",
        );
      }
      return new Response(JSON.stringify(await result.json()), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    } catch {
      return fail(
        !authorized || page ? 404 : 503,
        !authorized || page
          ? "Página não encontrada."
          : "Não foi possível confirmar a operação administrativa.",
      );
    }
  };
}
