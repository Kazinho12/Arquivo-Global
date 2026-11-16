import {
  baseConfig,
  officialThemes,
} from "../src/foundation/features/personalization/themes";
import { defaults } from "../src/foundation/features/personalization/model";
// In-memory PostgreSQL only. No Supabase/Cloudflare/Vercel connections.
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH!).href),
  db = new PGlite();
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  d = randomUUID(),
  session = new Map<string, string>(
    [a, b, c, d].map((id) => [id, randomUUID()]),
  );
async function role(id: string | null) {
  await db.exec("RESET ROLE;SET ROLE " + (id ? "authenticated" : "anon"));
  await db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [id ?? "", JSON.stringify({ sub: id, session_id: session.get(id ?? "") })],
  );
}
const rpc = async (name: string, args: any[] = []) =>
  (
    await db.query(
      `SELECT public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) r`,
      args,
    )
  ).rows[0].r;
const denied = (fn: () => Promise<unknown>) =>
  assert.rejects(fn, (e: any) =>
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
  for (const theme of officialThemes) {
    const result = await db.query(
      "SELECT public.personalization_theme_valid($1::jsonb) valid",
      [JSON.stringify(theme.config)],
    );
    assert.equal(result.rows[0].valid, true, theme.id);
  }
  const call = (
    action: string,
    payload: any = null,
    revision: number | null = null,
    op: string | null = null,
  ) => rpc("global_personalization", [action, payload, revision, op]);
  const payload = (data = defaults()) => ({
    settings: data.settings,
    themes: data.themes,
  });
  await role(a);
  assert.deepEqual(await call("read"), {
    settings: null,
    themes: [],
    revision: 0,
  });
  const op = randomUUID(),
    saved = await call("save", payload(), 0, op);
  assert.equal(saved.revision, 1);
  assert.deepEqual(await call("save", payload(), 0, op), saved);
  await denied(() =>
    call("save", { ...payload(), owner_id: b }, 1, randomUUID()),
  );
  await denied(() => call("save", payload(), 0, randomUUID()));
  await denied(() =>
    call(
      "save",
      { ...payload(), settings: { ...defaults().settings, region: "JP" } },
      0,
      op,
    ),
  );
  const personal = {
    id: randomUUID(),
    name: "Privado",
    config: structuredClone(baseConfig),
  };
  let next = defaults();
  next.settings.region = "JP";
  next.settings.readingLanguages = ["fr", "vmw"];
  next.settings.theme = personal.id;
  next.themes = [personal];
  let ack = await call("save", payload(next), 1, randomUUID());
  assert.equal(ack.revision, 2);
  assert.equal((await call("read")).themes[0].name, "Privado");
  await role(b);
  assert.equal((await call("read")).settings, null);
  const forged = defaults();
  forged.settings.theme = personal.id;
  await denied(() => call("save", payload(forged), 0, randomUUID()));
  const own = await call("save", payload(), 0, randomUUID());
  assert.equal(own.revision, 1);
  await role(a);
  assert.equal((await call("read")).themes.length, 1);
  for (const mutate of [
    (v: any) => (v.settings.region = "XX"),
    (v: any) => (v.settings.locale = "en"),
    (v: any) => (v.settings.readingLanguages = ["invented"]),
    (v: any) => (v.settings.config.colors.bg = "url(https://evil)"),
    (v: any) => (v.settings.config.colors.text = v.settings.config.colors.bg),
    (v: any) => (v.settings.config.typography.font = null),
    (v: any) => (v.settings.config.typography.size = 0),
    (v: any) => (v.settings.config.effects.mode = null),
    (v: any) => (v.settings.config.effects.speed = 0.01),
    (v: any) => (v.settings.config.css = "body{display:none}"),
    (v: any) => (v.settings.config.components.shadow = "url(x)"),
    (v: any) => (v.settings.config.effects.targets = ["literary-text"]),
    (v: any) => (v.settings.config.colors.extra = "#000000"),
  ]) {
    const v = structuredClone(next);
    mutate(v);
    await denied(() => call("save", payload(v), 2, randomUUID()));
  }
  const duplicate = structuredClone(next);
  duplicate.themes.push(personal);
  await denied(() => call("save", payload(duplicate), 2, randomUUID()));
  const many = defaults();
  many.themes = Array.from({ length: 20 }, (_, i) => ({
    id: randomUUID(),
    name: "Tema " + i,
    config: structuredClone(baseConfig),
  }));
  ack = await call("save", payload(many), 2, randomUUID());
  assert.equal(ack.themes.length, 20);
  many.themes.push({
    id: randomUUID(),
    name: "Excesso",
    config: structuredClone(baseConfig),
  });
  await denied(() => call("save", payload(many), 3, randomUUID()));
  // Deletion/rename/active changes are one revision-checked snapshot, not separate unguarded writes.
  const edit = structuredClone(ack);
  edit.themes[0].name = "Renomeado";
  edit.themes.pop();
  edit.settings.theme = edit.themes[0].id;
  ack = await call("save", payload(edit), 3, randomUUID());
  assert.equal(ack.themes.length, 19);
  assert.equal(ack.themes[0].name, "Renomeado");
  await denied(() => call("save", payload(edit), 3, randomUUID()));
  await role(null);
  await denied(() => call("read"));
  await role(b);
  assert.equal((await call("read")).themes.length, 0);
  for (const table of [
    "global_personalization_preferences",
    "global_personalization_operations",
  ])
    await denied(() => db.query("SELECT * FROM public." + table));
  await denied(() =>
    db.query("SELECT public.personalization_theme_valid($1)", [baseConfig]),
  );
  await db.exec("RESET ROLE");
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM pg_proc p,aclexplode(p.proacl)a WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'personalization_%' AND a.grantee=0",
      )
    ).rows[0].n,
    0,
  );
  const policies = await db.query(
    "SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN('global_personalization_preferences','global_personalization_operations') AND relrowsecurity",
  );
  assert.equal(policies.rows[0].n, 2);
  // Real rate-limit on confirmed writes; invalid attempts never become state.
  await role(b);
  let revision = 1,
    limited = false;
  for (let i = 0; i < 31; i++) {
    try {
      const r = await call("save", payload(), revision, randomUUID());
      revision = r.revision;
    } catch (e) {
      assert.equal((e as any).code, "54000");
      limited = true;
      break;
    }
  }
  assert.equal(limited, true);
  console.log(
    "PASS F6.1 SQL: all official themes/contrast; exact value allowlists; private account snapshots, owner isolation, CAS/replay, quotas, malformed/CSS tokens rejected, RLS/grants and rate limits.",
  );
} finally {
  await db.close();
}
