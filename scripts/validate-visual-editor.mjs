// In-memory PostgreSQL only. Never connects to Supabase or R2.
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
const db = new PGlite();
const a = randomUUID(),
  b = randomUUID();
async function role(id) {
  await db.exec("RESET ROLE; SET ROLE " + (id ? "authenticated" : "anon"));
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    id || "",
  ]);
}
const workerToken = "disposable-sql-worker-proof-0000000000000000000";
const protectedRpc = new Set([
  "reserve_cover_upload",
  "reserve_editorial_upload",
  "finish_editorial_upload",
  "begin_delete_editorial",
  "finish_delete_editorial",
  "list_unused_editorial_assets",
  "list_unused_cover_assets",
  "finish_cover_upload",
  "begin_delete_cover",
  "finish_delete_cover",
]);
const rpc = async (name, args) => {
  const values = protectedRpc.has(name) ? [...args, workerToken] : args;
  return (
    await db.query(
      `SELECT public.${name}(${values.map((_, i) => "$" + (i + 1)).join(",")}) r`,
      values,
    )
  ).rows[0].r;
};
const read = async (id) => rpc("read_private_work", [id]);
const mutate = async (w, action, payload = {}) =>
  (
    await rpc("mutate_private_work", [
      w.id,
      w.revision,
      action,
      payload,
      randomUUID(),
    ])
  ).work;
const publish = async (w, action = "publish", operation = randomUUID()) =>
  rpc("publish_private_work", [w.id, w.revision, action, operation]);
const attach = async (w, image) =>
  (
    await db.query(
      "UPDATE public.works SET cover_image=$1 WHERE id=$2 AND revision=$3 RETURNING *",
      [image, w.id, w.revision],
    )
  ).rows[0];
