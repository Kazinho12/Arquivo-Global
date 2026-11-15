// F4.2-C: add to the EXISTING Worker, before editorial/cover/global OPTIONS/Auth.
// const publicVisual = await handleAgPublicVisualMedia(request, env);
// if (publicVisual) return publicVisual;
// No bucket publication and no fallthrough into private or legacy media routes.
async function handleAgPublicVisualMedia(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/media/editorial-public/")) return null;
  const headers = {
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
  const origins = new Set([
    "https://arquivoglobal.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...(env.MEDIA_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ]);
  const origin = request.headers.get("Origin");
  if (origin && !origins.has(origin))
    return Response.json(
      { message: "Origem não autorizada." },
      { status: 403, headers },
    );
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  const fail = (status) =>
    Response.json(
      {
        message:
          status === 404
            ? "Imagem indisponível."
            : "Não foi possível carregar a imagem.",
      },
      { status, headers },
    );
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const route = url.pathname.match(
    new RegExp(`^/media/editorial-public/(${uuid})/(${uuid})/(${uuid})$`, "i"),
  );
  if (!route || url.search) return fail(404);
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Accept",
        "Access-Control-Max-Age": "600",
      },
    });
  if (request.method !== "GET") return fail(405);
  try {
    const base = new URL(env.SUPABASE_URL);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/"
    )
      return fail(503);
    const key = env.SUPABASE_PUBLISHABLE_KEY;
    let legacy = false;
    if (typeof key === "string" && key.startsWith("eyJ")) {
      try {
        legacy =
          JSON.parse(
            atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
          ).role === "anon";
      } catch {}
    }
    if (
      !(typeof key === "string" && key.startsWith("sb_publishable_")) &&
      !legacy
    )
      return fail(503);
    if (
      typeof env.COVER_MEDIA_TOKEN !== "string" ||
      env.COVER_MEDIA_TOKEN.length < 32 ||
      !env.AG_MEDIA
    )
      return fail(503);
    // Deliberately ignore any incoming user token. Every read uses the public snapshot.
    const response = await fetcher(
      new URL("/rest/v1/rpc/resolve_public_visual_asset", base),
      {
        method: "POST",
        headers: {
          apikey: key,
          "Content-Type": "application/json",
          ...(legacy ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          p_public_id: route[1],
          p_entry_id: route[2],
          p_page_id: route[3],
          p_worker_token: env.COVER_MEDIA_TOKEN,
        }),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) return fail(503);
    const row = await response.json();
    if (!row) return fail(404);
    if (
      !new RegExp(
        `^editorial/${uuid}/${uuid}/${uuid}/${uuid}\\.(jpg|png|webp)$`,
        "i",
      ).test(row.object_key) ||
      !["image/jpeg", "image/png", "image/webp"].includes(row.mime) ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 1 ||
      row.bytes > 20971520
    )
      return fail(503);
    const object = await env.AG_MEDIA.get(row.object_key);
    if (
      !object ||
      object.httpMetadata?.contentType !== row.mime ||
      object.size !== row.bytes
    )
      return fail(404);
    return new Response(object.body, {
      headers: {
        ...headers,
        "Content-Type": row.mime,
        "Content-Length": String(row.bytes),
      },
    });
  } catch {
    return fail(503);
  }
}
