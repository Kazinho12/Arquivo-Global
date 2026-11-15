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
  let legacy = (
    await db.query(
      "INSERT INTO public.works(title,slug,description,type,language,age_rating) VALUES('Texto antigo','texto-antigo','Sinopse','Romance','pt','Livre') RETURNING *",
    )
  ).rows[0];
  legacy = await mutate(legacy, "add_entry");
  legacy = await mutate(legacy, "save_entry", {
    entry_id: legacy.entries[0].id,
    entry_revision: legacy.entries[0].revision,
    title: "Texto",
    content: "Conteúdo textual antigo",
    alignment: "left",
  });
  legacy = (await publish(legacy)).work;
  await role(null);
  const legacySnapshot = await rpc("read_public_work", [legacy.public_id]);
  await db.exec("RESET ROLE");
  await db.exec(
    await readFile(
      "supabase/migrations/20261115010000_public_visual_reader.sql",
      "utf8",
    ),
  );
  await role(null);
  assert.equal(
    (await rpc("read_public_work", [legacy.public_id])).entries[0].content,
    legacySnapshot.entries[0].content,
  );
  await role(a);
  let w = (
    await db.query(
      "INSERT INTO public.works(title,slug,description,type,language,age_rating) VALUES('Mangá público','manga-publico','Sinopse visual','Mangá','pt','Livre') RETURNING *",
    )
  ).rows[0];
  w = await mutate(w, "add_entry", { title: "Capítulo 1" });
  const first = w.entries[0].id;
  const reserve = async (entryId) =>
    rpc("reserve_editorial_upload", [
      w.id,
      entryId,
      "image/png",
      7000000,
      600,
      12000,
      "pagina.png",
    ]);
  const image1 = await reserve(first),
    image2 = await reserve(first);
  await rpc("finish_editorial_upload", [image1.id]);
  await rpc("finish_editorial_upload", [image2.id]);
  const settings = { format: "manga", mode: "paged", direction: "rtl" };
  async function save(work, entryId, assets, config = settings) {
    const entry = work.entries.find((e) => e.id === entryId);
    return (
      await rpc("save_visual_chapter", [
        work.id,
        work.revision,
        entryId,
        entry.revision,
        entry.title,
        "GUIÃO E NOTAS PRIVADAS",
        config,
        assets.map((id) => ({ id: randomUUID(), assetId: id })),
        randomUUID(),
      ])
    ).work;
  }
  w = await save(w, first, Array(21).fill(image1.id));
  await assert.rejects(publish(w), (e) => e.code === "55000");
  await role(b);
  await assert.rejects(publish(w), (e) => e.code === "42501");
  await role(null);
  assert.equal(await rpc("read_public_work", [w.public_id]), null);
  assert.equal(
    await rpc("read_public_visual_pages", [w.public_id, first, 0, 20]),
    null,
  );
  await assert.rejects(
    rpc("resolve_public_visual_asset", [
      w.public_id,
      first,
      randomUUID(),
      "wrong-proof",
    ]),
    (e) => e.code === "42501",
  );
  await db.exec("RESET ROLE");
  await db.exec(
    "UPDATE public.editorial_media_settings SET public_reading_enabled=true WHERE id=true",
  );
  await role(a);
  const before = w,
    op = randomUUID();
  w = (await publish(w, "publish", op)).work;
  assert.equal((await publish(before, "publish", op)).already_applied, true);
  await assert.rejects(publish(before), (e) => e.code === "40001");
  assert.equal(w.entries[0].content, "GUIÃO E NOTAS PRIVADAS");
  await role(null);
  const publicWork = await rpc("read_public_work", [w.public_id]),
    chapter = publicWork.entries[0];
  assert.equal(chapter.content, "");
  assert.equal(chapter.visual_page_count, 21);
  assert.equal(publicWork.visual_settings.direction, "rtl");
  const seq = await rpc("read_public_visual_pages", [
    w.public_id,
    chapter.id,
    0,
    20,
  ]);
  assert.equal(seq.items.length, 20);
  assert.equal(seq.total, 21);
  assert.deepEqual(
    seq.items.map((p) => p.position),
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  assert.equal(
    (await rpc("read_public_visual_pages", [w.public_id, chapter.id, 20, 20]))
      .items[0].position,
    21,
  );
  assert.equal(
    (await rpc("read_public_visual_pages", [w.public_id, chapter.id, 0, 9999]))
      .items.length,
    21,
  );
  assert.equal(
    (await rpc("read_public_visual_pages", [w.public_id, chapter.id, -20, 20]))
      .items[0].position,
    1,
  );
  assert.ok(!JSON.stringify(seq).includes(image1.id));
  assert.ok(!JSON.stringify(publicWork).includes("GUIÃO"));
  await assert.rejects(
    db.query("SELECT asset_id FROM public.published_visual_pages"),
    (e) => e.code === "42501",
  );
  await assert.rejects(
    db.query("SELECT * FROM public.editorial_assets"),
    (e) => e.code === "42501",
  );
  await assert.rejects(
    db.query("SELECT * FROM public.work_operation_receipts"),
    (e) => e.code === "42501",
  );
  await assert.rejects(
    db.query("DELETE FROM public.published_visual_pages"),
    (e) => e.code === "42501",
  );
  await assert.rejects(
    db.query("SELECT public.guard_published_visual_page()"),
    (e) => e.code === "42501",
  );
  const resolve = (entryId, pageId, proof = workerToken) =>
    rpc("resolve_public_visual_asset", [w.public_id, entryId, pageId, proof]);
  assert.equal(
    (await resolve(chapter.id, seq.items[0].id)).object_key,
    image1.object_key,
  );
  assert.equal(await resolve(first, seq.items[0].id), null);
  assert.equal(await resolve(chapter.id, image1.id), null);
  await role(a);
  const webtoon = { format: "webtoon", mode: "vertical", direction: "ltr" };
  w = await save(w, first, [image2.id, image2.id], webtoon);
  await assert.rejects(
    rpc("begin_delete_editorial", [image1.id]),
    (e) => e.code === "23503",
  );
  const unused = await rpc("list_unused_editorial_assets", [50]);
  assert.ok(!unused.some((r) => r.id === image1.id));
  await role(null);
  assert.equal(
    (await rpc("read_public_work", [w.public_id])).visual_settings.format,
    "manga",
  );
  assert.equal(
    (await resolve(chapter.id, seq.items[0].id)).object_key,
    image1.object_key,
  );
  await role(a);
  w = await mutate(w, "add_entry", { title: "Episódio 2" });
  const second = w.entries[1].id;
  w = await save(w, second, [image2.id], webtoon);
  w = (await publish(w)).work;
  await role(null);
  const updated = await rpc("read_public_work", [w.public_id]);
  assert.equal(updated.visual_settings.format, "webtoon");
  assert.equal(updated.entries.length, 2);
  assert.equal(await resolve(chapter.id, seq.items[0].id), null);
  const nextSeq = await rpc("read_public_visual_pages", [
    w.public_id,
    chapter.id,
    0,
    20,
  ]);
  assert.equal(nextSeq.total, 2);
  assert.equal(
    (await resolve(chapter.id, nextSeq.items[0].id)).object_key,
    image2.object_key,
  );
  await role(a);
  await rpc("begin_delete_editorial", [image1.id]);
  await rpc("finish_delete_editorial", [image1.id]);
  w = await mutate(w, "delete_entry", {
    entry_id: first,
    entry_revision: w.entries[0].revision,
  });
  await role(null);
  assert.equal(
    (await rpc("read_public_visual_pages", [w.public_id, chapter.id, 0, 20]))
      .total,
    2,
  );
  await role(a);
  w = (await publish(w)).work;
  await role(null);
  assert.equal(
    await rpc("read_public_visual_pages", [w.public_id, chapter.id, 0, 20]),
    null,
  );
  assert.equal(await resolve(chapter.id, nextSeq.items[0].id), null);
  const lastPublic = await rpc("read_public_work", [w.public_id]),
    lastChapter = lastPublic.entries[0],
    lastPages = await rpc("read_public_visual_pages", [
      w.public_id,
      lastChapter.id,
      0,
      20,
    ]);
  await role(a);
  w = (await publish(w, "withdraw")).work;
  await role(null);
  assert.equal(await rpc("read_public_work", [w.public_id]), null);
  assert.equal(await resolve(lastChapter.id, lastPages.items[0].id), null);
  assert.equal(
    await rpc("read_public_visual_pages", [w.public_id, lastChapter.id, 0, 20]),
    null,
  );
  await role(a);
  await assert.rejects(
    rpc("begin_delete_editorial", [image2.id]),
    (e) => e.code === "23503",
  );
  w = (await publish(w)).work;
  await role(null);
  const republished = await rpc("read_public_work", [w.public_id]);
  assert.equal(republished.entries[0].id, lastChapter.id);
  assert.equal(await resolve(lastChapter.id, lastPages.items[0].id), null);
  const fresh = await rpc("read_public_visual_pages", [
    w.public_id,
    lastChapter.id,
    0,
    20,
  ]);
  assert.ok(await resolve(lastChapter.id, fresh.items[0].id));
  await role(b);
  assert.equal(
    (
      await rpc("read_public_visual_pages", [
        w.public_id,
        lastChapter.id,
        0,
        20,
      ])
    ).total,
    1,
  );
  await assert.rejects(
    db.query("UPDATE public.published_visual_pages SET width=1"),
    (e) => e.code === "42501",
  );
  await assert.rejects(
    db.query("SELECT worker_token_hash FROM public.cover_media_settings"),
    (e) => e.code === "42501",
  );
  await role(a);
  const cover = await rpc("reserve_cover_upload", [w.id, "image/png", 5000]);
  assert.ok(cover.id);
  await db.exec("RESET ROLE");
  await db.exec(
    "UPDATE public.editorial_media_settings SET public_reading_enabled=false WHERE id=true",
  );
  await role(null);
  assert.equal(await resolve(lastChapter.id, fresh.items[0].id), null);
  console.log(
    "PASS F4.2-C SQL: A/B/C migrations; old text snapshots; activation OFF; ownership/RLS/column grants; 20-page batches; public resolution with Worker proof; scripts remain private; immutable ordered snapshots; pinned assets; revision conflicts/replays; chapter removal; withdraw/republication; cover RPC regression.",
  );
} finally {
  await db.close();
}
