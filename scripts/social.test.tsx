import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  createSocialRepository,
  parseSocialState,
  socialError,
} from "../src/foundation/features/social/repository";
import { SocialPanel } from "../src/foundation/features/social/SocialPanel";
import { AuthorFollow } from "../src/foundation/features/social/AuthorFollow";
import { SocialLibrary } from "../src/foundation/features/social/SocialLibrary";
import { createSocialMetricsHandler } from "../server/social-metrics";
Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});
function pinnedClient(client: any) {
  const rpc = client.rpc;
  client.rpc = (...args: any[]) =>
    Object.assign(Promise.resolve(rpc(...args)), {
      setHeader(name: string, value: string) {
        assert.equal(name, "Authorization");
        assert.equal(value, "Bearer fixture");
        return this;
      },
    });
  return client;
}
const id = "10000000-0000-4000-8000-000000000001",
  entry = "20000000-0000-4000-8000-000000000002";
const summary = {
  likes: 0,
  comments: 0,
  followers: 0,
  views: 0,
  visitors: 0,
  liked: false,
  following: false,
  saved: false,
  favorite: false,
  later: false,
  can_moderate: false,
};
test("social: counters are validated and missing backend never becomes invented zeros", () => {
  assert.deepEqual(parseSocialState(summary), summary);
  for (const invalid of [
    null,
    {},
    { ...summary, likes: -1 },
    { ...summary, views: NaN },
    { ...summary, favorite: undefined },
  ])
    assert.throws(() => parseSocialState(invalid), /inválida/);
  assert.match(socialError("PGRST202"), /não estão instaladas/);
  assert.match(socialError("42501"), /sem permissão/);
  assert.match(socialError("54000"), /Aguarda/);
});
test("social repository: protected RPC, explicit desired state, identical operation after lost response; no direct table mutation", async () => {
  const calls: any[] = [],
    counts = new Set();
  let fail = true,
    session = true;
  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: session ? { user: { id }, access_token: "fixture" } : null,
        },
        error: null,
      }),
    },
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "read_social_state") return { data: summary, error: null };
      if (name === "mutate_social") {
        counts.add(args.p_operation);
        if (fail) throw Error("offline");
        return { data: { ok: true }, error: null };
      }
      return { data: [], error: null };
    },
  } as any;
  const repo = createSocialRepository(pinnedClient(client));
  await assert.rejects(
    repo.mutate(id, entry, "like", { value: true }),
    /comunicar/,
  );
  fail = false;
  await repo.mutate(id, entry, "like", { value: true });
  assert.equal(counts.size, 1);
  assert.equal(calls[0].args.p_operation, calls[1].args.p_operation);
  assert.equal(calls[0].args.p_entry, entry);
  await repo.mutate(id, undefined, "favorite", { value: true });
  assert.equal(calls.at(-1).args.p_action, "favorite");
  assert.equal(calls.at(-1).args.p_entry, null);
  await repo.state(id);
  session = false;
  const before = calls.length;
  await assert.rejects(
    repo.mutate(id, undefined, "follow", { value: true }),
    /Inicia sessão/,
  );
  assert.equal(calls.length, before);
});
test("social repository: permission errors are visible and do not become success", async () => {
  const repo = createSocialRepository(
    pinnedClient({
      auth: {
        getSession: async () => ({
          data: { session: { access_token: "fixture" } },
          error: null,
        }),
      },
      rpc: async () => ({
        data: null,
        error: { code: "42501", message: "internal details" },
      }),
    } as any),
  );
  await assert.rejects(
    repo.mutate(id, undefined, "comment", { body: "Teste" }),
    /sem permissão/,
  );
});
test("social rollout: flag off renders no actions or new data queries, existing pages remain usable", () => {
  for (const component of [
    <SocialPanel workId={id} enabled={false} />,
    <AuthorFollow id={id} enabled={false} />,
    <SocialLibrary enabled={false} />,
  ])
    assert.equal(
      renderToStaticMarkup(<MemoryRouter>{component}</MemoryRouter>),
      "",
    );
});
const env = {
  VERCEL: "1",
  SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_disposable_test",
  SOCIAL_METRICS_SECRET: "disposable-local-social-proof-at-least-32-characters",
};
function metricRequest(
  options: {
    cookie?: string;
    origin?: string;
    body?: string;
    method?: string;
    ip?: string;
  } = {},
) {
  return new Request("https://arquivoglobal.vercel.app/api/social-metrics", {
    method: options.method ?? "POST",
    headers: {
      Origin: options.origin ?? "https://arquivoglobal.vercel.app",
      "Content-Type": "application/json",
      "x-vercel-forwarded-for": options.ip ?? "192.0.2.1",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.method === "DELETE"
      ? {}
      : { body: options.body ?? JSON.stringify({ work: id, entry }) }),
  });
}
test("metrics: signed HttpOnly cookie, pseudonyms only, server proof and no public credential response", async () => {
  const sent: any[] = [],
    fetcher: typeof fetch = async (input, init) => {
      assert.equal(
        String(input),
        "https://fixture.supabase.co/rest/v1/rpc/record_social_view",
      );
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ counted: sent.length === 1 });
    };
  const handler = createSocialMetricsHandler(env, fetcher, () => 1800000000000);
  const first = await handler(metricRequest());
  assert.equal(first.status, 200);
  const cookie = first.headers.get("Set-Cookie")!;
  assert.match(cookie, /Secure; HttpOnly; SameSite=Lax/);
  assert.match(first.headers.get("Cache-Control")!, /no-store/);
  const second = await handler(metricRequest({ cookie: cookie.split(";")[0] }));
  assert.equal(second.status, 200);
  assert.equal(sent[0].p_visitor, sent[1].p_visitor);
  assert.equal(sent[0].p_network, sent[1].p_network);
  assert.equal(sent[0].p_proof, env.SOCIAL_METRICS_SECRET);
  assert.ok(!JSON.stringify(sent).includes("192.0.2.1"));
  assert.deepEqual(await second.json(), { counted: false });
  const forged = await handler(
    metricRequest({ cookie: cookie.split(";")[0].replace(/.$/, "Z") }),
  );
  assert.ok(forged.headers.get("Set-Cookie"));
  assert.notEqual(sent[2].p_visitor, sent[0].p_visitor);
  await handler(
    new Request("https://arquivoglobal.vercel.app/api/social-metrics", {
      method: "POST",
      headers: {
        Origin: "https://arquivoglobal.vercel.app",
        "Content-Type": "application/json",
        "x-vercel-forwarded-for": "192.0.2.1",
        Cookie: cookie.split(";")[0],
      },
      body: JSON.stringify({ work: id }),
    }),
  );
  assert.notEqual(
    sent.at(-1).p_visitor,
    sent[0].p_visitor,
    "identifiers cannot correlate different public targets",
  );
  const text = await first.text();
  assert.ok(!text.includes(env.SOCIAL_METRICS_SECRET));
  assert.ok(!text.includes(sent[0].p_visitor));
  const removed = await handler(metricRequest({ method: "DELETE" }));
  assert.equal(removed.status, 204);
  assert.match(removed.headers.get("Set-Cookie")!, /Max-Age=0/);
});
test("metrics: wrong origin, malformed/oversized targets, missing proof/environment and outages fail closed", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw Error("private provider details");
  };
  const handler = createSocialMetricsHandler(env, fetcher);
  assert.equal(
    (await handler(metricRequest({ origin: "https://evil.invalid" }))).status,
    403,
  );
  assert.equal((await handler(metricRequest({ body: "{" }))).status, 400);
  assert.equal(
    (
      await handler(
        metricRequest({ body: JSON.stringify({ work: "private-slug" }) }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await handler(metricRequest({ body: " ".repeat(513) }))).status,
    413,
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await createSocialMetricsHandler(
        { ...env, VERCEL: undefined },
        fetcher,
      )(metricRequest())
    ).status,
    503,
  );
  assert.equal(
    (
      await createSocialMetricsHandler(
        { ...env, SOCIAL_METRICS_SECRET: undefined },
        fetcher,
      )(metricRequest())
    ).status,
    503,
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await createSocialMetricsHandler(
        { ...env, SUPABASE_PUBLISHABLE_KEY: "sb_secret_disallowed" },
        fetcher,
      )(metricRequest())
    ).status,
    503,
  );
  assert.equal(calls, 0);
  const outage = await handler(metricRequest());
  assert.equal(outage.status, 503);
  assert.ok(!(await outage.text()).includes("private provider"));
});

test("social repository: a changed account cannot execute a stale private action", async () => {
  let requests = 0;
  const client = pinnedClient({
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: entry }, access_token: "fixture" } },
        error: null,
      }),
    },
    rpc: async () => {
      requests++;
      return { data: { ok: true }, error: null };
    },
  });
  await assert.rejects(
    createSocialRepository(client, id).mutate(id, undefined, "saved", {
      value: true,
    }),
    /sessão mudou/,
  );
  assert.equal(requests, 0);
});
