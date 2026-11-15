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
    .filter((f) => f >= "20261111000000")
    .sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await db.query("INSERT INTO public.social_moderators(user_id) VALUES($1)", [
    b,
  ]);
  const read = (action, data = {}, op = null) =>
    rpc("reading_library", [action, data, op]);
  const write = (action, data = {}, op = randomUUID()) =>
    read(action, data, op);
  await role(a);
  let work = (
    await db.query(
      "INSERT INTO public.works(title,slug,description,type,language,age_rating) VALUES('Leitura privada','reading-test','Sinopse','Romance','pt','Livre') RETURNING *",
    )
  ).rows[0];
  work = (
    await rpc("mutate_private_work", [
      work.id,
      work.revision,
      "add_entry",
      {},
      randomUUID(),
    ])
  ).work;
  work = (
    await rpc("mutate_private_work", [
      work.id,
      work.revision,
      "save_entry",
      {
        entry_id: work.entries[0].id,
        entry_revision: work.entries[0].revision,
        title: "Capítulo um",
        content: "Uma história real para o teste local.",
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
  const pub = work.public_id,
    entry = work.entries[0].public_id;
  const snapshot = await rpc("read_public_work", [pub]);
  const chapter = snapshot.entries[0].id,
    edition = snapshot.last_published_at;
  let settings = await read("settings");
  assert.equal(settings.sync, false);
  assert.equal(settings.history, false);
  let payload = {
    work: pub,
    entry: chapter,
    position: 0.4,
    locator: { kind: "prose", block: 2, offset: 0.3 },
    edition,
    revision: 0,
    generation: 0,
    epoch: settings.epoch,
  };
  await denied(() => write("progress", payload));
  settings = await write("save_settings", {
    sync: true,
    history: true,
    revision: settings.revision,
  });
  payload.epoch = settings.epoch;
  const operation = randomUUID(),
    first = await write("progress", payload, operation);
  assert.equal(first.revision, 1);
  assert.equal(first.position, 0.4);
  assert.deepEqual(await write("progress", payload, operation), first);
  await denied(() => write("progress", { ...payload, position: 0.8 })); // Device B cannot overwrite A's confirmed revision.
  await denied(() =>
    write("progress", { ...payload, position: 0.9 }, operation),
  );
  const second = await write("progress", {
    ...payload,
    revision: 1,
    position: 0.8,
  });
  assert.equal(second.revision, 2);
  assert.equal((await read("history")).length, 1);
  await role(b);
  assert.deepEqual((await read("work", { work: pub })).entries, []);
  assert.deepEqual(await read("history"), []);
  assert.deepEqual(await read("library"), []);
  let bs = await read("settings");
  bs = await write("save_settings", {
    sync: false,
    history: true,
    revision: bs.revision,
  });
  await write("visit", { work: pub, epoch: bs.epoch });
  assert.equal((await read("history")).length, 1);
  assert.deepEqual((await read("work", { work: pub })).entries, []);
  await denied(() => write("progress", { ...payload, epoch: bs.epoch }));
  bs = await write("save_settings", {
    sync: true,
    history: true,
    revision: bs.revision,
  });
  await write("progress", {
    ...payload,
    epoch: bs.epoch,
    position: 0.2,
    user_id: a,
  });
  assert.equal((await read("work", { work: pub })).entries[0].position, 0.2);
  await role(a);
  assert.equal((await read("work", { work: pub })).entries[0].position, 0.8);
  // Distinct chapters never share a revision or locator; all supported locator modes validate.
  for (const kind of ["poetry", "comic", "manga", "webtoon"]) {
    const r = (await read("work", { work: pub })).entries[0];
    await write("progress", {
      ...payload,
      revision: r.revision,
      locator: {
        kind,
        page: 2,
        direction: kind === "manga" ? "rtl" : "ltr",
        vertical: kind === "webtoon",
        offset: 0.25,
      },
    });
  }
  // A second public chapter keeps a completely independent position/revision.
  const secondChapter = randomUUID();
  await db.exec("RESET ROLE");
  await db.query(
    "INSERT INTO public.published_work_entries(id,publication_id,title,content,entry_type,position,alignment) VALUES($1,$2,'Outro capítulo','Texto','chapter',2,'left')",
    [secondChapter, pub],
  );
  await role(a);
  await write("progress", { ...payload, entry: secondChapter, position: 0.65 });
  const chapters = (await read("work", { work: pub })).entries;
  assert.equal(
    chapters.find((r) => r.entry_id === secondChapter).position,
    0.65,
  );
  assert.equal(chapters.find((r) => r.entry_id === chapter).position, 0.4);
  await db.exec("RESET ROLE");
  await db.query("DELETE FROM public.reading_progress WHERE entry_id=$1", [
    secondChapter,
  ]);
  await db.query("DELETE FROM public.reading_history WHERE entry_id=$1", [
    secondChapter,
  ]);
  await role(a);
  const r = (await read("work", { work: pub })).entries[0];
  await denied(() =>
    write("progress", {
      ...payload,
      revision: r.revision,
      locator: { kind: "prose", owner: a },
    }),
  );
  await denied(() =>
    write("progress", {
      ...payload,
      revision: r.revision,
      entry: randomUUID(),
    }),
  );
  await denied(() =>
    write("progress", {
      ...payload,
      revision: r.revision,
      edition: "2000-01-01",
    }),
  );
  await denied(() =>
    write("progress", { ...payload, revision: r.revision, position: 2 }),
  );
  const complete = await write("complete", {
    ...payload,
    revision: r.revision,
    completed: true,
  });
  const resumed = await write("progress", {
    ...payload,
    revision: complete.revision,
    position: 0.1,
  });
  assert.equal(resumed.completed, true);
  const unmarked = await write("complete", {
    ...payload,
    revision: resumed.revision,
    completed: false,
  });
  assert.equal(unmarked.completed, false);
  // Lists remain private even for an existing moderator, and use revision-checked ordered sets.
  let other = (
    await db.query(
      "INSERT INTO public.works(title,slug,description,type,language,age_rating) VALUES('Outra obra','reading-other','Sinopse','Conto','pt','Livre') RETURNING *",
    )
  ).rows[0];
  other = (
    await rpc("mutate_private_work", [
      other.id,
      other.revision,
      "add_entry",
      {},
      randomUUID(),
    ])
  ).work;
  other = (
    await rpc("mutate_private_work", [
      other.id,
      other.revision,
      "save_entry",
      {
        entry_id: other.entries[0].id,
        entry_revision: other.entries[0].revision,
        title: "Entrada",
        content: "Outra história.",
      },
      randomUUID(),
    ])
  ).work;
  other = (
    await rpc("publish_private_work", [
      other.id,
      other.revision,
      "publish",
      randomUUID(),
    ])
  ).work;
  const l1 = await write("save_list", {
    name: "A minha lista",
    description: "Privada",
    items: [pub],
  });
  const l2 = await write("save_list", { name: "Outra lista", items: [pub] });
  assert.equal((await read("lists")).length, 2);
  assert.equal((await read("list", { id: l1.id })).items[0].id, pub);
  await denied(() =>
    write("save_list", {
      id: l1.id,
      revision: l1.revision,
      name: "Duplicados",
      items: [pub, pub],
    }),
  );
  const edited = await write("save_list", {
    id: l1.id,
    revision: l1.revision,
    name: "Renomeada",
    description: "Atualizada",
    items: [other.public_id, pub],
  });
  assert.deepEqual(
    (await read("list", { id: l1.id })).items.map((i) => i.id),
    [other.public_id, pub],
  );
  const reordered = await write("save_list", {
    id: l1.id,
    revision: edited.revision,
    name: "Renomeada",
    items: [pub, other.public_id],
  });
  assert.deepEqual(
    (await read("list", { id: l1.id })).items.map((i) => i.id),
    [pub, other.public_id],
  );
  await denied(() =>
    write("save_list", {
      id: l1.id,
      revision: l1.revision,
      name: "Desatualizada",
    }),
  );
  await role(b);
  await denied(() => read("list", { id: l1.id }));
  await denied(() =>
    write("save_list", {
      id: l1.id,
      revision: edited.revision,
      name: "Intrusão",
    }),
  );
  await denied(() =>
    write("delete_list", { id: l2.id, revision: l2.revision }),
  );
  assert.deepEqual(await read("lists"), []);
  await role(null);
  await denied(() => read("history"));
  await role(a);
  const socialOp = randomUUID();
  await rpc("mutate_social", [
    pub,
    null,
    "favorite",
    { value: true },
    socialOp,
  ]);
  await rpc("mutate_social", [
    pub,
    null,
    "saved",
    { value: true },
    randomUUID(),
  ]);
  const library = await read("library", { filter: "favorite" });
  assert.equal(library.length, 1);
  assert.equal(library[0].favorite, true);
  assert.equal(library[0].saved, true);
  settings = await write("save_settings", {
    sync: true,
    history: false,
    revision: settings.revision,
  });
  const before = (await read("history"))[0].seen_at;
  await write("progress", {
    ...payload,
    revision: unmarked.revision,
    epoch: settings.epoch,
    position: 0.5,
  });
  assert.equal((await read("history"))[0].seen_at, before);
  settings = await write("forget_history", {
    work: pub,
    entry: chapter,
    epoch: settings.epoch,
  });
  assert.deepEqual(await read("history"), []);
  assert.equal((await read("work", { work: pub })).entries.length, 1);
  const priorEpoch = settings.epoch;
  settings = await write("save_settings", {
    sync: false,
    history: false,
    revision: settings.revision,
  });
  await denied(() =>
    write("progress", {
      ...payload,
      epoch: priorEpoch,
      revision: unmarked.revision + 1,
    }),
  );
  settings = await write("save_settings", {
    sync: true,
    history: true,
    revision: settings.revision,
  });
  const old = await read("work", { work: pub });
  await write("clear_work", { work: pub, revision: old.revision });
  assert.deepEqual((await read("work", { work: pub })).entries, []);
  await denied(() =>
    write("progress", { ...payload, epoch: settings.epoch, revision: 0 }),
  ); // pre-clear offline generation cannot resurrect data
  await write("progress", {
    ...payload,
    epoch: settings.epoch,
    generation: old.generation + 1,
    revision: 0,
  });
  settings = await write("clear_history", { epoch: settings.epoch });
  assert.deepEqual(await read("history"), []);
  assert.equal((await read("library", { filter: "favorite" })).length, 1); // Social relationships survived clears.
  // Withdrawal hides all metadata and content; historical opaque references stay private.
  work = (
    await rpc("publish_private_work", [
      work.id,
      work.revision,
      "withdraw",
      randomUUID(),
    ])
  ).work;
  assert.equal((await read("library"))[0].title, null);
  assert.equal((await read("list", { id: l1.id })).items[0].title, null);
  await denied(() =>
    write("progress", { ...payload, epoch: settings.epoch, generation: 1 }),
  );
  work = (
    await rpc("publish_private_work", [
      work.id,
      work.revision,
      "publish",
      randomUUID(),
    ])
  ).work;
  assert.equal(
    (await read("work", { work: pub })).entries[0].current_edition,
    false,
  );
  assert.equal((await read("list", { id: l1.id })).items[0].available, true);
  // Removed chapter cannot be read or synced through a historical reference.
  await db.exec("RESET ROLE");
  await db.query("DELETE FROM public.published_work_entries WHERE id=$1", [
    chapter,
  ]);
  await role(a);
  assert.equal((await read("work", { work: pub })).entries[0].available, false);
  await denied(() =>
    write("progress", { ...payload, epoch: settings.epoch, generation: 1 }),
  );
  await write("delete_list", { id: l2.id, revision: l2.revision });
  assert.equal((await read("lists")).length, 1);
  for (const table of [
    "reading_settings",
    "reading_history",
    "reading_works",
    "reading_progress",
    "reading_lists",
    "reading_list_items",
    "reading_operations",
  ]) {
    await denied(() => db.query("SELECT * FROM public." + table));
    await db.exec("RESET ROLE");
    const acl = await db.query(
      "SELECT has_table_privilege('anon',$1,'SELECT') a,has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE') b",
      ["public." + table],
    );
    assert.equal(acl.rows[0].a, false);
    assert.equal(acl.rows[0].b, false);
    await role(a);
  }
  await db.exec("RESET ROLE");
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid='public.reading_library(text,jsonb,uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'",
      )
    ).rows[0].n,
    0,
  );
  await role(c);
  let rateSettings = await read("settings");
  rateSettings = await write("save_settings", {
    sync: false,
    history: true,
    revision: rateSettings.revision,
  });
  let limited = 0;
  for (let i = 0; i < 60; i++) {
    try {
      await write("visit", { work: pub, epoch: rateSettings.epoch });
    } catch (e) {
      assert.equal(e.code, "54000");
      limited++;
    }
  }
  assert.ok(limited > 0, "server rate limit must reject excess operations");
  console.log(
    "PASS F5.3 SQL: isolated accounts, explicit preferences, two-device revisions, replay, all locators, sticky/manual completion, private lists/concurrency, history controls, clear tombstones, withdrawal/republication, unavailable chapters, preserved F5.1, hostile ACL defaults.",
  );
} finally {
  await db.close();
}
