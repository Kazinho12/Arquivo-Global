// F4.2-B only. Add to the EXISTING Worker; dispatch BEFORE global OPTIONS/Auth.
// const visualResponse=await handleAgEditorialMedia(request,env);
// if(visualResponse) return visualResponse;
// No public editorial route exists in this phase. Preserve all avatar/cover handlers.
async function handleAgEditorialMedia(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/media/editorial/")) return null;
  const origins = new Set([
    "https://arquivoglobal.vercel.app",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    ...(env.MEDIA_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ]);
  const origin = request.headers.get("Origin"),
    headers = {
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
  if (origin && origins.has(origin))
    headers["Access-Control-Allow-Origin"] = origin;
  const reply = (message, status = 200) =>
    Response.json({ message }, { status, headers });
  if (origin && !origins.has(origin))
    return reply("Origem não autorizada.", 403);
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, X-File-Name",
        "Access-Control-Max-Age": "600",
      },
    });
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const upload = url.pathname.match(
    new RegExp(`^/media/editorial/works/(${uuid})/entries/(${uuid})$`, "i"),
  );
  const read = url.pathname.match(
    new RegExp(`^/media/editorial/private/(${uuid})/(${uuid})/(${uuid})$`, "i"),
  );
  const remove = url.pathname.match(
    new RegExp(`^/media/editorial/assets/(${uuid})$`, "i"),
  );
  const cleanup = url.pathname === "/media/editorial/cleanup",
    limits = url.pathname === "/media/editorial/limits";
  if (url.search || (!upload && !read && !remove && !cleanup && !limits))
    return reply("Não encontrado.", 404);
  const auth = request.headers.get("Authorization");
  if (!auth || !/^Bearer \S+$/.test(auth)) return reply("Inicia sessão.", 401);
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
      return reply("Media indisponível.", 503);
    const key = env.SUPABASE_PUBLISHABLE_KEY;
    let valid = typeof key === "string" && key.startsWith("sb_publishable_");
    if (!valid && typeof key === "string" && key.startsWith("eyJ")) {
      try {
        valid =
          JSON.parse(
            atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
          ).role === "anon";
      } catch {}
    }
    if (!valid) return reply("Media indisponível.", 503);
    const http = async (path, { method = "GET", body } = {}) => {
      const response = await fetcher(new URL(path, base), {
        method,
        headers: {
          apikey: key,
          Authorization: auth,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const e = new Error("Operação recusada");
        e.status = ["23503", "55000", "40001"].includes(data?.code)
          ? 409
          : data?.code === "54000"
            ? 413
            : response.status === 401
              ? 401
              : response.status === 403
                ? 403
                : 503;
        throw e;
      }
      return response.status === 204 ? null : response.json();
    };
    const user = await http("/auth/v1/user");
    if (!user?.id || !new RegExp(`^${uuid}$`, "i").test(user.id))
      return reply("Sessão inválida.", 401);
    const owner = user.id;
    if (limits && request.method === "GET")
      return Response.json(
        await http("/rest/v1/rpc/visual_editor_limits", {
          method: "POST",
          body: {},
        }),
        { headers },
      );
    if (
      request.method !== "GET" &&
      (typeof env.COVER_MEDIA_TOKEN !== "string" ||
        env.COVER_MEDIA_TOKEN.length < 32)
    )
      return reply("Media por configurar.", 503);
    const rpc = (name, body) =>
      http("/rest/v1/rpc/" + name, {
        method: "POST",
        body: { ...body, p_worker_token: env.COVER_MEDIA_TOKEN },
      });
    const keyPattern = new RegExp(
      `^editorial/${uuid}/${uuid}/${uuid}/${uuid}\\.(jpg|png|webp)$`,
      "i",
    );
    const ownsEntry = async (workId, entryId) => {
      const rows = await http(
        `/rest/v1/work_entries?select=id,work_id,entry_type&id=eq.${entryId}&work_id=eq.${workId}`,
      );
      return (
        Array.isArray(rows) &&
        rows.length === 1 &&
        rows[0].id === entryId &&
        rows[0].work_id === workId &&
        rows[0].entry_type === "visual"
      );
    };
    const destroy = async (id) => {
      const row = await rpc("begin_delete_editorial", { p_asset_id: id });
      if (
        !row ||
        row.owner_id !== owner ||
        !keyPattern.test(row.object_key) ||
        !row.object_key.startsWith("editorial/" + owner + "/")
      )
        throw Error("Invalid asset");
      await env.AG_MEDIA.delete(row.object_key);
      await rpc("finish_delete_editorial", { p_asset_id: id });
    };
    if (read && request.method === "GET") {
      const [_, workId, entryId, id] = read;
      if (!(await ownsEntry(workId, entryId)))
        return reply("Não encontrado.", 404);
      const rows = await http(
        `/rest/v1/editorial_assets?select=id,owner_id,work_id,entry_id,object_key,mime,state&id=eq.${id}&owner_id=eq.${owner}`,
      );
      const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
      if (
        !row ||
        row.state !== "ready" ||
        !keyPattern.test(row.object_key) ||
        !row.object_key.startsWith("editorial/" + owner + "/")
      )
        return reply("Não encontrado.", 404);
      if (row.work_id !== workId || row.entry_id !== entryId) {
        const refs = await http(
          `/rest/v1/visual_pages?select=id&entry_id=eq.${entryId}&asset_id=eq.${id}&limit=1`,
        );
        if (!refs?.length) return reply("Não encontrado.", 404);
      }
      const object = await env.AG_MEDIA.get(row.object_key);
      if (!object || object.httpMetadata?.contentType !== row.mime)
        return reply("Não encontrado.", 404);
      return new Response(object.body, {
        headers: { ...headers, "Content-Type": row.mime },
      });
    }
    if (remove && request.method === "DELETE") {
      await destroy(remove[1]);
      return reply("Imagem não utilizada eliminada.");
    }
    if (cleanup && request.method === "POST") {
      const rows = await rpc("list_unused_editorial_assets", { p_limit: 50 });
      let removed = 0;
      for (const row of rows) {
        try {
          await destroy(row.id);
          removed++;
        } catch (e) {
          if (e.status !== 409) throw e;
        }
      }
      return Response.json({ removed }, { headers });
    }
    if (!upload || request.method !== "POST")
      return reply("Método não permitido.", 405);
    const [_, workId, entryId] = upload;
    if (!(await ownsEntry(workId, entryId)))
      return reply("Não encontrado.", 404);
    const mime = request.headers.get("Content-Type");
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime))
      return reply("Escolhe JPEG, PNG ou WebP estático.", 415);
    const max = Math.min(
      20971520,
      Math.max(1, Number(env.MEDIA_MAX_EDITORIAL_BYTES) || 20971520),
    );
    if (Number(request.headers.get("Content-Length")) > max)
      return reply("Imagem acima do limite.", 413);
    const reader = request.body?.getReader();
    if (!reader) return reply("Imagem vazia.", 400);
    const parts = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) {
        await reader.cancel();
        return reply("Imagem acima do limite.", 413);
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    let info;
    try {
      info = inspectAgEditorialImage(bytes, mime);
    } catch {
      return reply("Imagem inválida ou dimensões acima do limite.", 415);
    }
    let filename;
    try {
      filename = Array.from(
        decodeURIComponent(request.headers.get("X-File-Name") || "imagem")
          .replace(/[\x00-\x1f\x7f]/g, "")
          .trim(),
      )
        .slice(0, 255)
        .join("");
    } catch {
      return reply("Nome inválido.", 400);
    }
    if (!filename) filename = "imagem";
    const row = await rpc("reserve_editorial_upload", {
      p_work_id: workId,
      p_entry_id: entryId,
      p_mime: mime,
      p_bytes: length,
      p_width: info.width,
      p_height: info.height,
      p_filename: filename,
    });
    if (
      !row ||
      row.owner_id !== owner ||
      !keyPattern.test(row.object_key) ||
      !row.object_key.startsWith("editorial/" + owner + "/")
    )
      throw Error("Invalid asset");
    await env.AG_MEDIA.put(row.object_key, bytes, {
      httpMetadata: { contentType: mime },
    });
    const saved = await rpc("finish_editorial_upload", { p_asset_id: row.id });
    return Response.json(
      {
        id: saved.id,
        filename: saved.filename,
        mime: saved.mime,
        bytes: saved.bytes,
        width: saved.width,
        height: saved.height,
      },
      { status: 201, headers },
    );
  } catch (e) {
    return reply(
      e.status === 409
        ? "Imagem em uso ou upload em curso."
        : e.status === 413
          ? "Quota de armazenamento excedida."
          : "Não foi possível concluir a operação. Tenta novamente.",
      e.status || 503,
    );
  }
}