try {
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users,username text,display_name text);GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;GRANT SELECT ON public.profiles TO anon,authenticated;ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`,
  );
  for (const id of [a, b]) {
    await db.query("INSERT INTO auth.users VALUES($1)", [id]);
    await db.query("INSERT INTO public.profiles VALUES($1,$2,'Autora')", [
      id,
      id,
    ]);
  }
  const files = (await readdir("supabase/migrations"))
    .filter(
      (f) =>
        f.startsWith("20261111") ||
        f === "20261114000000_custom_cover_media.sql" ||
        f === "20261115000000_visual_editor_private.sql",
    )
    .sort();
  for (const file of files)
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  await db.query(
    "UPDATE public.cover_media_settings SET worker_token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
    [workerToken],
  );

  await role(a);
  let w = (
    await db.query(
      "INSERT INTO public.works(title,slug,description,type,language,age_rating,cover_style,cover_seed) VALUES('Visual antigo','visual-antigo','Sinopse','Mangá','pt','Livre','retro',42) RETURNING *",
    )
  ).rows[0];
  w = await mutate(w, "add_entry");
  let e = w.entries[0];
  w = await mutate(w, "save_entry", {
    entry_id: e.id,
    entry_revision: e.revision,
    title: "Ato antigo preservado",
    content: "Guião antigo **preservado**",
    alignment: "left",
  });
  e = w.entries[0];
  w = (await publish(w)).work;
  const oldPublic = await rpc("read_public_work", [w.public_id]);
  const reserve = (
    entry,
    mime = "image/png",
    bytes = 100,
    width = 100,
    height = 200,
  ) =>
    rpc("reserve_editorial_upload", [
      w.id,
      entry,
      mime,
      bytes,
      width,
      height,
      "pagina.png",
    ]);
  const image1 = await reserve(e.id, "image/png", 8388608, 800, 30000),
    image2 = await reserve(e.id);
  await assert.rejects(
    db.query(
      "SELECT public.reserve_editorial_upload($1,$2,'image/png',100,100,200,'x.png','wrong')",
      [w.id, e.id],
    ),
  );
  await assert.rejects(
    rpc("begin_delete_editorial", [image1.id]),
    (err) => err.code === "55000",
  );
  assert.deepEqual((await read(w.id)).entries[0].visual_pages, []);
  await rpc("finish_editorial_upload", [image1.id]);
  await rpc("finish_editorial_upload", [image2.id]);
  const p1 = { id: randomUUID(), assetId: image1.id },
    p2 = { id: randomUUID(), assetId: image2.id };
  let settings = { format: "webtoon", mode: "vertical", direction: "ltr" };
  const save = (work, entry, pages, op = randomUUID(), config = settings) =>
    rpc("save_visual_chapter", [
      work.id,
      work.revision,
      entry.id,
      entry.revision,
      entry.title,
      entry.content,
      config,
      pages,
      op,
    ]);
  await role(null);
  await assert.rejects(db.query("SELECT * FROM public.editorial_assets"));
  await assert.rejects(db.query("SELECT * FROM public.visual_pages"));
  await assert.rejects(rpc("visual_editor_limits", []));
  await assert.rejects(read(w.id));
  await role(b);
  assert.equal(
    (await db.query("SELECT * FROM public.editorial_assets")).rows.length,
    0,
  );
  await assert.rejects(rpc("finish_editorial_upload", [image1.id]));
  await assert.rejects(save(w, e, [p1]));
  let other = (
    await db.query(
      "INSERT INTO public.works(title,slug,type,language) VALUES('Outro','outro','HQ / Comic','pt') RETURNING *",
    )
  ).rows[0];
  other = await mutate(other, "add_entry");
  await assert.rejects(
    save(other, other.entries[0], [p1]),
    (err) => err.code === "42501",
  );
  await role(a);
  const operation = randomUUID(),
    oldW = w;
  w = (await save(w, e, [p2, p1], operation)).work;
  assert.equal(w.revision, oldW.revision + 1);
  assert.equal(w.entries[0].revision, e.revision + 1);
  assert.deepEqual(w.visual_settings, settings);
  assert.equal(w.entries[0].title, "Ato antigo preservado");
  assert.equal(w.entries[0].content, "Guião antigo **preservado**");
  assert.deepEqual(
    w.entries[0].visual_pages.map((p) => p.asset_id),
    [image2.id, image1.id],
  );
  assert.deepEqual(
    w.entries[0].visual_pages.map((p) => p.position),
    [1, 2],
  );
  assert.equal(w.entries[0].visual_pages[1].height, 30000);
  const replay = await save(oldW, e, [p2, p1], operation);
  assert.ok(replay.already_applied);
  assert.equal(replay.work.revision, w.revision);
  await assert.rejects(save(oldW, e, [p1, p2]), (err) => err.code === "40001");
  await assert.rejects(
    save(oldW, e, [p1], operation),
    (err) => err.code === "22023",
  );
  await assert.rejects(save(w, e, [p1, p2]), (err) => err.code === "40001");
  e = w.entries[0];
  await assert.rejects(save(w, e, [p1, p1]));
  await assert.rejects(
    save(w, e, [{ id: randomUUID(), assetId: randomUUID() }]),
  );
  await role(null);
  assert.deepEqual(await rpc("read_public_work", [w.public_id]), oldPublic);
  await role(a);
  await assert.rejects(publish(w), (err) => err.code === "55000");
  w = (await publish(w, "withdraw")).work;
  await role(null);
  assert.equal(await rpc("read_public_work", [w.public_id]), null);
  await role(a);
  await assert.rejects(publish(w), (err) => err.code === "55000");
  settings = { format: "manga", mode: "paged", direction: "rtl" };
  w = (await save(w, w.entries[0], [p1, p2])).work;
  assert.deepEqual((await read(w.id)).visual_settings, settings);
  assert.deepEqual(
    w.entries[0].visual_pages.map((p) => p.asset_id),
    [image1.id, image2.id],
  );
  await assert.rejects(
    rpc("begin_delete_editorial", [image1.id]),
    (err) => err.code === "23503",
  );
  const beforeDup = w;
  w = await mutate(w, "duplicate_entry", {
    entry_id: w.entries[0].id,
    entry_revision: w.entries[0].revision,
  });
  assert.equal(w.entries.length, 2);
  assert.equal(w.entries[1].visual_pages.length, 2);
  assert.notEqual(
    w.entries[0].visual_pages[0].id,
    w.entries[1].visual_pages[0].id,
  );
  let clone = await mutate(w, "duplicate_work");
  assert.deepEqual(clone.visual_settings, settings);
  assert.equal(clone.entries[1].visual_pages.length, 2);
  assert.equal(clone.cover_style, "retro");
  assert.equal(clone.cover_seed, 42);
  w = await mutate(w, "reorder_entries", {
    ids: w.entries.map((e) => e.id).reverse(),
  });
  assert.equal(w.entries[1].title, "Ato antigo preservado");
  w = await mutate(w, "delete_entry", {
    entry_id: w.entries[0].id,
    entry_revision: w.entries[0].revision,
  });
  assert.equal(w.entries.length, 1);
  await assert.rejects(rpc("begin_delete_editorial", [image1.id]));
  // Configurable page-count limits: no hardcoded copy of the covers limit.
  await db.exec("RESET ROLE");
  await db.exec(
    "UPDATE public.editorial_media_settings SET max_pages_per_entry=1",
  );
  await role(a);
  await assert.rejects(save(w, w.entries[0], [p1, p2]));
  await db.exec("RESET ROLE");
  await db.exec(
    "UPDATE public.editorial_media_settings SET max_pages_per_entry=1200",
  );
  await role(a);
  const many = Array.from({ length: 1001 }, () => ({
    id: randomUUID(),
    assetId: image1.id,
  }));
  w = (await save(w, w.entries[0], many)).work;
  assert.equal(w.entries[0].visual_pages.length, 1001);
  assert.equal((await rpc("visual_editor_limits", [])).pages, 1200);
  // Shared budget: cover uploads cannot bypass the bytes reserved for pages.
  await db.exec("RESET ROLE");
  await db.exec(
    "UPDATE public.cover_media_settings SET storage_budget_bytes=8388708",
  );
  await role(a);
  await assert.rejects(
    rpc("reserve_cover_upload", [w.id, "image/png", 1]),
    (err) => err.code === "54000",
  );
  await assert.rejects(reserve(w.entries[0].id), (err) => err.code === "54000");
  await db.exec("RESET ROLE");
  await db.exec(
    "UPDATE public.cover_media_settings SET storage_budget_bytes=8589934592",
  );
  await role(a);
  await assert.rejects(reserve(w.entries[0].id, "image/png", 20971521));
  await assert.rejects(reserve(w.entries[0].id, "image/png", 100, 1000, 65536));
  await assert.rejects(reserve(w.entries[0].id, "image/svg+xml"));
  await mutate(w, "delete_work");
  await assert.rejects(rpc("begin_delete_editorial", [image1.id]));
  await mutate(clone, "delete_work");
  await db.exec("RESET ROLE");
  await db.exec(
    "UPDATE public.editorial_assets SET created_at=now()-interval '2 days'",
  );
  await role(a);
  const orphans = await rpc("list_unused_editorial_assets", [50]);
  assert.equal(orphans.length, 2);
  await rpc("begin_delete_editorial", [image1.id]);
  await rpc("finish_delete_editorial", [image1.id]);
  await rpc("begin_delete_editorial", [image1.id]);
  await rpc("finish_delete_editorial", [image1.id]);
  // Existing textual publication and cover uploads continue to work.
  let text = (
    await db.query(
      "INSERT INTO public.works(title,slug,description,type,language) VALUES('Texto','texto','Sinopse','Romance','pt') RETURNING *",
    )
  ).rows[0];
  text = await mutate(text, "add_entry");
  text = await mutate(text, "save_entry", {
    entry_id: text.entries[0].id,
    entry_revision: 1,
    title: "Capítulo",
    content: "Texto real",
    alignment: "left",
  });
  text = (await publish(text)).work;
  await role(null);
  assert.equal(
    (await rpc("read_public_work", [text.public_id])).entries[0].content,
    "Texto real",
  );
  await role(a);
  await rpc("reserve_cover_upload", [text.id, "image/png", 100]);
  console.log(
    "PASS F4.2-B SQL: full migrations; owner/RLS/grants/proof; long images >5MB; atomic save/recovery/order; revisions/replays; legacy scripts; RTL/vertical; copy/delete pins; configurable >1000 pages; shared quota; public blocking; textual/cover compatibility.",
  );
} finally {
  await db.close();
}
