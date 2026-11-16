// In-memory PostgreSQL only. No Supabase/Cloudflare/Vercel connections.
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href),
  db = new PGlite();
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  d = randomUUID(),
  session = new Map([a, b, c, d].map((id) => [id, randomUUID()]));
async function role(id) {
  await db.exec("RESET ROLE;SET ROLE " + (id ? "authenticated" : "anon"));
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [id ?? "", JSON.stringify({ sub: id, session_id: session.get(id) })],
  );
}
const rpc = async (name, args = []) =>
  (
    await db.query(
      `SELECT public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) r`,
      args,
    )
  ).rows[0].r;
const member = (action, data = {}, op = randomUUID()) =>
  rpc("center_member", [action, data, op]);
const admin = async (action, data = {}, op = randomUUID()) => {
  if (
    ["classify_report", "decide_report"].includes(action) &&
    data.revision === undefined
  ) {
    const rows = await rpc("admin_console", ["reports", {}, null]);
    const row = rows.find((r) => r.id === data.id && r.source === data.source);
    data = { ...data, revision: row?.revision, expected_status: row?.status };
  }
  return rpc("admin_console", [action, data, op]);
};
const denied = (fn) =>
  assert.rejects(fn, (e) =>
    ["P0002", "42501", "22023", "23514", "40001", "23505", "54000"].includes(
      e.code,
    ),
  );
