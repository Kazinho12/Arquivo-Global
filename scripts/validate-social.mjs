// Disposable in-memory PostgreSQL only; no remote connection, credentials or R2.
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href),
  db = new PGlite();
const a = randomUUID(),
  b = randomUUID(),
  mod = randomUUID(),
  proof = "local-social-metrics-proof-disposable-12345678";
const rpc = async (name, args = []) =>
  (
    await db.query(
      `SELECT public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) AS result`,
      args,
    )
  ).rows[0].result;
async function role(id) {
  await db.exec("RESET ROLE;SET ROLE " + (id ? "authenticated" : "anon"));
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    id ?? "",
  ]);
}
const mutate = async (w, e, action, payload = {}, operation = randomUUID()) =>
  rpc("mutate_social", [w, e, action, payload, operation]);
const editorial = async (w, action, payload = {}) =>
  (
    await rpc("mutate_private_work", [
      w.id,
      w.revision,
      action,
      payload,
      randomUUID(),
    ])
  ).work;
const publish = async (w, action = "publish") =>
  (await rpc("publish_private_work", [w.id, w.revision, action, randomUUID()]))
    .work;
const denied = async (fn) =>
  assert.rejects(fn, (e) =>
    ["42501", "22023", "54000", "23505", "23514"].includes(e.code),
  );