function inspectAgEditorialImage(bytes, mime) {
  const b = bytes,
    n = b.length,
    view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (a, z) => String.fromCharCode(...b.slice(a, z));
  let width = 0,
    height = 0;
  const invalid = () => {
    throw Error("Imagem inválida, truncada ou acima dos limites de dimensões.");
  };
  if (n < 1 || n > 20971520) invalid();
  if (mime === "image/png") {
    if (
      n < 45 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v) ||
      ascii(12, 16) !== "IHDR" ||
      view.getUint32(8) !== 13
    )
      invalid();
    width = view.getUint32(16);
    height = view.getUint32(20);
    let pos = 8,
      data = false,
      end = false;
    while (pos + 12 <= n) {
      const size = view.getUint32(pos);
      if (size > n - pos - 12) invalid();
      const type = ascii(pos + 4, pos + 8);
      if (type === "IDAT" && size > 0) data = true;
      if (type === "IEND") {
        end = size === 0 && pos + 12 === n;
        break;
      }
      pos += size + 12;
    }
    if (!data || !end) invalid();
  } else if (mime === "image/webp") {
    if (
      n < 20 ||
      ascii(0, 4) !== "RIFF" ||
      ascii(8, 12) !== "WEBP" ||
      view.getUint32(4, true) + 8 !== n
    )
      invalid();
    let pos = 12,
      frame = false;
    while (pos + 8 <= n) {
      const type = ascii(pos, pos + 4),
        size = view.getUint32(pos + 4, true),
        start = pos + 8;
      if (size > n - start) invalid();
      if (type === "VP8X") {
        if (size < 10 || b[start] & 2) invalid();
        width = 1 + b[start + 4] + (b[start + 5] << 8) + (b[start + 6] << 16);
        height = 1 + b[start + 7] + (b[start + 8] << 8) + (b[start + 9] << 16);
      }
      if (type === "VP8 ") {
        if (size < 10 || ascii(start + 3, start + 6) !== "\x9d\x01\x2a")
          invalid();
        const w = view.getUint16(start + 6, true) & 16383,
          h = view.getUint16(start + 8, true) & 16383;
        if (!width) {
          width = w;
          height = h;
        }
        frame = true;
      }
      if (type === "VP8L") {
        if (size < 5 || b[start] !== 47) invalid();
        const bits = view.getUint32(start + 1, true);
        if (!width) {
          width = (bits & 16383) + 1;
          height = ((bits >>> 14) & 16383) + 1;
        }
        frame = true;
      }
      pos = start + size + (size % 2);
    }
    if (!frame || pos !== n) invalid();
  } else if (mime === "image/jpeg") {
    if (
      n < 12 ||
      b[0] !== 255 ||
      b[1] !== 216 ||
      b[n - 2] !== 255 ||
      b[n - 1] !== 217
    )
      invalid();
    let pos = 2,
      scan = false;
    while (pos < n - 2) {
      if (b[pos++] !== 255) invalid();
      while (b[pos] === 255) pos++;
      const marker = b[pos++];
      if (pos + 2 > n) invalid();
      const size = (b[pos] << 8) | b[pos + 1];
      if (size < 2 || pos + size > n) invalid();
      if ([192, 193, 194].includes(marker)) {
        if (size < 8) invalid();
        height = (b[pos + 3] << 8) | b[pos + 4];
        width = (b[pos + 5] << 8) | b[pos + 6];
      }
      if (marker === 218) {
        scan = Boolean(width && height) && pos + size < n - 2;
        break;
      }
      pos += size;
    }
    if (!scan) invalid();
  } else invalid();
  if (
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 65535 ||
    width * height > 40000000
  )
    invalid();
  return { width, height };
}

