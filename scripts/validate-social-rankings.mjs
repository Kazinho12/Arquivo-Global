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

  await db.exec(
    await readFile(
      "supabase/migrations/20261115030000_social_rankings.sql",
      "utf8",
    ),
  );
  const wid = w.public_id;
  await role(null);
  await denied(() => rpc("social_metrics_status", ["wrong-proof"]));
  assert.deepEqual(await rpc("social_metrics_status", [proof]), {
    ready: true,
  });
  assert.equal((await rpc("read_social_rankings", [])).total, 0);
  await role(a);
  const operation = randomUUID();
  await mutate(wid, null, "favorite", { value: true }, operation);
  await mutate(wid, null, "favorite", { value: true }, operation);
  assert.equal((await rpc("read_social_state", [wid, null])).favorites, 1);
  await mutate(wid, null, "favorite", { value: false });
  assert.equal((await rpc("read_social_state", [wid, null])).favorites, 0);
  await role(b);
  await denied(() => db.query("SELECT * FROM public.social_library"));
  const samples = [];
  for (let i = 0; i < 5; i++) {
    await role(a);
    let row = (
      await db.query(
        "INSERT INTO public.works(title,slug,description,type,language,age_rating) VALUES($1,$2,'Sinopse','Romance','pt','Livre') RETURNING *",
        ["Ranking " + i, randomUUID()],
      )
    ).rows[0];
    row = await editorial(row, "add_entry");
    row = await editorial(row, "save_entry", {
      entry_id: row.entries[0].id,
      entry_revision: row.entries[0].revision,
      title: "Capítulo",
      content: "Conteúdo",
    });
    row = await publish(row);
    samples.push(row);
  }
  // Local fixtures as administrator only; no browser can manipulate these counters.
  await db.exec("RESET ROLE");
  await db.query(
    "INSERT INTO public.social_statistics(publication_id,views,visitors) VALUES($1,100,10)",
    [samples[0].public_id],
  );
  for (const actor of [a, b, mod])
    await db.query(
      "INSERT INTO public.social_likes(user_id,publication_id) VALUES($1,$2)",
      [actor, samples[1].public_id],
    );
  for (const actor of [a, b])
    await db.query(
      "INSERT INTO public.social_library(user_id,publication_id,favorite) VALUES($1,$2,true)",
      [actor, samples[2].public_id],
    );
  for (let i = 0; i < 4; i++)
    await db.query(
      "INSERT INTO public.social_comments(user_id,publication_id,body) VALUES($1,$2,'Visível')",
      [a, samples[3].public_id],
    );
  await db.query(
    "INSERT INTO public.social_comments(user_id,publication_id,body,status) VALUES($1,$2,'Ocultado','hidden')",
    [b, samples[0].public_id],
  );
  await db.query(
    "INSERT INTO public.social_work_follows(user_id,publication_id) VALUES($1,$2)",
    [a, samples[4].public_id],
  );
  await role(null);
  for (const [mode, index] of [
    ["views", 0],
    ["likes", 1],
    ["favorites", 2],
    ["comments", 3],
  ]) {
    const ranked = await rpc("read_social_rankings", [mode]);
    assert.equal(ranked.items[0].id, samples[index].public_id);
    assert.equal(ranked.period, "accumulated");
    assert.equal(ranked.total, 1);
    assert.ok(
      ranked.items.every(
        (row) =>
          !("work_id" in row) &&
          !("owner_id" in row) &&
          !("visitor_hash" in row) &&
          !("user_id" in row),
      ),
    );
  }
  let ranked = await rpc("read_social_rankings", ["featured"]);
  assert.equal(ranked.total, 5);
  for (const row of ranked.items) {
    const expected =
      Math.log1p(row.social_views) +
      3 * Math.log1p(row.social_likes) +
      4 * Math.log1p(row.social_favorites) +
      2 * Math.log1p(row.social_followers) +
      Math.log1p(row.social_comments);
    assert.ok(Math.abs(row.social_score - expected) < 0.0001);
  }
  const pages = await Promise.all([
    rpc("read_social_rankings", ["featured", "", false, 1, 2]),
    rpc("read_social_rankings", ["featured", "", false, 2, 2]),
  ]);
  assert.equal(new Set(pages.flatMap((p) => p.items.map((r) => r.id))).size, 4);
  await denied(() => rpc("read_social_rankings", ["malicious-sort"]));
  // Accumulated favorites are public but personal lists never leave the owner endpoint.
  assert.equal(
    (await rpc("read_social_state", [samples[2].public_id, null])).favorites,
    2,
  );
  await role(a);
  await mutate(samples[2].public_id, null, "favorite", { value: false });
  assert.equal(
    (await rpc("read_social_state", [samples[2].public_id, null])).favorites,
    1,
  );
  let removed = await publish(samples[0], "withdraw");
  await role(null);
  assert.equal((await rpc("read_social_rankings", ["views"])).total, 0);
  await role(a);
  removed = await editorial(removed, "archive");
  assert.equal(
    (await rpc("read_social_rankings", ["featured", "", true])).items.some(
      (r) => r.id === removed.public_id,
    ),
    false,
  );
  // Private drafts with no snapshot can never be ranked, even with sensitive opt-in.
  const draft = (
    await db.query(
      "INSERT INTO public.works(title,slug,description,type,language,age_rating) VALUES('Privada','privada-ranking','Sinopse','Romance','pt','Livre') RETURNING *",
    )
  ).rows[0];
  await role(null);
  assert.ok(
    !(await rpc("read_social_rankings", ["featured", "", true])).items.some(
      (row) => row.id === draft.id,
    ),
  );
  // Adult/warnings require explicit opt-in; unknown ratings remain excluded.
  await db.exec("RESET ROLE");
  await db.query(
    "UPDATE public.published_works SET age_rating='+18' WHERE id=$1",
    [samples[1].public_id],
  );
  await role(null);
  assert.equal((await rpc("read_social_rankings", ["likes"])).total, 0);
  assert.equal(
    (await rpc("read_social_rankings", ["likes", "", true])).total,
    1,
  );
  assert.equal(
    (await rpc("read_social_rankings", ["featured", "Poesia", true])).total,
    0,
  );
  await denied(() =>
    db.query("SELECT token_hash FROM public.social_metric_settings"),
  );
  console.log(
    "PASS F5.1 rankings SQL: favorites uniqueness/removal/private libraries; proof-only readonly readiness; view/like/favorite/comment ordering; cumulative score; pagination; published/withdrawn/archived/private exclusion; sensitive opt-in; permissions and existing data preserved.",
  );
} finally {
  await db.close();
}