try {
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz DEFAULT now());CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT current_setting('request.jwt.claims',true)::jsonb$$;CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users,username text,display_name text);GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;GRANT SELECT ON public.profiles TO anon,authenticated;ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`,
  );
  for (const id of [a, b, c, d]) {
    await db.query("INSERT INTO auth.users(id) VALUES($1)", [id]);
    await db.query("INSERT INTO auth.sessions VALUES($1,$2)", [
      session.get(id),
      id,
    ]);
    await db.query("INSERT INTO public.profiles VALUES($1,$2,'Pessoa')", [
      id,
      id === c ? "arquivo_global" : "member_" + id.slice(0, 8),
    ]);
  }
  for (const f of (await readdir("supabase/migrations"))
    .filter((f) => f >= "20261111000000" && f < "20261116000000")
    .sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  async function makeWork(slug) {
    await role(a);
    let w = (
      await db.query(
        "INSERT INTO public.works(title,slug,description,type,language,age_rating)VALUES('Obra de teste',$1,'Sinopse','Romance','pt','Livre') RETURNING *",
        [slug],
      )
    ).rows[0];
    w = (
      await rpc("mutate_private_work", [
        w.id,
        w.revision,
        "add_entry",
        {},
        randomUUID(),
      ])
    ).work;
    w = (
      await rpc("mutate_private_work", [
        w.id,
        w.revision,
        "save_entry",
        {
          entry_id: w.entries[0].id,
          entry_revision: w.entries[0].revision,
          title: "Capítulo",
          content: "Texto público de teste.",
        },
        randomUUID(),
      ])
    ).work;
    return (
      await rpc("publish_private_work", [
        w.id,
        w.revision,
        "publish",
        randomUUID(),
      ])
    ).work;
  }
  const oldWork = await makeWork("old-analytics");
  await db.exec("RESET ROLE");
  await db.query(
    "INSERT INTO public.social_statistics(publication_id,views,visitors) VALUES($1,123,8)",
    [oldWork.public_id],
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261116000000_notifications_analytics.sql",
      "utf8",
    ),
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM public.author_metric_daily"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM public.notification_outbox"))
      .rows[0].n,
    0,
  );
  const proof = "local-notifications-proof-".repeat(3);
  await db.query(
    "UPDATE public.social_metric_settings SET token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
    [proof],
  );
  await db.exec(
    "UPDATE public.notification_settings SET events_enabled=true,delivery_enabled=true",
  );
  await db.query("INSERT INTO public.social_moderators VALUES($1),($2)", [
    a,
    b,
  ]);
  await db.query(
    "INSERT INTO public.center_administrators(slot,user_id) VALUES(1,$1),(2,$2)",
    [a, b],
  );
  const inbox = (action, data = {}, op = null) =>
    rpc("notification_member", [action, data, op]);
  const write = (action, data = {}, op = randomUUID()) =>
    inbox(action, data, op);
  const analytics = (
    action = "overview",
    work = null,
    before = null,
    period = 30,
  ) => rpc("author_analytics", [action, work, before, period]);
  for (const user of [a, b, c, d]) {
    await role(user);
    const pref = await inbox("preferences");
    assert.equal(pref.likes, false);
    await write("preferences_save", {
      ...pref,
      followers: true,
      likes: true,
      comments: true,
      replies: true,
      authors: true,
      works: true,
      official: true,
    });
  }
  await role(b);
  await rpc("set_author_follow", [a, true]);
  await rpc("set_author_follow", [a, false]);
  await role(c);
  await rpc("set_author_follow", [a, true]);
  let work = await makeWork("notification-work");
  const pub = work.public_id;
  const snapshot = await rpc("read_public_work", [pub]);
  const entry = snapshot.entries[0].id;
  await role(c);
  await rpc("mutate_social", [
    pub,
    null,
    "follow",
    { value: true },
    randomUUID(),
  ]);
  const likeOp = randomUUID();
  await rpc("mutate_social", [pub, null, "like", { value: true }, likeOp]);
  await rpc("mutate_social", [pub, null, "like", { value: true }, likeOp]);
  await rpc("mutate_social", [
    pub,
    entry,
    "like",
    { value: true },
    randomUUID(),
  ]);
  await role(a);
  await rpc("mutate_social", [
    pub,
    null,
    "like",
    { value: true },
    randomUUID(),
  ]); // own like never notifies
  await role(b);
  const parent = (
    await rpc("mutate_social", [
      pub,
      null,
      "comment",
      { body: "Comentário de B" },
      randomUUID(),
    ])
  ).comment_id;
  await role(c);
  const reply = (
    await rpc("mutate_social", [
      pub,
      null,
      "comment",
      { body: "Resposta de C", parent_id: parent },
      randomUUID(),
    ])
  ).comment_id;
  await rpc("mutate_social", [
    pub,
    null,
    "comment_like",
    { comment_id: parent, value: true },
    randomUUID(),
  ]);
  const jobs = async () => {
    await role(null);
    let out;
    for (let i = 0; i < 20; i++) {
      out = await rpc("process_social_jobs", [proof, 100]);
      await db.exec("RESET ROLE");
      const n = (
        await db.query(
          "SELECT count(*)::int n FROM public.notification_outbox WHERE state='pending' AND available_at<=now() ",
        )
      ).rows[0].n;
      await role(null);
      if (!n) return out;
    }
    throw Error("Outbox did not drain");
  };
  await denied(() => rpc("process_social_jobs", ["wrong-proof", 100]));
  await jobs();
  await db.exec("RESET ROLE");
  let failures = (
    await db.query(
      "SELECT id,error_code FROM public.notification_outbox WHERE state='failed' OR attempts>0",
    )
  ).rows;
  assert.deepEqual(failures, []);
  await role(c);
  let notices = await inbox("list");
  assert.equal(notices.filter((n) => n.category === "publications").length, 1);
  assert.ok(notices.every((n) => n.context.profile !== c));
  await role(a);
  const own = await inbox("list");
  assert.ok(own.some((n) => n.category === "followers"));
  assert.ok(own.some((n) => n.category === "likes"));
  assert.ok(own.some((n) => n.category === "comments"));
  assert.ok(!own.some((n) => n.category === "publications"));
  await role(b);
  assert.ok((await inbox("list")).some((n) => n.category === "replies"));
  assert.ok((await inbox("list")).some((n) => n.category === "likes"));
  const countBefore = (await inbox("count")).unread;
  await jobs();
  await role(b);
  assert.equal((await inbox("count")).unread, countBefore);
  await role(a);
  const ownNotice = (await inbox("list"))[0];
  await role(d);
  await denied(() => write("read", { id: ownNotice.id }));
  await denied(() => write("hide", { id: ownNotice.id }));
  await role(a);
  const count = await inbox("count"),
    readOp = randomUUID();
  await write("read_all", { as_of: count.as_of }, readOp);
  await write("read_all", { as_of: count.as_of }, readOp);
  assert.equal((await inbox("count")).unread, 0);
  await write("hide", { id: ownNotice.id });
  assert.ok(!(await inbox("list")).some((n) => n.id === ownNotice.id));
  // Service and optional official notices remain in the same persisted F5.2 inbox.
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT public.center_notify($1,'service','f54-service','Resposta de suporte','Uma resposta real de teste','{}')",
    [a],
  );
  await db.query(
    "SELECT public.center_notify($1,'official','f54-official','Comunicado','Um comunicado de teste','{}')",
    [a],
  );
  await role(a);
  assert.equal((await inbox("list", { filter: "service" })).length, 1);
  assert.equal((await inbox("list", { filter: "official" })).length, 1);
  // Confirmed private edits and technical snapshot fields never emit public updates.
  await db.exec("RESET ROLE");
  const before = (
    await db.query("SELECT count(*)::int n FROM public.notification_outbox")
  ).rows[0].n;
  await db.query(
    "UPDATE public.published_works SET cover_accent_color='#123456' WHERE id=$1",
    [pub],
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM public.notification_outbox"))
      .rows[0].n,
    before,
  );
  await role(a);
  work = (
    await rpc("mutate_private_work", [
      work.id,
      work.revision,
      "save_entry",
      {
        entry_id: work.entries[0].id,
        entry_revision: work.entries[0].revision,
        title: "Capítulo revisto",
        content: "Texto privado ainda não publicado.",
      },
      randomUUID(),
    ])
  ).work;
  await db.exec("RESET ROLE");
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM public.notification_outbox"))
      .rows[0].n,
    before,
  );
  await role(a);
  work = (
    await rpc("publish_private_work", [
      work.id,
      work.revision,
      "publish",
      randomUUID(),
    ])
  ).work;
  await jobs();
  await role(c);
  const updates = await inbox("list", { filter: "publications" });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].group_count, 2); // author + work interests, one delivery/event
  await role(a);
  work = (
    await rpc("mutate_private_work", [
      work.id,
      work.revision,
      "add_entry",
      {},
      randomUUID(),
    ])
  ).work;
  const added = work.entries.at(-1);
  work = (
    await rpc("mutate_private_work", [
      work.id,
      work.revision,
      "save_entry",
      {
        entry_id: added.id,
        entry_revision: added.revision,
        title: "Novo episódio",
        content: "Mais conteúdo público.",
      },
      randomUUID(),
    ])
  ).work;
  work = (
    await rpc("publish_private_work", [
      work.id,
      work.revision,
      "publish",
      randomUUID(),
    ])
  ).work;
  await jobs();
  await role(c);
  assert.equal(
    (await inbox("list", { filter: "publications" }))[0].group_count,
    3,
  );
  assert.match(
    (await inbox("list", { filter: "publications" }))[0].title,
    /Novos capítulos/,
  );
  await role(a);
  work = (
    await rpc("publish_private_work", [
      work.id,
      work.revision,
      "withdraw",
      randomUUID(),
    ])
  ).work;
  await role(c);
  assert.equal((await inbox("list", { filter: "publications" }))[0].path, null);
  await role(a);
  work = (
    await rpc("publish_private_work", [
      work.id,
      work.revision,
      "publish",
      randomUUID(),
    ])
  ).work;
  await jobs();
  await role(c);
  assert.equal(
    (await inbox("list", { filter: "publications" }))[0].group_count,
    3,
  );
  // Preferences suppress pending/new social deliveries; no replay catch-up on later opt-in.
  await role(a);
  let pref = await inbox("preferences");
  await write("preferences_save", { ...pref, likes: false });
  await role(d);
  await rpc("mutate_social", [
    pub,
    null,
    "like",
    { value: true },
    randomUUID(),
  ]);
  await jobs();
  await role(a);
  const likes = (await inbox("list", { filter: "likes" })).reduce(
    (sum, n) => sum + n.group_count,
    0,
  );
  pref = await inbox("preferences");
  await write("preferences_save", { ...pref, likes: true });
  await jobs();
  await role(a);
  assert.equal(
    (await inbox("list", { filter: "likes" })).reduce(
      (sum, n) => sum + n.group_count,
      0,
    ),
    likes,
  );
  // Consent-qualified F5.1 recording remains anonymous and independent from F5.3.
  await role(null);
  const visitor = "a".repeat(64),
    network = "b".repeat(64);
  assert.equal(
    (await rpc("record_social_view", [pub, null, visitor, network, proof]))
      .counted,
    true,
  );
  assert.equal(
    (await rpc("record_social_view", [pub, null, visitor, network, proof]))
      .counted,
    false,
  );
  await rpc("record_social_view", [pub, entry, visitor, network, proof]);
  await role(a);
  let summary = await analytics();
  assert.equal(Number(summary.totals.views), 124);
  assert.equal(Number(summary.totals.reads), 1);
  assert.equal(Number(summary.totals.favorites), 0);
  assert.equal(summary.writer_followers, 1);
  assert.equal(summary.partial_period, true);
  let daily = await analytics("daily");
  assert.equal(
    daily.reduce((n, d) => n + Number(d.views), 0),
    1,
  );
  assert.equal(
    daily.reduce((n, d) => n + Number(d.reads), 0),
    1,
  );
  assert.ok(!JSON.stringify(summary).includes(visitor));
  assert.ok(!JSON.stringify(summary).includes("user_id"));
  await role(c);
  await denied(() => analytics("overview", pub));
  assert.deepEqual(await analytics("works"), []);
  await denied(() => rpc("notification_diagnostics", [null]));
  await role(a);
  const diagnostic = await rpc("notification_diagnostics", [null]);
  assert.equal(diagnostic.failed, 0);
  assert.ok(!JSON.stringify(diagnostic).includes("recipient_id"));
  await role(null);
  await denied(() => inbox("count"));
  await denied(() => analytics());
  // A real 123-recipient fanout is paged without losing or duplicating deliveries.
  await db.exec("RESET ROLE");
  await db.exec("UPDATE public.notification_settings SET events_enabled=false");
  for (let i = 0; i < 122; i++) {
    const user = randomUUID();
    await db.query("INSERT INTO auth.users(id)VALUES($1)", [user]);
    await db.query("INSERT INTO public.profiles VALUES($1,$2,'Leitor')", [
      user,
      "batch_" + i,
    ]);
    await db.query(
      "INSERT INTO public.notification_preferences(user_id,authors,works) VALUES($1,true,true)",
      [user],
    );
    await db.query(
      "INSERT INTO public.profile_follows(follower_id,followed_id) VALUES($1,$2)",
      [user, a],
    );
  }
  await db.exec("UPDATE public.notification_settings SET events_enabled=true");
  const batchWork = await makeWork("batch-notifications");
  await role(null);
  const firstBatch = await rpc("process_social_jobs", [proof, 50]);
  assert.equal(firstBatch.processed, 50);
  await jobs();
  await db.exec("RESET ROLE");
  const batchEvent = (
    await db.query(
      "SELECT id FROM public.notification_outbox WHERE publication_id=$1 AND kind='new_work'",
      [batchWork.public_id],
    )
  ).rows[0];
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM public.notification_receipts WHERE event_id=$1",
        [batchEvent.id],
      )
    ).rows[0].n,
    123,
  );
  // Failed jobs back off safely, can be retried by an authorized administrator, and never expose inbox rows.
  await db.exec("RESET ROLE");
  await db.exec(
    "CREATE FUNCTION public.test_delivery_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.kind='social' THEN RAISE EXCEPTION 'test failure';END IF;RETURN NEW;END$$;CREATE TRIGGER test_delivery_failure BEFORE INSERT ON public.center_notifications FOR EACH ROW EXECUTE FUNCTION public.test_delivery_failure();",
  );
  await role(b);
  await rpc("mutate_social", [
    pub,
    null,
    "like",
    { value: true },
    randomUUID(),
  ]);
  await jobs();
  await db.exec("RESET ROLE");
  assert.ok(
    (
      await db.query(
        "SELECT count(*)::int n FROM public.notification_outbox WHERE attempts=1 AND error_code IS NOT NULL",
      )
    ).rows[0].n > 0,
  );
  await db.exec(
    "DROP TRIGGER test_delivery_failure ON public.center_notifications;DROP FUNCTION public.test_delivery_failure()",
  );
  await db.exec(
    "UPDATE public.notification_outbox SET state='failed' WHERE attempts=1",
  );
  const failed = (
    await db.query(
      "SELECT id FROM public.notification_outbox WHERE state='failed' LIMIT 1",
    )
  ).rows[0].id;
  await role(a);
  await rpc("notification_diagnostics", [failed]);
  await jobs();
  // Deferred events observe only the final committed snapshot, never rolled-back/intermediate states.
  await db.exec("RESET ROLE");
  const transactionBefore = (
    await db.query(
      "SELECT count(*)::int n FROM public.notification_outbox WHERE publication_id=$1",
      [pub],
    )
  ).rows[0].n;
  await db.exec("BEGIN");
  await db.query(
    "UPDATE public.published_works SET description='Não confirmar' WHERE id=$1",
    [pub],
  );
  await db.exec("ROLLBACK");
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM public.notification_outbox WHERE publication_id=$1",
        [pub],
      )
    ).rows[0].n,
    transactionBefore,
  );
  await db.exec("BEGIN");
  await db.query(
    "UPDATE public.published_works SET description='Intermédio' WHERE id=$1",
    [pub],
  );
  await db.query(
    "UPDATE public.published_works SET description='Versão final confirmada' WHERE id=$1",
    [pub],
  );
  await db.exec("COMMIT");
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM public.notification_outbox WHERE publication_id=$1",
        [pub],
      )
    ).rows[0].n,
    transactionBefore + 1,
  );
  // A burst over distinct targets is bounded by the per-recipient daily group quota.
  for (let i = 0; i < 21; i++) {
    const chapterId = randomUUID();
    await db.query(
      "INSERT INTO public.published_work_entries(id,publication_id,title,content,entry_type,position,alignment) VALUES($1,$2,'Capítulo','Texto','chapter',$3,'left')",
      [chapterId, pub, 100 + i],
    );
    await role(c);
    await rpc("mutate_social", [
      pub,
      chapterId,
      "like",
      { value: true },
      randomUUID(),
    ]);
    await db.exec("RESET ROLE");
  }
  await jobs();
  await db.exec("RESET ROLE");
  assert.ok(
    (
      await db.query(
        "SELECT count(*)::int n FROM public.center_notifications WHERE user_id=$1 AND kind='social'",
        [a],
      )
    ).rows[0].n <= 20,
  );
  assert.ok(
    (
      await db.query(
        "SELECT count(*)::int n FROM public.notification_receipts WHERE user_id=$1 AND NOT delivered",
        [a],
      )
    ).rows[0].n > 0,
  );
  // Mark-all uses the latest grouped-event timestamp, not only the original digest date.
  await role(a);
  const cutoffBefore = await inbox("count");
  const grouped = (await inbox("list")).find((n) => n.kind === "social");
  await db.exec("RESET ROLE");
  await db.query(
    "UPDATE public.center_notifications SET read_at=NULL,last_event_at=$2::timestamptz+interval '1 second' WHERE id=$1",
    [grouped.id, cutoffBefore.as_of],
  );
  await role(a);
  await write("read_all", { as_of: cutoffBefore.as_of });
  await db.exec("RESET ROLE");
  assert.equal(
    (
      await db.query(
        "SELECT read_at FROM public.center_notifications WHERE id=$1",
        [grouped.id],
      )
    ).rows[0].read_at,
    null,
  );
  // Direct table/function defaults cannot leak private data or allow invented events.
  await role(c);
  for (const table of [
    "notification_outbox",
    "notification_receipts",
    "notification_manifests",
    "notification_preferences",
    "notification_settings",
    "notification_operations",
    "author_metric_daily",
    "author_follow_daily",
    "author_analytics_rows",
  ])
    await denied(() => db.query("SELECT * FROM public." + table));
  await denied(() =>
    rpc("queue_social_event", [
      "invented",
      "new_work",
      a,
      c,
      a,
      pub,
      null,
      null,
    ]),
  );
  await db.exec("RESET ROLE");
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM pg_proc p,aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace AND p.proname IN('notification_member','process_social_jobs','capture_social_notification','queue_social_event','author_analytics') AND a.grantee=0 AND a.privilege_type='EXECUTE'",
      )
    ).rows[0].n,
    0,
  );
  console.log(
    "PASS F5.4 SQL: transactional events, no self/duplicate/technical/draft notifications; opt-in, batch/replay/backoff; shared official/service inbox; owner-only analytics, anonymous qualified metrics, no fabricated history, RLS/ACL, F5.3 separation.",
  );
} finally {
  await db.close();
}