const BASE_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://ais-dev-ldkokintln37a7hyilf5cb-518717919088.europe-west2.run.app",
  "https://ais-pre-ldkokintln37a7hyilf5cb-518717919088.europe-west2.run.app"
];
const TYPES = {
  avatar: { max: 2 * 1024 * 1024 },
  cover: { max: 8 * 1024 * 1024 },
  page: { max: 12 * 1024 * 1024 },
  illustration: { max: 10 * 1024 * 1024 }
};
const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { ...headers, "Cache-Control": "no-store" }
  });
}
function imageType(bytes) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  ) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10]
      .every((n, i) => bytes[i] === n)
  ) return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}
function dimensions(bytes, mime) {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );
  if (mime === "image/png" && bytes.length >= 24) {
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (mime === "image/webp" && bytes.length >= 30) {
    const tag = String.fromCharCode(...bytes.slice(12, 16));
    if (tag === "VP8X") {
      return [
        1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
      ];
    }
    if (
      tag === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return [
        view.getUint16(26, true) & 0x3fff,
        view.getUint16(28, true) & 0x3fff
      ];
    }
    if (tag === "VP8L" && bytes[20] === 0x2f) {
      return [
        1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
        1 + (
          ((bytes[24] & 0x0f) << 10) |
          (bytes[23] << 2) |
          ((bytes[22] & 0xc0) >> 6)
        )
      ];
    }
  }
  if (mime === "image/jpeg") {
    let p = 2;
    while (p + 9 < bytes.length) {
      if (bytes[p] !== 0xff) {
        p++;
        continue;
      }
      const marker = bytes[p + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0xff) {
        p++;
        continue;
      }
      if (
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        p += 2;
        continue;
      }
      const len = view.getUint16(p + 2);
      if (len < 2 || p + 2 + len > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3,
          0xc5, 0xc6, 0xc7,
          0xc9, 0xca, 0xcb,
          0xcd, 0xce, 0xcf
        ].includes(marker)
      ) {
        return [
          view.getUint16(p + 7),
          view.getUint16(p + 5)
        ];
      }
      p += 2 + len;
    }
  }
  return null;
}
async function userFromToken(request, env) {
  const authorization =
    request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  if (!match) {
    return { error: "Unauthorized", status: 401 };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return {
      error: "Authentication not configured",
      status: 503
    };
  }
  try {
    const response = await fetch(
      `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`,
      {
        headers: {
          apikey: env.SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${match[1]}`
        },
        signal: AbortSignal.timeout(8000)
      }
    );
    if (response.status === 401 || response.status === 403) {
      return { error: "Unauthorized", status: 401 };
    }
    if (!response.ok) {
      return {
        error: "Authentication unavailable",
        status: 503
      };
    }
    const user = await response.json();
    if (!user?.id || !/^[0-9a-f-]{36}$/i.test(user.id)) {
      return { error: "Unauthorized", status: 401 };
    }
    return { user };
  } catch {
    return {
      error: "Authentication unavailable",
      status: 503
    };
  }
}
async function handleAgPublicAvatar(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/media/avatar/public/")) {
    return null;
  }
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
    Pragma: "no-cache",
    Expires: "0",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff"
  };
  const fail = (status) =>
    new Response(
      status === 404 ? "Not found" : "Avatar unavailable",
      { status, headers }
    );
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { ...headers, Allow: "GET" }
    });
  }
  const match = url.pathname.match(
    /^\/media\/avatar\/public\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([a-z0-9_-]{1,160}\.(?:jpe?g|png|webp))$/i
  );
  if (!match || url.search) return fail(404);
  const [, owner, file] = match;
  try {
    const key = env.SUPABASE_PUBLISHABLE_KEY;
    let publicKey =
      typeof key === "string" &&
      key.startsWith("sb_publishable_");
    if (!publicKey && typeof key === "string") {
      try {
        const payload = key
          .split(".")[1]
          .replace(/-/g, "+")
          .replace(/_/g, "/");
        publicKey =
          JSON.parse(
            atob(
              payload.padEnd(
                Math.ceil(payload.length / 4) * 4,
                "="
              )
            )
          ).role === "anon";
      } catch {
// Invalid or privileged keys are rejected.
      }
    }
    const base = new URL(env.SUPABASE_URL);
    if (
      !publicKey ||
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !["", "/"].includes(base.pathname)
    ) {
      return fail(503);
    }
    const lookup = new URL("/rest/v1/profiles", base);
    lookup.search = new URLSearchParams({
      select: "id,avatar_url",
      id: `eq.${owner}`,
      limit: "1"
    }).toString();
// Public profile lookup using the anonymous key only.
    const response = await fetch(lookup.href, {
      headers: {
        apikey: key,
        Accept: "application/json"
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "manual"
    });
    if (!response.ok) {
      console.error(
        "AG avatar: Supabase lookup failed",
        response.status
      );
      return fail(503);
    }
    const rows = await response.json();
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      rows[0].id !== owner ||
      typeof rows[0].avatar_url !== "string"
    ) {
      return fail(404);
    }
    const reference = rows[0].avatar_url;
// Only the owner's published avatar is accessible.
    if (
      reference !== `avatars/${owner}/${file}` &&
      reference !== `avatar/${owner}/${file}`
    ) {
      return fail(404);
    }
    const object = await env.AG_MEDIA.get(reference);
    if (
      !object ||
      !object.body ||
      object.size > 2 * 1024 * 1024
    ) {
      return fail(404);
    }
    const type = object.httpMetadata?.contentType
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) {
      return fail(404);
    }
    return new Response(object.body, {
      headers: {
        ...headers,
        "Content-Type": type,
        "Content-Disposition": "inline"
      }
    });
  } catch (error) {
    console.error("AG avatar: unexpected error", error);
    return fail(503);
  }
}
// F4.2-A: add above the EXISTING Worker's export; call BEFORE the existing OPTIONS and
// before global authentication/routing. Do not replace any avatar handlers.
// const coverResponse = await handleAgCoverMedia(request, env);
// if (coverResponse) return coverResponse;
async function handleAgCoverMedia(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/media/cover/")) return null;
  const origins = new Set([
    "https://arquivoglobal.vercel.app",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    ...(env.MEDIA_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ]);
  const origin = request.headers.get("Origin");
  const headers = {
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
  if (origin && origins.has(origin))
    headers["Access-Control-Allow-Origin"] = origin;
  const reply = (message, status = 200) =>
    Response.json({ message }, { status, headers });
  if (origin && !origins.has(origin))
    return reply("Origem não autorizada.", 403);
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
      },
    });
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (url.search) return reply("Rota inválida.", 404);
  const publicMatch = url.pathname.match(
    new RegExp(`^/media/cover/public/(${uuid})/(${uuid})$`, "i"),
  );
  const privateMatch = url.pathname.match(
    new RegExp(`^/media/cover/private/(${uuid})/(${uuid})$`, "i"),
  );
  const uploadMatch = url.pathname.match(
    new RegExp(`^/media/cover/works/(${uuid})$`, "i"),
  );
  const deleteMatch = url.pathname.match(
    new RegExp(`^/media/cover/assets/(${uuid})$`, "i"),
  );
  const cleanup = url.pathname === "/media/cover/cleanup";
  if (!publicMatch && !privateMatch && !uploadMatch && !deleteMatch && !cleanup)
    return reply("Não encontrado.", 404);
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
      return reply("Media indisponível.", 503);
    const key = env.SUPABASE_PUBLISHABLE_KEY;
    let anon = typeof key === "string" && key.startsWith("sb_publishable_"),
      legacy = false;
    if (!anon && typeof key === "string" && key.startsWith("eyJ")) {
      try {
        legacy =
          JSON.parse(
            atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
          ).role === "anon";
      } catch {}
    }
    if (!anon && !legacy) return reply("Media indisponível.", 503);
    const token = request.headers.get("Authorization");
    const http = async (
      path,
      { method = "GET", body, authenticated = true } = {},
    ) => {
      const h = { apikey: key };
      if (authenticated) h.Authorization = token;
      else if (legacy) h.Authorization = `Bearer ${key}`;
      if (body !== undefined) h["Content-Type"] = "application/json";
      const response = await fetcher(new URL(path, base), {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        const e = new Error("Operação de media recusada.");
                e.status = ["23503", "55000"].includes(err?.code)
          ? 409
          : err?.code === "54000"
            ? 413
            : response.status === 401 || response.status === 403
              ? 403
              : 503;
        throw e;
      }
      return response.status === 204 ? null : response.json();
    };
    const writeRpcs = new Set([
      "reserve_cover_upload",
      "list_unused_cover_assets",
      "finish_cover_upload",
      "begin_delete_cover",
      "finish_delete_cover",
    ]);
    const rpc = (name, body) =>
      http(`/rest/v1/rpc/${name}`, {
        method: "POST",
        body: writeRpcs.has(name)
          ? { ...body, p_worker_token: env.COVER_MEDIA_TOKEN }
          : body,
      });
    const keyPattern = new RegExp(
      `^covers/${uuid}/${uuid}/${uuid}\\.(jpg|png|webp)$`,
      "i",
    );
    const deliver = async (objectKey, mime) => {
      if (
        !keyPattern.test(objectKey) ||
        !["image/jpeg", "image/png", "image/webp"].includes(mime)
      )
        return reply("Não encontrado.", 404);
      const object = await env.AG_MEDIA.get(objectKey);
      if (!object || object.httpMetadata?.contentType !== mime)
        return reply("Não encontrado.", 404);
      return new Response(object.body, {
        headers: {
          ...headers,
          "Content-Type": mime,
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    };
    if (publicMatch) {
      if (request.method !== "GET") return reply("Método não permitido.", 405);
      const [_, publicId, assetId] = publicMatch;
      const rows = await http(
        `/rest/v1/published_works?select=cover_image&id=eq.${publicId}&is_public=eq.true`,
        { authenticated: false },
      );
      if (
        !Array.isArray(rows) ||
        rows.length !== 1 ||
        rows[0].cover_image?.assetId?.toLowerCase() !== assetId.toLowerCase()
      )
        return reply("Não encontrado.", 404);
      // Private R2 manifest resolves the storage key without exposing owner/work IDs
      // via a public SQL function or storing any credentials in the browser.
      const index = await env.AG_MEDIA.get(
        `cover-index/${assetId.toLowerCase()}.json`,
      );
      if (!index) return reply("Não encontrado.", 404);
      const record = await index.json();
      if (
        record.assetId !== assetId.toLowerCase() ||
        !record.key.includes(`/${assetId.toLowerCase()}.`)
      )
        return reply("Não encontrado.", 404);
      return deliver(record.key, record.mime);
    }
    if (!token || !/^Bearer \S+$/.test(token))
      return reply("Inicia sessão.", 401);
    const identity = await http("/auth/v1/user");
    if (!identity?.id || !new RegExp(`^${uuid}$`, "i").test(identity.id))
      return reply("Sessão inválida.", 401);
    const owner = identity.id;
    if (
      request.method !== "GET" &&
      (typeof env.COVER_MEDIA_TOKEN !== "string" ||
        env.COVER_MEDIA_TOKEN.length < 32)
    )
      return reply("Serviço de capas por ativar.", 503);
    async function asset(id) {
      const rows = await http(
        `/rest/v1/cover_assets?select=id,owner_id,object_key,mime,state,created_at&id=eq.${id}&owner_id=eq.${owner}`,
      );
      if (!Array.isArray(rows) || rows.length !== 1) return null;
      return rows[0];
    }
    async function ownedWork(id) {
      const rows = await http(
        `/rest/v1/works?select=id,owner_id&id=eq.${id}&owner_id=eq.${owner}`,
      );
      return (
        Array.isArray(rows) &&
        rows.length === 1 &&
        rows[0].id === id &&
        rows[0].owner_id === owner
      );
    }
    async function remove(id) {
      const row = await rpc("begin_delete_cover", { p_asset_id: id });
      if (
        !row ||
        row.owner_id !== owner ||
        !keyPattern.test(row.object_key) ||
        !row.object_key.startsWith(`covers/${owner}/`)
      )
        throw new Error("Referência inválida.");
      await env.AG_MEDIA.delete(row.object_key);
      await env.AG_MEDIA.delete(`cover-index/${id}.json`);
      await rpc("finish_delete_cover", { p_asset_id: id });
    }
    if (privateMatch && request.method === "GET") {
      const [_, workId, id] = privateMatch;
      if (!(await ownedWork(workId))) return reply("Não encontrado.", 404);
      const row = await asset(id);
      if (!row || row.state !== "ready") return reply("Não encontrado.", 404);
      return deliver(row.object_key, row.mime);
    }
    if (deleteMatch && request.method === "DELETE") {
      await remove(deleteMatch[1]);
      return reply("Ficheiro não utilizado eliminado.");
    }
    if (cleanup && request.method === "POST") {
      // Grace period prevents deleting an in-flight upload/edit in another tab.
      // Filter references in SQL before LIMIT: pinned rows cannot starve orphans.
      const rows = await rpc("list_unused_cover_assets", { p_limit: 50 });
      let removed = 0;
      for (const row of rows) {
        try {
          await remove(row.id);
          removed++;
        } catch (e) {
          if (e.status !== 409) throw e;
        }
      }
      return Response.json({ removed }, { headers });
    }
    if (!uploadMatch || request.method !== "POST")
      return reply("Método não permitido.", 405);
    if (!(await ownedWork(uploadMatch[1])))
      return reply("Não encontrado.", 404);
    const mime = request.headers.get("Content-Type");
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime))
      return reply("Escolhe JPEG, PNG ou WebP.", 415);
    const maximum = Math.min(
      5242880,
      Math.max(1, Number(env.MEDIA_MAX_COVER_BYTES) || 5242880),
    );
    if (Number(request.headers.get("Content-Length")) > maximum)
      return reply("Capa demasiado grande.", 413);
    const reader = request.body?.getReader();
    if (!reader) return reply("Imagem vazia.", 400);
    const parts = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        return reply("Capa demasiado grande.", 413);
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    if (!validateCoverBytes(bytes, mime))
      return reply("Imagem inválida ou truncada.", 415);
    const row = await rpc("reserve_cover_upload", {
      p_work_id: uploadMatch[1],
      p_mime: mime,
      p_bytes: length,
    });
    if (
      !row ||
      row.owner_id !== owner ||
      !keyPattern.test(row.object_key) ||
      !row.object_key.startsWith(`covers/${owner}/`)
    )
      return reply("Media indisponível.", 503);
    await env.AG_MEDIA.put(row.object_key, bytes, {
      httpMetadata: { contentType: mime },
    });
    await env.AG_MEDIA.put(
      `cover-index/${row.id}.json`,
      JSON.stringify({ assetId: row.id, key: row.object_key, mime }),
      { httpMetadata: { contentType: "application/json" } },
    );
    await rpc("finish_cover_upload", { p_asset_id: row.id });
    return Response.json({ assetId: row.id }, { status: 201, headers });
  } catch (e) {
    return reply(
      e.status === 409
        ? "A imagem ainda é usada num rascunho ou publicação."
        : e.status === 413
          ? "Limite de armazenamento atingido."
          : "Não foi possível concluir a operação de media. Tenta novamente.",
      e.status || 503,
    );
  }
}
function validateCoverBytes(bytes, mime) {
  const b = bytes,
    n = b.length,
    ascii = (a, z) => String.fromCharCode(...b.slice(a, z));
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const pixels = (w, h) => w > 0 && h > 0 && w * h <= 40000000;
  if (mime === "image/png") {
    if (
      n < 45 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v) ||
      ascii(12, 16) !== "IHDR" ||
      view.getUint32(8) !== 13 ||
      !pixels(view.getUint32(16), view.getUint32(20))
    )
      return false;
    let pos = 8,
      data = false;
    while (pos + 12 <= n) {
      const size = view.getUint32(pos);
      if (size > n - pos - 12) return false;
      const type = ascii(pos + 4, pos + 8);
      if (type === "IDAT" && size > 0) data = true;
      if (type === "IEND") return size === 0 && pos + 12 === n && data;
      pos += size + 12;
    }
    return false;
  }
  if (mime === "image/webp") {
    if (
      n < 20 ||
      ascii(0, 4) !== "RIFF" ||
      ascii(8, 12) !== "WEBP" ||
      view.getUint32(4, true) + 8 !== n
    )
      return false;
    let pos = 12,
      frame = false;
    while (pos + 8 <= n) {
      const type = ascii(pos, pos + 4),
        size = view.getUint32(pos + 4, true),
        start = pos + 8;
      if (size > n - start) return false;
      if (type === "VP8X") {
        if (
          size < 10 ||
          b[start] & 2 ||
          !pixels(
            1 + b[start + 4] + (b[start + 5] << 8) + (b[start + 6] << 16),
            1 + b[start + 7] + (b[start + 8] << 8) + (b[start + 9] << 16),
          )
        )
          return false;
      }
      if (type === "VP8 ") {
        if (
          size < 10 ||
          ascii(start + 3, start + 6) !== "\x9d\x01\x2a" ||
          !pixels(
            view.getUint16(start + 6, true) & 16383,
            view.getUint16(start + 8, true) & 16383,
          )
        )
          return false;
        frame = true;
      }
      if (type === "VP8L") {
        if (size < 5 || b[start] !== 47) return false;
        const bits = view.getUint32(start + 1, true);
        if (!pixels((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1))
          return false;
        frame = true;
      }
      pos = start + size + (size % 2);
    }
    return frame && pos === n;
  }
  if (mime === "image/jpeg") {
    if (
      n < 12 ||
      b[0] !== 255 ||
      b[1] !== 216 ||
      b[n - 2] !== 255 ||
      b[n - 1] !== 217
    )
      return false;
    let i = 2,
      frame = false;
    while (i < n - 2) {
      if (b[i++] !== 255) return false;
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 218) return frame && i + 2 < n;
      if (marker === 217) break;
      if (i + 2 > n) return false;
      const size = (b[i] << 8) | b[i + 1];
      if (size < 2 || i + size > n) return false;
      if ([192, 193, 194].includes(marker)) {
        if (
          size < 8 ||
          ((b[i + 3] << 8) | b[i + 4]) === 0 ||
          ((b[i + 5] << 8) | b[i + 6]) === 0
        )
          return false;
        if (!pixels((b[i + 5] << 8) | b[i + 6], (b[i + 3] << 8) | b[i + 4]))
          return false;
        frame = true;
      }
      i += size;
    }
  }
  return false;
}

export default {
  async fetch(request, env) {

    // F4.2-B: editor visual privado
    const editorialResponse =
      await handleAgEditorialMedia(request, env);
    if (editorialResponse) return editorialResponse;

    const coverResponse = await handleAgCoverMedia(request, env);
    if (coverResponse) return coverResponse;
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = new Set([
      ...BASE_ORIGINS,
      ...(env.ALLOWED_ORIGINS || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
    ]);
    const cors =
      origin && allowed.has(origin)
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods":
              "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers":
              "Authorization, Content-Type, Accept",
            "Access-Control-Max-Age": "86400"
          }
        : {};
    const headers = {
      ...cors,
      Vary: "Origin"
    };
    const respond = (body, status = 200) =>
      json(body, status, headers);
// Public avatar preflight.
    if (
      request.method === "OPTIONS" &&
      url.pathname.startsWith("/media/avatar/public/")
    ) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Accept, Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin"
        }
      });
    }
    if (request.method === "OPTIONS") {
      if (origin && !allowed.has(origin)) {
        return respond({ error: "Origin not allowed" }, 403);
      }
      return new Response(null, {
        status: 204,
        headers
      });
    }
// Public avatar access before origin restrictions.
    const avatarPublicResponse =
      await handleAgPublicAvatar(request, env);
    if (avatarPublicResponse) {
      return avatarPublicResponse;
    }
    if (origin && !allowed.has(origin)) {
      return respond({ error: "Origin not allowed" }, 403);
    }
    if (
      url.pathname === "/health" &&
      request.method === "GET"
    ) {
      return respond({
        status: "ok",
        service: "arquivo-global-api",
        version: "0.5.1"
      });
    }
    if (
      url.pathname === "/health/storage" &&
      request.method === "GET"
          ) {
      if (!env.AG_MEDIA) {
        return respond({
          status: "error",
          storage: "not_configured"
        }, 503);
      }
      try {
        await env.AG_MEDIA.head(
          "__arquivo_global_healthcheck__"
        );
        return respond({
          status: "ok",
          storage: "connected"
        });
      } catch {
        return respond({
          status: "error",
          storage: "unavailable"
        }, 503);
      }
    }
    if (
      url.pathname === "/auth/me" &&
      request.method === "GET"
    ) {
      const auth = await userFromToken(request, env);
      if (auth.error) {
        return respond(
          { error: auth.error },
          auth.status
        );
      }
      return respond({
        authenticated: true,
        user: {
          id: auth.user.id,
          email: auth.user.email ?? null
        }
      });
    }
    if (!env.AG_MEDIA) {
      return respond(
        { error: "Storage unavailable" },
        503
      );
    }
    const upload =
      /^\/media\/(avatar|cover|page|illustration)$/
        .exec(url.pathname);
    if (upload && request.method === "POST") {
      const type = upload[1];
      const auth = await userFromToken(request, env);
      if (auth.error) {
        return respond(
          { error: auth.error },
          auth.status
        );
      }
      const limit = TYPES[type].max;
      const lengthHeader =
        request.headers.get("Content-Length");
      if (
        lengthHeader !== null &&
        Number(lengthHeader) > limit
      ) {
        return respond({ error: "File too large" }, 413);
      }
      const contentType =
        request.headers.get("Content-Type") || "";
      if (!contentType.toLowerCase().startsWith("image/")) {
        return respond(
          { error: "Expected image body" },
          415
        );
      }
      if (!request.body) {
        return respond({ error: "Missing image" }, 400);
      }
      const reader = request.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > limit) {
            await reader.cancel();
            return respond(
              { error: "File too large" },
              413
            );
          }
          chunks.push(value);
        }
      } catch {
        return respond(
          { error: "Unable to read upload" },
          400
        );
      }
      if (!total) {
        return respond({ error: "Empty image" }, 400);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const mime = imageType(bytes);
      if (!mime) {
        return respond(
          { error: "Unsupported image format" },
          415
        );
      }
      const dims = dimensions(bytes, mime);
      if (
        !dims ||
        !dims[0] ||
        !dims[1] ||
        dims[0] > 4096 ||
        dims[1] > 4096
      ) {
        return respond({
          error: "Invalid image dimensions (max 4096x4096)"
        }, 422);
      }
      const id = crypto.randomUUID();
      const folder =
        type === "avatar"
          ? "avatars"
          : `media/${type}`;
      const key =
        `${folder}/${auth.user.id}/` +
        `${id}.${EXTENSIONS[mime]}`;
      try {
        await env.AG_MEDIA.put(key, bytes, {
          httpMetadata: {
            contentType: mime
          },
          customMetadata: {
            ownerId: auth.user.id,
            kind: type
          }
        });
      } catch {
        return respond(
          { error: "Unable to store image" },
          503
        );
      }
      return respond({
        key,
        id,
        kind: type,
        contentType: mime,
        size: total,
        width: dims[0],
        height: dims[1]
      }, 201);
    }
    const object =
      /^\/media\/(avatar|cover|page|illustration)\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp)$/
        .exec(url.pathname);
    if (
      object &&
      (
        request.method === "GET" ||
        request.method === "DELETE"
      )
    ) {
      const [, kind, owner, id, ext] = object;
      const auth = await userFromToken(request, env);
      if (auth.error) {
        return respond(
          { error: auth.error },
          auth.status
        );
      }
      if (auth.user.id !== owner) {
        return respond({ error: "Forbidden" }, 403);
      }
      const folder =
        kind === "avatar"
          ? "avatars"
          : `media/${kind}`;
      const key =
        `${folder}/${owner}/${id}.${ext}`;
      if (request.method === "DELETE") {
        try {
          await env.AG_MEDIA.delete(key);
          return respond({ deleted: true });
        } catch {
          return respond(
            { error: "Unable to delete image" },
            503
          );
        }
      }
      try {
        const objectData = await env.AG_MEDIA.get(key);
        if (!objectData) {
          return respond({ error: "Not Found" }, 404);
        }
        return new Response(objectData.body, {
          headers: {
            ...headers,
            "Content-Type":
              objectData.httpMetadata?.contentType ||
              "application/octet-stream",
            "Cache-Control": "private, max-age=60",
            "X-Content-Type-Options": "nosniff"
          }
        });
      } catch {
        return respond(
          { error: "Unable to load image" },
          503
        );
      }
    }
    return respond({ error: "Not Found" }, 404);
  }
};
