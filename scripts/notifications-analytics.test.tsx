import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  createNotificationRepository,
  notificationLink,
  type InboxItem,
} from "../src/foundation/features/notifications/repository";
import { NotificationInbox } from "../src/foundation/features/notifications/Notifications";
import { createNotificationJobsHandler } from "../server/notification-jobs";
Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});
const env = {
  VITE_SUPABASE_URL: "https://fixture.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_disposable_test",
  SOCIAL_METRICS_SECRET: "disposable-server-proof-".repeat(3),
};
function req(token?: string, method = "POST") {
  return new Request("https://arquivo.test/api/notification-jobs", {
    method,
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
}
test("job endpoint denies guests, wrong proof and methods without querying Supabase", async () => {
  let calls = 0;
  const handler = createNotificationJobsHandler(env, async () => {
    calls++;
    return Response.json({});
  });
  for (const r of [req(), req("wrong"), req(env.SOCIAL_METRICS_SECRET, "GET")])
    assert.equal((await handler(r)).status, 404);
  assert.equal(calls, 0);
});
test("job endpoint uses existing proof only server-side and returns sanitized operational counts", async () => {
  let args: any;
  const handler = createNotificationJobsHandler(env, async (url, init) => {
    assert.equal(
      new URL(String(url)).pathname,
      "/rest/v1/rpc/process_social_jobs",
    );
    args = JSON.parse(init!.body as string);
    return Response.json({
      enabled: true,
      processed: 100,
      delivered: 80,
      private_data: "never return",
    });
  });
  const r = await handler(req(env.SOCIAL_METRICS_SECRET));
  assert.equal(r.status, 200);
  assert.equal(args.p_proof, env.SOCIAL_METRICS_SECRET);
  assert.equal(args.p_limit, 100);
  assert.deepEqual(await r.json(), {
    enabled: true,
    processed: 100,
    delivered: 80,
  });
  assert.equal(r.headers.get("Cache-Control"), "no-store");
});
test("disabled delivery is honest and provider failures never reveal secrets", async () => {
  const disabled = createNotificationJobsHandler(env, async () =>
    Response.json({ enabled: false, processed: 0, delivered: 0 }),
  );
  assert.equal(
    (await (await disabled(req(env.SOCIAL_METRICS_SECRET))).json()).enabled,
    false,
  );
  for (const fetcher of [
    async () => {
      throw Error(env.SOCIAL_METRICS_SECRET);
    },
    async () => new Response(env.SOCIAL_METRICS_SECRET, { status: 500 }),
    async () =>
      Response.json({ enabled: true, processed: "invalid", delivered: 0 }),
  ]) {
    const response = await createNotificationJobsHandler(
      env,
      fetcher,
    )(req(env.SOCIAL_METRICS_SECRET));
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes(env.SOCIAL_METRICS_SECRET));
  }
});
test("member transport pins token and refuses a switched account", async () => {
  let owner = "A";
  const calls: any[] = [];
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: owner }, access_token: "current" } },
      }),
    },
    rpc: (name: string, args: any) => ({
      setHeader: async (k: string, v: string) => {
        calls.push({ name, args, k, v });
        return {
          data: { unread: 2, as_of: new Date().toISOString() },
          error: null,
        };
      },
    }),
  };
  const repo = createNotificationRepository("A", client as any);
  await repo.member("count");
  assert.equal(calls[0].v, "Bearer current");
  owner = "B";
  await assert.rejects(() => repo.member("count"), /sessão mudou/);
  assert.equal(calls.length, 1);
});
test("lost member response retries exactly the same operation UUID", async () => {
  const ops: string[] = [];
  let failed = true;
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "A" }, access_token: "current" } },
      }),
    },
    rpc: (name: string, args: any) => ({
      setHeader: async () => {
        ops.push(args.p_operation);
        if (failed) {
          failed = false;
          throw Error("network");
        }
        return { data: { ok: true }, error: null };
      },
    }),
  };
  const repo = createNotificationRepository("A", client as any);
  await assert.rejects(() => repo.member("read", { id: "notice" }, true));
  await repo.member("read", { id: "notice" }, true);
  assert.equal(ops[0], ops[1]);
});
test("context links allow only validated local public/support routes", () => {
  const base = {
    kind: "social",
    context: {},
    path: "https://evil.invalid",
  } as InboxItem;
  assert.equal(notificationLink(base), null);
  assert.equal(notificationLink({ ...base, path: "/admin" }), null);
  assert.equal(
    notificationLink({
      ...base,
      path: "/obras/10000000-0000-4000-8000-000000000001",
    }),
    "/obras/10000000-0000-4000-8000-000000000001",
  );
  assert.equal(
    notificationLink({
      ...base,
      kind: "service",
      context: { ticket_id: "../../admin" },
    }),
    null,
  );
});
test("anonymous inbox requests login, never fabricates unread values", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <NotificationInbox />
    </MemoryRouter>,
  );
  assert.match(html, /Inicia sessão/);
  assert.doesNotMatch(html, /0 não lidas/);
});
test("deployment remains opt-in and no scheduling is claimed active", () => {
  const example = readFileSync(".env.example", "utf8");
  assert.match(example, /VITE_ENABLE_NOTIFICATIONS_ANALYTICS=false/);
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.equal(config.functions["api/notification-jobs.ts"].maxDuration, 30);
  assert.equal(config.crons, undefined);
  const sql = readFileSync(
    "supabase/migrations/20261116000000_notifications_analytics.sql",
    "utf8",
  );
  assert.ok(!/FROM public\.reading_(progress|history|lists)/i.test(sql));
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
});
