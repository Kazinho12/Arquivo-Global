import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectImage } from "../src/foundation/features/visual/image";
import {
  mapLimited,
  readSlot,
  visualMedia,
} from "../src/foundation/features/visual/media";
import {
  moveItem,
  naturalOrder,
  pagePayload,
  readVisualPages,
  defaultVisualSettings,
  VISUAL_LIMITS,
} from "../src/foundation/features/visual/types";
import { createWorksRepository } from "../src/foundation/features/studio/worksRepository";
import { PublicationControls } from "../src/foundation/features/studio/PublicationControls";
import type { StudioWork } from "../src/foundation/features/studio/types";
if (!globalThis.crypto)
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const owner = "10000000-0000-0000-0000-000000000001",
  other = "10000000-0000-0000-0000-000000000002",
  work = "20000000-0000-0000-0000-000000000001",
  entry = "30000000-0000-0000-0000-000000000001",
  entry2 = "30000000-0000-0000-0000-000000000002",
  asset = "40000000-0000-0000-0000-000000000001";
const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgGkAAAAASUVORK5CYII=",
    "base64",
  ),
);
const workerSource = readFileSync("docs/cloudflare-editorial-media.js", "utf8");
function fixture() {
  const assets = new Map<string, any>(),
    objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  const state = {
      refs: [] as { entry: string; asset: string }[],
      failPut: false,
      failFinish: false,
      offline: false,
    },
    calls: { path: string; method: string; headers: Headers }[] = [];
  const sandbox: any = {
    Request,
    Response,
    Headers,
    URL,
    Uint8Array,
    DataView,
    AbortSignal,
    Date,
    atob,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    workerSource +
      "\nglobalThis.handle=handleAgEditorialMedia;globalThis.inspect=inspectAgEditorialImage;",
    sandbox,
  );
  const env = {
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    COVER_MEDIA_TOKEN: "disposable-worker-proof-000000000000000000000",
    AG_MEDIA: {
      async get(key: string) {
        const o = objects.get(key);
        return o
          ? { body: o.bytes, httpMetadata: { contentType: o.mime } }
          : null;
      },
      async put(key: string, bytes: Uint8Array, options: any) {
        objects.set(key, { bytes, mime: options.httpMetadata.contentType });
        if (state.failPut) throw Error("put ack lost");
      },
      async delete(key: string) {
        objects.delete(key);
      },
    },
  };
  let sequence = 0;
  const fetcher = async (input: URL, init: any) => {
    const url = new URL(String(input)),
      h = new Headers(init.headers);
    calls.push({ path: url.pathname, method: init.method, headers: h });
    assert.equal(url.origin, env.SUPABASE_URL);
    assert.equal(init.redirect, "manual");
    assert.equal(h.get("apikey"), env.SUPABASE_PUBLISHABLE_KEY);
    if (state.offline)
      return Response.json(
        { code: "XX000", message: "internal secret" },
        { status: 500 },
      );
    const actor =
      h.get("authorization") === "Bearer owner-token"
        ? owner
        : h.get("authorization") === "Bearer other-token"
          ? other
          : null;
    if (url.pathname === "/auth/v1/user")
      return actor
        ? Response.json({ id: actor })
        : Response.json({}, { status: 401 });
    if (url.pathname === "/rest/v1/work_entries")
      return Response.json(
        actor === owner &&
          url.searchParams.get("work_id") === "eq." + work &&
          [entry, entry2].some((e) => "eq." + e === url.searchParams.get("id"))
          ? [
              {
                id: url.searchParams.get("id")!.slice(3),
                work_id: work,
                entry_type: "visual",
              },
            ]
          : [],
      );
    if (url.pathname === "/rest/v1/editorial_assets") {
      const row = assets.get(url.searchParams.get("id")?.slice(3) ?? "");
      return Response.json(row?.owner_id === actor ? [row] : []);
    }
    if (url.pathname === "/rest/v1/visual_pages")
      return Response.json(
        actor === owner
          ? state.refs
              .filter(
                (r) =>
                  "eq." + r.entry === url.searchParams.get("entry_id") &&
                  "eq." + r.asset === url.searchParams.get("asset_id"),
              )
              .map(() => ({ id: "ref" }))
          : [],
      );
    const name = url.pathname.split("/").at(-1),
      body = JSON.parse(init.body || "{}");
    if (name === "visual_editor_limits") return Response.json(VISUAL_LIMITS);
    assert.equal(body.p_worker_token, env.COVER_MEDIA_TOKEN);
    if (name === "reserve_editorial_upload") {
      const id = `40000000-0000-0000-0000-${String(++sequence).padStart(12, "0")}`;
      const row = {
        id,
        owner_id: actor,
        work_id: body.p_work_id,
        entry_id: body.p_entry_id,
        filename: body.p_filename,
        mime: body.p_mime,
        bytes: body.p_bytes,
        width: body.p_width,
        height: body.p_height,
        state: "pending",
        object_key: `editorial/${actor}/${body.p_work_id}/${body.p_entry_id}/${id}.png`,
      };
      assets.set(id, row);
      return Response.json(row);
    }
    if (name === "list_unused_editorial_assets")
      return Response.json(
        [...assets.values()]
          .filter(
            (a) =>
              a.owner_id === actor &&
              a.state !== "deleted" &&
              !state.refs.some((r) => r.asset === a.id),
          )
          .slice(0, 50)
          .map((a) => ({ id: a.id })),
      );
    const row = assets.get(body.p_asset_id);
    if (!row || row.owner_id !== actor)
      return Response.json({ code: "42501" }, { status: 403 });
    if (name === "finish_editorial_upload") {
      if (state.failFinish) return Response.json({}, { status: 500 });
      row.state = "ready";
      return Response.json(row);
    }
    if (name === "begin_delete_editorial") {
      if (state.refs.some((r) => r.asset === row.id))
        return Response.json({ code: "23503" }, { status: 400 });
      row.state = "deleting";
      return Response.json(row);
    }
    if (name === "finish_delete_editorial") {
      row.state = "deleted";
      return Response.json(null);
    }
    throw Error("Unexpected route " + name);
  };
  const request = (
    path: string,
    method = "GET",
    bytes?: Uint8Array,
    token: string | null = "owner-token",
    type = "image/png",
    origin = "https://arquivoglobal.vercel.app",
  ) =>
    sandbox.handle(
      new Request("https://worker.example" + path, {
        method,
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          "Content-Type": type,
          "X-File-Name": encodeURIComponent("página 02.png"),
          Origin: origin,
        },
        ...(bytes ? { body: bytes } : {}),
      }),
      env,
      fetcher,
    );
  return {
    state,
    assets,
    objects,
    calls,
    env,
    request,
    inspect: sandbox.inspect,
  };
}
test("visual Worker: raw multi-image uploads return trusted metadata, not keys; private reads require ownership and association", async () => {
  const f = fixture();
  const r = await f.request(
    `/media/editorial/works/${work}/entries/${entry}`,
    "POST",
    png,
  );
  assert.equal(r.status, 201);
  const image = await r.json();
  assert.equal(image.filename, "página 02.png");
  assert.equal(image.width, 1);
  assert.equal(image.bytes, png.length);
  assert.ok(!("object_key" in image));
  const path = `/media/editorial/private/${work}/${entry}/${image.id}`;
  assert.equal((await f.request(path)).status, 200);
  assert.equal((await f.request(path, "GET", undefined, null)).status, 401);
  assert.equal(
    (await f.request(path, "GET", undefined, "other-token")).status,
    404,
  );
  assert.equal(
    (await f.request(`/media/editorial/private/${work}/${entry2}/${image.id}`))
      .status,
    404,
  );
  f.state.refs.push({ entry: entry2, asset: image.id });
  assert.equal(
    (await f.request(`/media/editorial/private/${work}/${entry2}/${image.id}`))
      .status,
    200,
  );
  assert.equal(
    (await f.request("/media/editorial/assets/" + image.id, "DELETE")).status,
    409,
  );
  f.state.refs = [];
  assert.equal(
    (await f.request("/media/editorial/assets/" + image.id, "DELETE")).status,
    200,
  );
  assert.equal(
    (await f.request("/media/editorial/assets/" + image.id, "DELETE")).status,
    200,
  );
  assert.equal(f.objects.size, 0);
});
test("visual Worker: no public, raw-key or generic legacy page routes; CORS/auth and internal proof fail closed", async () => {
  const f = fixture();
  for (const path of [
    `/media/editorial/public/${work}/${asset}`,
    `/media/editorial/editorial/${owner}/${work}/${entry}/${asset}.png`,
  ])
    assert.equal((await f.request(path, "GET", undefined, null)).status, 404);
  assert.equal(await f.request("/media/avatar/public/anything"), null);
  assert.equal(await f.request("/media/cover/anything"), null);
  assert.equal(
    (
      await f.request(
        `/media/editorial/works/${work}/entries/${entry}`,
        "POST",
        png,
        "other-token",
      )
    ).status,
    404,
  );
  assert.equal(
    (await f.request("/media/editorial/limits", "GET", undefined, null)).status,
    401,
  );
  assert.equal(
    (
      await f.request(
        "/media/editorial/limits",
        "GET",
        undefined,
        "owner-token",
        "image/png",
        "https://evil.test",
      )
    ).status,
    403,
  );
  const options = await f.request(
    "/media/editorial/limits",
    "OPTIONS",
    undefined,
    null,
  );
  assert.equal(options.status, 204);
  assert.ok(
    options.headers.get("Access-Control-Allow-Headers").includes("X-File-Name"),
  );
  (f.env as any).COVER_MEDIA_TOKEN = undefined;
  assert.equal(
    (
      await f.request(
        `/media/editorial/works/${work}/entries/${entry}`,
        "POST",
        png,
      )
    ).status,
    503,
  );
  assert.equal(f.objects.size, 0);
});
test("visual Worker: interrupted R2/metadata writes do not announce success; cleanup retries only unreferenced assets", async () => {
  const f = fixture();
  f.state.failFinish = true;
  assert.equal(
    (
      await f.request(
        `/media/editorial/works/${work}/entries/${entry}`,
        "POST",
        png,
      )
    ).status,
    503,
  );
  const row = [...f.assets.values()][0];
  assert.equal(row.state, "pending");
  assert.equal(f.objects.size, 1);
  f.state.failFinish = false;
  assert.equal(
    (await (await f.request("/media/editorial/cleanup", "POST")).json())
      .removed,
    1,
  );
  assert.equal(f.objects.size, 0);
  const saved = await (
    await f.request(
      `/media/editorial/works/${work}/entries/${entry}`,
      "POST",
      png,
    )
  ).json();
  f.state.refs = [{ entry, asset: saved.id }];
  assert.equal(
    (await (await f.request("/media/editorial/cleanup", "POST")).json())
      .removed,
    0,
  );
  f.state.offline = true;
  const failed = await f.request("/media/editorial/limits");
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes("internal secret"));
});
test("visual images: frontend and Worker agree on structures, long-page dimensions, MIME spoofing and bounds", () => {
  const f = fixture();
  assert.deepEqual(inspectImage(png, "image/png"), { width: 1, height: 1 });
  assert.equal(
    JSON.stringify(f.inspect(png, "image/png")),
    JSON.stringify(inspectImage(png, "image/png")),
  );
  const long = png.slice();
  new DataView(long.buffer).setUint32(16, 600);
  new DataView(long.buffer).setUint32(20, 60000);
  assert.deepEqual(inspectImage(long, "image/png"), {
    width: 600,
    height: 60000,
  });
  assert.equal(f.inspect(long, "image/png").height, 60000);
  const tooLong = long.slice();
  new DataView(tooLong.buffer).setUint32(20, 65536);
  assert.throws(() => inspectImage(tooLong, "image/png"));
  assert.throws(() => f.inspect(tooLong, "image/png"));
  for (const [bytes, mime] of [
    [png.slice(0, 30), "image/png"],
    [png, "image/jpeg"],
    [new Uint8Array(20971521), "image/png"],
  ] as const) {
    assert.throws(() => inspectImage(bytes, mime));
    assert.throws(() => f.inspect(bytes, mime));
  }
});
test("visual limits are independent of covers and enforced on streamed requests", async () => {
  assert.equal(VISUAL_LIMITS.bytes, 20971520);
  const f = fixture();
  assert.equal(
    (
      await f.request(
        `/media/editorial/works/${work}/entries/${entry}`,
        "POST",
        new Uint8Array(20971521),
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await f.request(
        `/media/editorial/works/${work}/entries/${entry}`,
        "POST",
        png,
        "owner-token",
        "image/svg+xml",
      )
    ).status,
    415,
  );
  assert.equal(
    (await (await f.request("/media/editorial/limits")).json()).pages,
    1000,
  );
});
test("bounded upload pool preserves selection order despite completion order and retries only failures", async () => {
  const order = [3, 1, 2, 4],
    result = new Map<number, string>();
  let active = 0,
    max = 0;
  async function run(ids: number[], fail: boolean) {
    await mapLimited(ids, 2, async (n) => {
      active++;
      max = Math.max(max, active);
      try {
        await new Promise((r) => setTimeout(r, n === 3 ? 12 : 2));
        if (fail && n === 1) throw Error("offline");
        result.set(n, "uploaded");
      } catch {
        result.set(n, "error");
      } finally {
        active--;
      }
    });
  }
  await run(order, true);
  assert.equal(max, 2);
  assert.deepEqual(order, [3, 1, 2, 4]);
  assert.equal(result.get(1), "error");
  const retry = order.filter((n) => result.get(n) === "error");
  assert.deepEqual(retry, [1]);
  await run(retry, false);
  assert.ok([...result.values()].every((v) => v === "uploaded"));
  const signal = new AbortController();
  let started = 0;
  await mapLimited(
    [1, 2, 3, 4],
    2,
    async () => {
      started++;
      signal.abort();
    },
    signal.signal,
  );
  assert.equal(started, 1);
});
test("private image-read queue never exceeds two downloads and skips cancelled queued requests", async () => {
  let active = 0,
    max = 0,
    started = 0;
  const a = new AbortController(),
    b = new AbortController();
  const job = async () => {
    started++;
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 8));
    active--;
    return 1;
  };
  const first = [readSlot(job, a.signal), readSlot(job, a.signal)],
    cancelled = readSlot(job, b.signal).catch(() => 0);
  b.abort();
  await Promise.all([...first, cancelled]);
  assert.equal(max, 2);
  assert.equal(started, 2);
});
test("page order is independent of RTL and natural name ordering is explicit; uploaded assets are required for save", () => {
  const rows = ["10.png", "2.png", "1.png"].map((name, i) => ({
    id: String(i),
    name,
    status: "saved" as const,
    width: 1,
    height: 1,
    bytes: 1,
    asset: {
      id: asset,
      filename: name,
      mime: "image/png",
      bytes: 1,
      width: 1,
      height: 1,
    },
  }));
  assert.deepEqual(
    rows.map((r) => r.name),
    ["10.png", "2.png", "1.png"],
  );
  assert.deepEqual(
    naturalOrder(rows).map((r) => r.name),
    ["1.png", "2.png", "10.png"],
  );
  assert.deepEqual(
    moveItem(rows, 2, 0).map((r) => r.name),
    ["1.png", "10.png", "2.png"],
  );
  assert.equal(defaultVisualSettings("Mangá").direction, "rtl");
  assert.equal(pagePayload(rows)[0].id, "0");
  assert.throws(() => pagePayload([{ ...rows[0], status: "error" }]));
  assert.deepEqual(readVisualPages(undefined), []);
});
test("visual client pins sessions, sends raw bytes and rejects missing sessions or account changes", async () => {
  const file = Object.assign(new Blob([png], { type: "image/png" }), {
    name: "página 2.png",
  }) as File;
  const missing = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  } as unknown as SupabaseClient;
  await assert.rejects(
    visualMedia(owner, missing, async () =>
      assert.fail("No network expected"),
    ).upload(work, entry, file),
  );
  let calls = 0;
  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: ++calls === 1 ? owner : other },
            access_token: "owner-token",
          },
        },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
  await assert.rejects(
    visualMedia(owner, client, async (input, init) => {
      assert.equal(
        new URL(String(input)).pathname,
        `/media/editorial/works/${work}/entries/${entry}`,
      );
      assert.equal(init?.body, file);
      assert.equal(
        new Headers(init?.headers).get("X-File-Name"),
        encodeURIComponent(file.name),
      );
      assert.equal(init?.credentials, "omit");
      return Response.json({
        id: asset,
        filename: file.name,
        mime: file.type,
        bytes: png.length,
        width: 1,
        height: 1,
      });
    }).upload(work, entry, file),
  );
});
function row() {
  return {
    id: work,
    owner_id: owner,
    title: "Legado",
    slug: "legado",
    description: "Sinopse",
    type: "Mangá",
    status: "draft",
    visibility: "private",
    language: "pt",
    genre: "",
    tags: [],
    content_warnings: [],
    age_rating: "Livre",
    cover_accent_color: "#14243B",
    revision: 4,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    visual_settings: { format: "manga", mode: "paged", direction: "rtl" },
    entries: [
      {
        id: entry,
        title: "Ato antigo",
        content: "Guião antigo",
        position: 1,
        entry_type: "visual",
        revision: 2,
        visual_pages: [
          {
            id: "50000000-0000-0000-0000-000000000001",
            asset_id: asset,
            filename: "1.png",
            bytes: 67,
            mime: "image/png",
            width: 1,
            height: 1,
            position: 1,
          },
        ],
      },
    ],
  };
}
test("repository save/reload uses both revisions and reuses operation ID after a lost response; default-off never calls the new RPC", async () => {
  const operations: any[] = [];
  let fail = true;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: owner } }, error: null }),
      getSession: async () => ({
        data: { session: { access_token: "owner-token", user: { id: owner } } },
        error: null,
      }),
    },
    rpc: (name: string, payload: any) => ({
      setHeader: async (header: string, value: string) => {
        assert.equal(value, "Bearer owner-token");
        if (name === "read_private_work") return { data: row(), error: null };
        assert.equal(name, "save_visual_chapter");
        operations.push(payload);
        if (fail) {
          fail = false;
          return { data: null, error: { code: "XX000" } };
        }
        return { data: { work: row() }, error: null };
      },
    }),
  } as unknown as SupabaseClient;
  const repo = createWorksRepository(client, owner, {
    visualEditorEnabled: true,
  });
  const w = await repo.find(work);
  assert.equal(w!.chapters[0].visualPages!.length, 1);
  assert.equal(w!.chapters[0].content, "Guião antigo");
  const input = {
    title: "Ato antigo",
    script: "Guião antigo",
    settings: defaultVisualSettings("Mangá"),
    pages: [{ id: "50000000-0000-0000-0000-000000000001", assetId: asset }],
  };
  await assert.rejects(repo.saveVisual!(w!, entry, 2, input));
  const saved = await repo.saveVisual!(w!, entry, 2, input);
  assert.equal(saved.visualSettings!.direction, "rtl");
  assert.equal(operations[0].p_operation_id, operations[1].p_operation_id);
  assert.equal(operations[1].p_revision, 4);
  assert.equal(operations[1].p_entry_revision, 2);
  const old = createWorksRepository(client, owner, {
    visualEditorEnabled: false,
  });
  await assert.rejects(old.saveVisual!(w!, entry, 2, input));
  assert.equal(operations.length, 2);
});
test("publication UI blocks visual publication with the reader flag off and preserves private scripts", () => {
  const visual = {
    ...row(),
    id: work,
    format: "Mangá",
    mode: "manga",
    synopsis: "Sinopse",
    ownerId: owner,
    coverAccentColor: "#14243B",
    contentWarnings: [],
    ageRating: "Livre",
    chapters: [
      { id: entry, number: 1, title: "Ato antigo", content: "Guião antigo" },
    ],
    visualSettings: defaultVisualSettings("Mangá"),
  } as unknown as StudioWork;
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <PublicationControls
        work={visual}
        dirty={false}
        visualPublicationEnabled={false}
      />
    </MemoryRouter>,
  );
  assert.match(html, /publicação visual aguarda ativação e validação/);
  assert.match(html, /Guiões e notas permanecem privados/);
  assert.doesNotMatch(html, /apenas o guião textual/);
  assert.ok(html.includes("disabled"));
  assert.ok(!html.includes("imagens publicadas com sucesso"));
});
