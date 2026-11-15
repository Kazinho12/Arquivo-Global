import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import {
  TermsPage,
  CopyrightPage,
  AppealsPage,
} from "../src/foundation/pages/Information";
import { createAdminHandler, ADMIN_COOKIE } from "../server/admin";
import AdminPage from "../src/foundation/features/center/AdminPage";
import {
  createCenterRepository,
  createAdminRepository,
  AdminNotFound,
} from "../src/foundation/features/center/repository";
Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});
const a = "10000000-0000-4000-8000-000000000001",
  b = "20000000-0000-4000-8000-000000000002",
  now = 1800000000000;
const token = (id: string) =>
  "eyJhbGciOiJIUzI1NiJ9." +
  Buffer.from(JSON.stringify({ sub: id, exp: now / 1000 + 3600 })).toString(
    "base64url",
  ) +
  ".disposable";
const env = {
  VITE_SUPABASE_URL: "https://fixture.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_disposable_test",
};
function fixture() {
  const state = { active: true, role: true, calls: [] as string[] };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    state.calls.push(url.pathname);
    const access = new Headers(init?.headers).get("Authorization") ?? "";
    const authorized = access === "Bearer " + token(a);
    if (url.pathname === "/auth/v1/user")
      return authorized || access === "Bearer " + token(b)
        ? Response.json({
            id: authorized ? a : b,
            email: "never-return@example.invalid",
          })
        : Response.json({}, { status: 401 });
    if (url.pathname.endsWith("/read_admin_bootstrap"))
      return authorized && state.active && state.role
        ? Response.json({ id: a, authorized: true })
        : Response.json({ code: "P0002" }, { status: 404 });
    if (url.pathname.endsWith("/admin_console")) {
      const body = JSON.parse(String(init?.body));
      assert.ok(!("user_id" in body));
      return Response.json(
        body.p_action === "dashboard" ? { users: 4 } : { ok: true },
      );
    }
    throw Error("unexpected request");
  };
  return {
    state,
    handler: createAdminHandler(
      env,
      fetcher,
      async () =>
        '<html><main id="root">Public application shell</main></html>',
      () => now,
    ),
  };
}
const request = (
  path = "/api/admin",
  method = "POST",
  authorization?: string,
  body: unknown = { action: "dashboard", payload: {} },
) =>
  new Request("https://arquivoglobal.vercel.app" + path, {
    method,
    headers: {
      Origin: "https://arquivoglobal.vercel.app",
      ...(authorization ? { Authorization: "Bearer " + authorization } : {}),
      "Content-Type": "application/json",
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
test("admin HTTP: anonymous/nonadmin receive 404 and never execute a console action", async () => {
  const { state, handler } = fixture();
  assert.equal((await handler(request())).status, 404);
  assert.equal(
    (await handler(request("/api/admin", "POST", token(b)))).status,
    404,
  );
  assert.ok(!state.calls.some((c) => c.endsWith("admin_console")));
});
test("admin HTTP: server validates identity, UUID grant and current session on every request", async () => {
  const { handler, state } = fixture();
  let response = await handler(request("/api/admin", "POST", token(a)));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { users: 4 });
  assert.match(response.headers.get("Cache-Control")!, /no-store/);
  state.active = false;
  assert.equal(
    (await handler(request("/api/admin", "POST", token(a)))).status,
    404,
  );
  state.active = true;
  state.role = false;
  assert.equal(
    (await handler(request("/api/admin", "POST", token(a)))).status,
    404,
  );
});
test("admin HTTP: HttpOnly short-lived cookie gates the shell and never authorizes cross-site mutations", async () => {
  const { handler } = fixture();
  const session = await handler(
    request("/api/admin?resource=session", "POST", token(a)),
  );
  assert.equal(session.status, 204);
  const cookie = session.headers.get("Set-Cookie")!;
  assert.match(cookie, /Max-Age=300; Secure; HttpOnly; SameSite=Strict/);
  const page = await handler(
    new Request("https://arquivoglobal.vercel.app/api/admin?resource=page", {
      headers: { Cookie: cookie.split(";")[0] },
    }),
  );
  assert.equal(page.status, 200);
  assert.match(page.headers.get("X-Robots-Tag")!, /noindex/);
  assert.ok(!(await page.text()).includes("never-return@example.invalid"));
  assert.equal(
    (await handler(request("/api/admin?resource=page", "GET"))).status,
    404,
  );
  const forged = request("/api/admin", "POST", token(a));
  const cross = new Request(forged, {
    headers: {
      ...Object.fromEntries(forged.headers),
      Origin: "https://evil.invalid",
    },
  });
  assert.equal((await handler(cross)).status, 404);
  const deleteCookie = await handler(
    request("/api/admin?resource=session", "DELETE"),
  );
  assert.equal(deleteCookie.status, 204);
  assert.match(deleteCookie.headers.get("Set-Cookie")!, /Max-Age=0/);
});
test("admin HTTP: malformed requests, huge bodies and missing config fail without private details", async () => {
  const { handler } = fixture();
  assert.equal(
    (
      await handler(
        request("/api/admin", "POST", token(a), {
          action: "dashboard",
          payload: [],
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handler(
        request("/api/admin", "POST", token(a), {
          action: "save_item",
          payload: { body: "x".repeat(33000) },
        }),
      )
    ).status,
    413,
  );
  assert.equal(
    (await createAdminHandler({})(request("/api/admin", "POST", token(a))))
      .status,
    404,
  );
  assert.equal(
    (await handler(request("/api/admin?resource=unknown", "POST", token(a))))
      .status,
    404,
  );
});
test("admin: no public navigation link, dedicated rewrite precedes SPA fallback and registry is never inferred from usernames", () => {
  assert.ok(
    !readFileSync("src/foundation/app/layouts.tsx", "utf8").includes(
      'to="/admin"',
    ),
  );
  const cfg = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.ok(
    cfg.rewrites.findIndex((r: any) => r.source === "/admin") <
      cfg.rewrites.length - 1,
  );
  assert.equal(cfg.functions["api/admin.ts"].includeFiles, "dist/index.html");
  const sql = readFileSync(
    "supabase/migrations/20261115040000_administrative_center.sql",
    "utf8",
  );
  assert.ok(sql.includes("auth.sessions"));
  assert.ok(!sql.includes("arquivo_global"));
  assert.ok(!sql.includes("prince_kaio008"));
  assert.ok(sql.includes("slot IN (1,2)"));
});
test("admin: frontend denied state never renders dashboard without a server grant", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
  assert.ok(!html.includes("Centro Administrativo"));
  assert.ok(html.includes("não encontr") || html.includes("404"));
});
test("center repository: pinned JWT, UUID scope, idempotent retry and no fabricated success", async () => {
  let failed = true;
  const calls: any[] = [];
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: a }, access_token: "fixture" } },
        error: null,
      }),
    },
    rpc: (_name: string, args: any) => {
      const promise = (async () => {
        calls.push(args);
        if (failed) throw Error("offline");
        return { data: { ok: true, id: b }, error: null };
      })();
      return Object.assign(promise, {
        setHeader(name: string, value: string) {
          assert.equal(name, "Authorization");
          assert.equal(value, "Bearer fixture");
          return this;
        },
      });
    },
  } as any;
  const repo = createCenterRepository(client, a);
  await assert.rejects(
    repo.member("create_ticket", { title: "Ajuda" }, true),
    /rede/,
  );
  failed = false;
  await repo.member("create_ticket", { title: "Ajuda" }, true);
  assert.equal(calls[0].p_operation, calls[1].p_operation);
  await assert.rejects(
    createCenterRepository(client, b).member("tickets"),
    /sessão mudou/,
  );
});
test("admin repository: lost responses retain operation IDs and 404 revokes the interface", async () => {
  const calls: any[] = [];
  let fail = true;
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: a }, access_token: "fixture" } },
        error: null,
      }),
    },
  } as any;
  const repo = createAdminRepository(client, a, async (_u, init) => {
    calls.push(JSON.parse(String(init?.body)));
    if (fail) throw Error("offline");
    return Response.json({ ok: true });
  });
  await assert.rejects(
    repo.call("create_broadcast", { title: "Teste" }, true),
    /rede/,
  );
  fail = false;
  await repo.call("create_broadcast", { title: "Teste" }, true);
  assert.equal(calls[0].operation, calls[1].operation);
  await assert.rejects(
    createAdminRepository(
      client,
      a,
      async () => new Response(null, { status: 404 }),
    ).call("dashboard"),
    AdminNotFound,
  );
});

test("institutional drafts explicitly require human approval and expose no administrative navigation", () => {
  for (const Page of [TermsPage, CopyrightPage, AppealsPage]) {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );
    assert.match(html, /Minuta para revisão jurídica/);
    assert.match(html, /Não é apresentada como política aprovada/);
    assert.ok(!html.includes('href="/admin"'));
  }
});

test("administrative outage before authorization remains 404 and never discloses provider errors", async () => {
  const handler = createAdminHandler(env, async () => {
    throw Error("private provider detail");
  });
  const response = await handler(request("/api/admin", "POST", token(b)));
  assert.equal(response.status, 404);
  assert.ok(!(await response.text()).includes("private provider"));
});