try {
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users,username text,display_name text);GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;GRANT SELECT ON public.profiles TO anon,authenticated;ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`,
  );
  for (const id of [a, b, mod]) {
    await db.query("INSERT INTO auth.users VALUES($1)", [id]);
    await db.query("INSERT INTO public.profiles VALUES($1,$2,'Autora')", [
      id,
      id,
    ]);
  }
  for (const f of (await readdir("supabase/migrations"))
    .filter((f) => f >= "20261111000000" && f < "20261115020000")
    .sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await role(a);
  let w = (
    await db.query(
      "INSERT INTO public.works(title,slug,description,type,language,age_rating) VALUES('Obra social','obra-social','Sinopse','Romance','pt','Livre') RETURNING *",
    )
  ).rows[0];
  w = await editorial(w, "add_entry");
  w = await editorial(w, "save_entry", {
    entry_id: w.entries[0].id,
    entry_revision: w.entries[0].revision,
    title: "Capítulo",
    content: "Texto real de teste",
  });
  w = await publish(w);
  const snapshot = await rpc("read_public_work", [w.public_id]);
  await db.exec("RESET ROLE");
  await db.exec(
    await readFile(
      "supabase/migrations/20261115020000_social_integrated.sql",
      "utf8",
    ),
  );
  await db.query("INSERT INTO public.social_moderators VALUES($1)", [mod]);
  await db.query("UPDATE public.social_metric_settings SET token_hash=$1", [
    createHash("sha256").update(proof).digest("hex"),
  ]);
  const wid = w.public_id,
    eid = snapshot.entries[0].id;
  await role(null);
  assert.equal(
    (await rpc("read_public_work", [wid])).entries[0].content,
    snapshot.entries[0].content,
  );
  assert.equal((await rpc("read_social_state", [wid, eid])).likes, 0);
  for (const table of [
    "social_likes",
    "social_comments",
    "social_library",
    "social_reports",
    "social_statistics",
    "social_metric_visitors",
    "social_metric_settings",
    "social_operations",
    "social_moderators",
  ])
    await denied(() => db.query(`SELECT * FROM public.${table}`));
  await denied(() => rpc("social_assert_target", [wid, null]));
  await denied(() => mutate(wid, null, "like", { value: true }));
  await denied(() => rpc("read_social_state", [w.id, null]));
  await denied(() => rpc("read_social_state", [wid, randomUUID()]));
  await role(a);
  const op = randomUUID();
  await mutate(wid, null, "like", { value: true }, op);
  await mutate(wid, null, "like", { value: true }, op);
  await mutate(wid, null, "like", { value: true });
  assert.equal((await rpc("read_social_state", [wid, null])).likes, 1);
  await denied(() => mutate(wid, null, "like", { value: false }, op));
  await mutate(wid, eid, "like", { value: true });
  assert.equal((await rpc("read_social_state", [wid, eid])).likes, 1);
  await mutate(wid, null, "favorite", { value: true });
  let s = await rpc("read_social_state", [wid, null]);
  assert.equal(s.favorite, true);
  assert.equal(s.saved, false);
  await mutate(wid, null, "saved", { value: true });
  await mutate(wid, null, "later", { value: true });
  await mutate(wid, null, "follow", { value: true });
  await mutate(wid, null, "follow", { value: true });
  assert.equal((await rpc("read_social_state", [wid, null])).followers, 1);
  assert.equal((await rpc("read_social_library", [null, null, 24])).length, 1);
  await denied(() => rpc("set_author_follow", [a, true]));
  await rpc("set_author_follow", [b, true]);
  await rpc("set_author_follow", [b, true]);
  assert.equal((await rpc("read_author_follow", [b])).followers, 1);
  await rpc("set_author_follow", [b, false]);
  assert.equal((await rpc("read_author_follow", [b])).followers, 0);
  const commentOp = randomUUID(),
    comment = (
      await mutate(
        wid,
        null,
        "comment",
        { body: "Primeiro comentário" },
        commentOp,
      )
    ).comment_id;
  assert.equal(
    (
      await mutate(
        wid,
        null,
        "comment",
        { body: "Primeiro comentário" },
        commentOp,
      )
    ).comment_id,
    comment,
  );
  await denied(() => mutate(wid, null, "comment", { body: "spam rápido" }));
  await denied(() => mutate(wid, null, "comment", { body: "\n \t" }));
  await mutate(wid, null, "edit_comment", {
    comment_id: comment,
    body: "Comentário editado",
  });
  assert.equal(
    (await rpc("read_social_comments", [wid, null, null, null, 20]))[0].body,
    "Comentário editado",
  );
  await role(b);
  assert.equal((await rpc("read_social_state", [wid, null])).liked, false);
  assert.deepEqual(await rpc("read_social_library", [null, null, 24]), []);
  await denied(() =>
    mutate(wid, null, "edit_comment", { comment_id: comment, body: "Roubo" }),
  );
  await denied(() =>
    mutate(wid, null, "delete_comment", { comment_id: comment }),
  );
  await denied(() => mutate(wid, null, "hide", { comment_id: comment }));
  await denied(() => rpc("read_social_reports", []));
  const reply = (
    await mutate(wid, null, "comment", { body: "Resposta", parent_id: comment })
  ).comment_id;
  await mutate(wid, null, "comment_like", { comment_id: comment, value: true });
  await mutate(wid, null, "comment_like", { comment_id: comment, value: true });
  await mutate(wid, null, "report", {
    comment_id: comment,
    reason: "Motivo descartável",
  });
  await mutate(wid, null, "report", {
    comment_id: comment,
    reason: "Motivo descartável",
  });
  await role(null);
  let comments = await rpc("read_social_comments", [wid, null, null, null, 20]);
  assert.equal(comments.find((c) => c.id === comment).likes, 1);
  assert.ok(
    comments.every((c) => !("user_id" in c) && !("publication_id" in c)),
  );
  await role(mod);
  assert.equal((await rpc("read_social_reports", [])).length, 1);
  await mutate(wid, null, "hide", { comment_id: comment });
  await role(null);
  comments = await rpc("read_social_comments", [wid, null, null, null, 20]);
  assert.equal(comments.find((c) => c.id === comment).body, "");
  assert.equal(comments.find((c) => c.id === comment).status, "hidden");
  await role(mod);
  await mutate(wid, null, "restore_comment", { comment_id: comment });
  assert.equal(
    (await rpc("read_social_comments", [wid, null, null, null, 20])).find(
      (c) => c.id === comment,
    ).body,
    "Comentário editado",
  );
  await role(a);
  await mutate(wid, null, "delete_comment", { comment_id: comment });
  comments = await rpc("read_social_comments", [wid, null, null, null, 20]);
  assert.equal(comments.find((c) => c.id === comment).status, "deleted");
  assert.ok(comments.find((c) => c.id === reply));
  // Cursor pagination remains deterministic for equal timestamps.
  await db.exec("RESET ROLE");
  for (let i = 0; i < 25; i++)
    await db.query(
      "INSERT INTO public.social_comments(user_id,publication_id,body) VALUES($1,$2,$3)",
      [a, wid, "Teste " + i],
    );
  await role(null);
  const first = await rpc("read_social_comments", [wid, null, null, null, 20]);
  const last = first.at(-1);
  const next = await rpc("read_social_comments", [
    wid,
    null,
    last.created_at,
    last.id,
    20,
  ]);
  assert.equal(new Set([...first, ...next].map((c) => c.id)).size, 27);
  // Metrics require server proof, deduplicate refreshes and reject private/foreign entries.
  const visitor = "a".repeat(64),
    network = "b".repeat(64);
  await denied(() =>
    rpc("record_social_view", [wid, null, visitor, network, "wrong-proof"]),
  );
  assert.equal(
    (await rpc("record_social_view", [wid, null, visitor, network, proof]))
      .counted,
    true,
  );
  assert.equal(
    (await rpc("record_social_view", [wid, null, visitor, network, proof]))
      .counted,
    false,
  );
  assert.equal(
    (await rpc("record_social_view", [wid, eid, visitor, network, proof]))
      .counted,
    true,
  );
  s = await rpc("read_social_state", [wid, null]);
  assert.equal(s.views, 1);
  assert.equal(s.visitors, 1);
  await db.exec("RESET ROLE");
  await db.exec(
    "UPDATE public.social_metric_visitors SET last_seen=now()-interval '25 hours'",
  );
  await db.exec(
    "UPDATE public.social_metric_settings SET network_daily_limit=3",
  );
  await role(null);
  assert.equal(
    (await rpc("record_social_view", [wid, null, visitor, network, proof]))
      .counted,
    true,
  );
  assert.equal(
    (
      await rpc("record_social_view", [
        wid,
        null,
        "c".repeat(64),
        network,
        proof,
      ])
    ).counted,
    false,
  );
  assert.equal((await rpc("read_social_state", [wid, null])).views, 2);
  assert.equal((await rpc("read_social_state", [wid, null])).visitors, 1);
  // Public targets lock withdrawal; no mutation, comment or metric survives the public check.
  await role(a);
  w = await publish(w, "withdraw");
  await denied(() => mutate(wid, null, "like", { value: true }));
  await denied(() => rpc("read_social_comments", [wid, null, null, null, 20]));
  let library = await rpc("read_social_library", [null, null, 24]);
  assert.equal(library[0].available, false);
  assert.equal(library[0].title, null);
  await role(null);
  await denied(() => rpc("read_social_state", [wid, null]));
  await denied(() =>
    rpc("record_social_view", [wid, null, visitor, network, proof]),
  );
  await role(a);
  await rpc("remove_social_library", [wid, "favorite"]);
  w = await publish(w);
  assert.equal((await rpc("read_social_state", [wid, null])).favorite, false);
  assert.equal((await rpc("read_social_state", [wid, null])).likes, 1);
  assert.equal((await rpc("read_social_state", [wid, eid])).likes, 1);
  // Refreshing snapshots must preserve chapter comments, reactions and metrics.
  assert.equal(
    (await rpc("read_social_comments", [wid, null, null, null, 50])).length,
    27,
  );
  assert.equal((await rpc("read_social_state", [wid, eid])).views, 1);
  await mutate(wid, null, "follow", { value: true });
  w = await publish(w, "withdraw");
  await mutate(wid, null, "follow", { value: false });
  assert.equal(
    (await rpc("read_social_library", [null, null, 24]))[0].following,
    false,
  );
  w = await publish(w);
  // Real visual snapshot contracts: manga RTL and webtoon vertical, metadata-only local assets.
  await db.exec("RESET ROLE");
  await db.query(
    "UPDATE public.cover_media_settings SET worker_token_hash=$1",
    [createHash("sha256").update(proof).digest("hex")],
  );
  await db.exec(
    "UPDATE public.editorial_media_settings SET public_reading_enabled=true WHERE id=true; UPDATE public.social_comments SET created_at=now()-interval '2 hours'",
  );
  await role(a);
  let visual = (
    await db.query(
      "INSERT INTO public.works(title,slug,description,type,language,age_rating) VALUES('Visual social','visual-social','Sinopse','Mangá','pt','Livre') RETURNING *",
    )
  ).rows[0];
  visual = await editorial(visual, "add_entry");
  const visualPrivateEntry = visual.entries[0].id;
  const asset = await rpc("reserve_editorial_upload", [
    visual.id,
    visualPrivateEntry,
    "image/png",
    512,
    100,
    100,
    "teste.png",
    proof,
  ]);
  await rpc("finish_editorial_upload", [asset.id, proof]);
  async function saveVisual(config) {
    const chapter = visual.entries[0];
    visual = (
      await rpc("save_visual_chapter", [
        visual.id,
        visual.revision,
        chapter.id,
        chapter.revision,
        "Capítulo visual",
        "GUIÃO PRIVADO",
        config,
        [{ id: randomUUID(), assetId: asset.id }],
        randomUUID(),
      ])
    ).work;
  }
  await saveVisual({ format: "manga", mode: "paged", direction: "rtl" });
  visual = await publish(visual);
  const visibleVisual = await rpc("read_public_work", [visual.public_id]),
    publicChapter = visibleVisual.entries[0].id;
  assert.equal(visibleVisual.entries[0].content, "");
  await mutate(visual.public_id, publicChapter, "like", { value: true });
  const visualComment = (
    await mutate(visual.public_id, publicChapter, "comment", {
      body: "Comentário de imagem",
    })
  ).comment_id;
  await saveVisual({ format: "webtoon", mode: "vertical", direction: "ltr" });
  assert.equal(
    (await rpc("read_public_work", [visual.public_id])).visual_settings.format,
    "manga",
  );
  visual = await publish(visual);
  assert.equal(
    (await rpc("read_public_work", [visual.public_id])).visual_settings.format,
    "webtoon",
  );
  assert.equal(
    (await rpc("read_social_state", [visual.public_id, publicChapter])).likes,
    1,
  );
  assert.equal(
    (
      await rpc("read_social_comments", [
        visual.public_id,
        publicChapter,
        null,
        null,
        20,
      ])
    )[0].id,
    visualComment,
  );
  await role(b);
  await denied(() => rpc("read_social_state", [visual.id, visualPrivateEntry]));
  await role(a);
  // All published formats share the same target contract; neither scripts nor private IDs are accepted.
  for (const format of ["Conto", "Poesia", "HQ / Comic", "Mangá"]) {
    let item = (
      await db.query(
        "INSERT INTO public.works(title,slug,description,type,language,age_rating) VALUES($1,$2,'Sinopse',$1,'pt','Livre') RETURNING *",
        [format, randomUUID()],
      )
    ).rows[0];
    item = await editorial(item, "add_entry");
    item = await editorial(item, "save_entry", {
      entry_id: item.entries[0].id,
      entry_revision: item.entries[0].revision,
      title: "Entrada",
      content: "Conteúdo",
    });
    item = await publish(item);
    await mutate(item.public_id, null, "like", { value: true });
    assert.equal(
      (await rpc("read_social_state", [item.public_id, null])).liked,
      true,
    );
    await denied(() => mutate(item.public_id, eid, "like", { value: true }));
  }
  // Direct counter manipulation and inherited PUBLIC function grants are denied.
  await denied(() =>
    db.query("UPDATE public.social_statistics SET views=99999"),
  );
  await db.exec("RESET ROLE");
  const exposed = (
    await db.query(
      "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, LATERAL aclexplode(p.proacl) acl WHERE n.nspname='public' AND (proname LIKE '%social%' OR proname IN ('read_author_follow','set_author_follow')) AND acl.grantee=0 AND acl.privilege_type='EXECUTE' ",
    )
  ).rows;
  assert.equal(exposed.length, 0);
  console.log(
    "PASS F5.1 SQL: additive F4 snapshots; hostile defaults/RLS/grants; A/B/anon; like/follow uniqueness; idempotent operations; independent private library; comments/replies/edit/delete/report/moderation; pagination; server-proof metrics/dedup/network limits; withdrawal/republication and prior text contracts.",
  );
} finally {
  await db.close();
}
