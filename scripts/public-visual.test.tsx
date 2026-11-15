import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPublicVisualRepository,
  parsePublicVisualBatch,
  publicVisualImageUrl,
  visualStep,
} from "../src/foundation/features/visual/public";
import { createPublicWorksRepository } from "../src/foundation/features/catalog/repository";
import {
  PublicationControls,
  publicationConfirmation,
} from "../src/foundation/features/studio/PublicationControls";
import type { StudioWork } from "../src/foundation/features/studio/types";
const work = "10000000-0000-0000-0000-000000000001",
  entry = "20000000-0000-0000-0000-000000000001",
  page = "30000000-0000-0000-0000-000000000001";
const settings = { format: "manga", mode: "paged", direction: "rtl" };
const proof = "disposable-worker-proof-only-for-local-tests-1234";
const image = new Uint8Array([1, 2, 3]);
const descriptor = {
  object_key: `editorial/${work}/${work}/${entry}/${page}.png`,
  mime: "image/png",
  bytes: 3,
  width: 1,
  height: 1,
};
function fixture() {
  const state = {
    published: true,
    upstream: 200,
    descriptor: { ...descriptor },
    reads: 0,
    requests: [] as any[],
    token: proof,
  };
  const context: any = { URL, Request, Response, Headers, AbortSignal, atob };
  vm.createContext(context);
  vm.runInContext(
    readFileSync("docs/cloudflare-public-visual-media.js", "utf8") +
      "\nglobalThis.handle=handleAgPublicVisualMedia;",
    context,
  );
  const fetcher = async (url: URL, init: RequestInit) => {
    assert.equal(url.pathname, "/rest/v1/rpc/resolve_public_visual_asset");
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    assert.equal(new Headers(init.headers).get("Authorization"), null);
    const body = JSON.parse(init.body as string);
    state.requests.push(body);
    if (body.p_worker_token !== proof)
      return Response.json({}, { status: 403 });
    return Response.json(state.published ? state.descriptor : null, {
      status: state.upstream,
    });
  };
  const env: any = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_disposable_test",
    COVER_MEDIA_TOKEN: proof,
    AG_MEDIA: {
      get: async (key: string) => {
        state.reads++;
        assert.equal(key, state.descriptor.object_key);
        return {
          body: image,
          size: 3,
          httpMetadata: { contentType: "image/png" },
        };
      },
    },
  };
  return {
    state,
    env,
    async get(
      path = `/media/editorial-public/${work}/${entry}/${page}`,
      method = "GET",
      origin = "https://arquivoglobal.vercel.app",
    ) {
      return context.handle(
        new Request("https://worker.example" + path, {
          method,
          headers: {
            Origin: origin,
            Authorization: "Bearer ignored-user-token",
          },
        }),
        env,
        fetcher,
      );
    },
  };
}
test("C Worker: anonymous snapshot resolution uses server proof and streams only matching editorial assets without public caching", async () => {
  const f = fixture();
  const r = await f.get();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal(r.headers.get("Cloudflare-CDN-Cache-Control"), "no-store");
  assert.equal(r.headers.get("Content-Type"), "image/png");
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), image);
  assert.equal(f.state.reads, 1);
  assert.deepEqual(f.state.requests[0], {
    p_public_id: work,
    p_entry_id: entry,
    p_page_id: page,
    p_worker_token: proof,
  });
});
test("C Worker: withdrawal revokes the same URL and does not consult R2; old snapshot IDs resolve only while present", async () => {
  const f = fixture();
  assert.equal((await f.get()).status, 200);
  f.state.published = false;
  assert.equal((await f.get()).status, 404);
  assert.equal(f.state.reads, 1);
});
test("C Worker: fail closed on missing proof/config, Supabase failure, MIME/key namespace or stored size mismatch", async () => {
  for (const setup of [
    (f: any) => {
      f.env.COVER_MEDIA_TOKEN = undefined;
    },
    (f: any) => {
      f.state.upstream = 503;
    },
    (f: any) => {
      f.state.descriptor.mime = "text/html";
    },
    (f: any) => {
      f.state.descriptor.object_key = `avatars/${work}/${page}.png`;
    },
    (f: any) => {
      f.state.descriptor.bytes = 4;
    },
  ]) {
    const f = fixture();
    setup(f);
    const r = await f.get();
    assert.ok([404, 503].includes(r.status));
    assert.ok(!(await r.text()).includes(proof));
  }
});
test("C Worker: distinct public prefix, exact IDs, query/method/CORS rejection and safe preflight preserve private/cover/avatar handlers", async () => {
  const f = fixture();
  for (const path of [
    "/media/avatar",
    "/media/cover/private/" + work + "/" + page,
    "/media/editorial/limits",
  ])
    assert.equal(await f.get(path), null);
  assert.equal(
    (await f.get("/media/editorial-public/raw/editorial/key")).status,
    404,
  );
  assert.equal(
    (
      await f.get(
        `/media/editorial-public/${work}/${entry}/${page}?key=private`,
      )
    ).status,
    404,
  );
  assert.equal((await f.get(undefined, "DELETE")).status, 405);
  assert.equal(
    (await f.get(undefined, "GET", "https://untrusted.example")).status,
    403,
  );
  const pre = await f.get(undefined, "OPTIONS");
  assert.equal(pre.status, 204);
  assert.equal(
    pre.headers.get("access-control-allow-origin"),
    "https://arquivoglobal.vercel.app",
  );
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.requests.length, 0);
});
test("C client: bounded metadata batches strip technical fields and validate dimensions, total and editorial order", () => {
  const good = {
    total: 1,
    items: [
      {
        id: page,
        position: 1,
        width: 600,
        height: 12000,
        asset_id: "private",
        object_key: "private",
        owner_id: "private",
      },
    ],
  };
  const parsed = parsePublicVisualBatch(good, 0)!;
  assert.deepEqual(Object.keys(parsed.items[0]), [
    "id",
    "position",
    "width",
    "height",
  ]);
  assert.equal(parsePublicVisualBatch(null, 0), null);
  for (const x of [
    { ...good, total: 2 },
    { ...good, items: [{ ...good.items[0], position: 2 }] },
    { ...good, items: [{ ...good.items[0], height: 65536 }] },
    { ...good, items: [{ ...good.items[0], id: "not-a-public-id" }] },
  ])
    assert.throws(() => parsePublicVisualBatch(x, 0));
  assert.ok(
    publicVisualImageUrl(work, entry, page).includes(
      "/media/editorial-public/",
    ),
  );
  assert.throws(() => publicVisualImageUrl(work, "../private", page));
  assert.equal(visualStep("ArrowLeft", "rtl"), 1);
  assert.equal(visualStep("ArrowRight", "ltr"), 1);
  assert.equal(visualStep("ArrowLeft", "ltr"), -1);
  assert.equal(visualStep("Enter", "ltr"), 0);
});
test("C client: anonymous paginated RPC does not load private works, request sessions or download images", async () => {
  const calls: any[] = [];
  const client = {
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return {
        data: {
          total: 21,
          items: [{ id: page, position: 21, width: 1, height: 1 }],
        },
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  const repo = createPublicVisualRepository(client);
  assert.equal((await repo.pages(work, entry, 20))!.items.length, 1);
  assert.equal(calls[0].name, "read_public_visual_pages");
  assert.equal(calls[0].args.p_limit, 20);
  assert.equal(calls[0].args.p_offset, 20);
  assert.equal(await repo.pages("private-key", entry, 0), null);
  await assert.rejects(
    createPublicVisualRepository(null).pages(work, entry, 0),
  );
  const bad = {
    rpc: async () => ({ data: null, error: { code: "network" } }),
  } as unknown as SupabaseClient;
  await assert.rejects(
    createPublicVisualRepository(bad).pages(work, entry, 0),
    /ligação/,
  );
});
function row() {
  return {
    id: work,
    title: "HQ",
    type: "HQ / Comic",
    tags: [],
    description: "Sinopse",
    language: "pt",
    age_rating: "Livre",
    content_warnings: [],
    first_published_at: "2026-01-01",
    last_published_at: "2026-01-02",
    visual_settings: settings,
    entries: [
      {
        id: entry,
        title: "Capítulo",
        content: "",
        position: 1,
        entry_type: "visual",
        visual_page_count: 21,
      },
    ],
  };
}
test("C catalog: existing public contract reads optional visual settings/count without new columns in list queries; OFF preserves a disabled marker", async () => {
  const client = {
    rpc: async (name: string) => {
      assert.equal(name, "read_public_work");
      return { data: row(), error: null };
    },
  } as unknown as SupabaseClient;
  const on = await createPublicWorksRepository(client, {
    publicVisualReaderEnabled: true,
  }).find(work);
  assert.equal(on!.visualSettings!.direction, "rtl");
  assert.equal(on!.chapters[0].publicVisualPageCount, 21);
  assert.equal(on!.chapters[0].content, "");
  const off = await createPublicWorksRepository(client, {
    publicVisualReaderEnabled: false,
  }).find(work);
  assert.equal(off!.hasVisualPublication, true);
  assert.equal(off!.visualSettings, undefined);
});
test("C Studio: image-only saved chapter is publishable only with C flag; script stays private and confirmation remains explicit", () => {
  const draft = {
    id: work,
    title: "HQ",
    synopsis: "Sinopse",
    language: "pt",
    chapters: [
      {
        id: entry,
        title: "Capítulo",
        content: "",
        visualPages: [{ id: page }],
      },
    ],
    visualSettings: settings,
    status: "draft",
  } as unknown as StudioWork;
  const off = renderToStaticMarkup(
    <MemoryRouter>
      <PublicationControls
        work={draft}
        dirty={false}
        visualPublicationEnabled={false}
      />
    </MemoryRouter>,
  );
  assert.match(off, /publicação visual aguarda/i);
  assert.doesNotMatch(off, /Preenche título/);
  const on = renderToStaticMarkup(
    <MemoryRouter>
      <PublicationControls
        work={draft}
        dirty={false}
        visualPublicationEnabled
      />
    </MemoryRouter>,
  );
  assert.match(on, /Guiões e notas permanecem privados/);
  assert.ok(!on.includes('disabled=""'));
  assert.match(on, />Publicar<\/button>/);
  const blockedCases: [Partial<StudioWork>, boolean][] = [
    [{ archivedAt: "2026-11-15" }, false],
    [{ chapters: [] }, false],
    [{}, true],
  ];
  for (const [changes, dirty] of blockedCases) {
    const blocked = renderToStaticMarkup(
      <MemoryRouter>
        <PublicationControls
          work={{ ...draft, ...changes }}
          dirty={dirty}
          visualPublicationEnabled
        />
      </MemoryRouter>,
    );
    assert.match(blocked, /disabled=""/);
  }
});

test("C confirmation distinguishes visual snapshots from text and never promises public scripts", () => {
  assert.match(
    publicationConfirmation(true),
    /páginas dos capítulos com imagens guardadas/,
  );
  assert.match(
    publicationConfirmation(true),
    /Guiões e notas permanecem privados/,
  );
  assert.doesNotMatch(publicationConfirmation(true), /apenas o guião textual/);
  assert.match(publicationConfirmation(false), /entradas com texto/);
});
