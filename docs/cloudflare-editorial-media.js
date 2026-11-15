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
