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
  await db.query("INSERT INTO public.social_moderators VALUES($1),($2),($3)", [
    a,
    b,
    c,
  ]);
  await role(a);
  await denied(() => rpc("read_admin_bootstrap")); // no automatic grants
  await db.exec("RESET ROLE");
  await db.query(
    "INSERT INTO public.center_administrators(slot,user_id) VALUES(1,$1),(2,$2)",
    [a, b],
  );
  await role(null);
  await denied(() => rpc("read_admin_bootstrap"));
  await denied(() => admin("dashboard"));
  await denied(() => member("tickets"));
  await role(c);
  await denied(() => rpc("read_admin_bootstrap"));
  await denied(() => admin("dashboard")); // third moderator / matching username still denied
  await role(a);
  assert.equal((await rpc("read_admin_bootstrap")).id, a);
  assert.equal((await admin("dashboard")).users, 4);
  await db.exec("RESET ROLE");
  await db.query("DELETE FROM auth.sessions WHERE user_id=$1", [a]);
  await role(a);
  await denied(() => admin("dashboard"));
  await db.exec("RESET ROLE");
  await db.query("INSERT INTO auth.sessions VALUES($1,$2)", [
    session.get(a),
    a,
  ]);
  await role(c);
  const op = randomUUID();
  const ticket = await member(
    "create_ticket",
    {
      title: "Ajuda real",
      category: "technical",
      body: "Pedido de suporte privado",
    },
    op,
  );
  assert.equal(
    (
      await member(
        "create_ticket",
        {
          title: "Ajuda real",
          category: "technical",
          body: "Pedido de suporte privado",
        },
        op,
      )
    ).id,
    ticket.id,
  );
  assert.equal((await member("tickets")).length, 1);
  assert.equal(
    (await member("messages", { id: ticket.id }))[0].body,
    "Pedido de suporte privado",
  );
  await role(d);
  assert.deepEqual(await member("tickets"), []);
  await denied(() => member("messages", { id: ticket.id }));
  await denied(() =>
    member("reply_ticket", { id: ticket.id, body: "Intrusão" }),
  );
  await role(a);
  await admin("reply_ticket", {
    id: ticket.id,
    body: "Resposta administrativa",
    status: "awaiting_user",
  });
  await role(c);
  assert.equal((await member("notifications")).length, 1);
  const message = (await member("notifications"))[0];
  await member("read_notification", { id: message.id });
  assert.ok((await member("notifications"))[0].read_at);
  await member("reply_ticket", {
    id: ticket.id,
    body: "Esclarecimento do pedido",
  });
  await role(d);
  await denied(() => member("read_notification", { id: message.id }));
  // Reports: target verification, duplicate handling, moderation, appeals and publication guard.
  await role(c);
  let work = (
    await db.query(
      "INSERT INTO public.works(title,slug,description,type,language,age_rating) VALUES('Teste','center-work','Sinopse','Romance','pt','Livre') RETURNING *",
    )
  ).rows[0];
  const editorial = async (action, payload = {}) => {
    work = (
      await rpc("mutate_private_work", [
        work.id,
        work.revision,
        action,
        payload,
        randomUUID(),
      ])
    ).work;
  };
  await editorial("add_entry");
  await editorial("save_entry", {
    entry_id: work.entries[0].id,
    entry_revision: work.entries[0].revision,
    title: "Capítulo",
    content: "Texto publicado",
  });
  work = (
    await rpc("publish_private_work", [
      work.id,
      work.revision,
      "publish",
      randomUUID(),
    ])
  ).work;
  await role(d);
  await denied(() =>
    member("report", {
      kind: "work",
      target_id: work.id,
      category: "abuse",
      description: "Não pode usar UUID privado",
    }),
  );
  const report = await member("report", {
    kind: "work",
    target_id: work.public_id,
    category: "abuse",
    description: "Descrição de teste público",
  });
  assert.equal(
    (
      await member("report", {
        kind: "work",
        target_id: work.public_id,
        category: "abuse",
        description: "Mesmo caso, sem duplicar",
      })
    ).id,
    report.id,
  );
  // Source is the explicit PL/pgSQL variable, never a nonexistent report column.
  assert.deepEqual(
    await member("decisions", { id: report.id, source: "center" }),
    [],
  );
  for (const source of ["social", "invalid", null]) {
    await denied(() => member("decisions", { id: report.id, source }));
    await denied(() =>
      member("create_ticket", {
        title: "Origem inválida",
        category: "appeal",
        body: "Pedido com origem incorreta.",
        case_id: report.id,
        case_source: source,
      }),
    );
  }
  await denied(() =>
    member("create_ticket", {
      title: "Processo em falta",
      category: "appeal",
      body: "Origem sem processo associado.",
      case_source: "center",
    }),
  );
  await member("create_ticket", {
    title: "Denúncia própria",
    category: "appeal",
    body: "Acompanhar a denúncia apresentada.",
    case_id: report.id,
    case_source: "center",
  });
  await role(b);
  await denied(() => member("decisions", { id: report.id, source: "center" }));
  await denied(() =>
    member("create_ticket", {
      title: "Processo alheio",
      category: "appeal",
      body: "Não pode associar processo alheio.",
      case_id: report.id,
      case_source: "center",
    }),
  );
  await role(a);
  await admin("classify_report", {
    id: report.id,
    source: "center",
    category: "other",
  });
  await admin("decide_report", {
    id: report.id,
    source: "center",
    decision: "restrict_work",
    reason: "Decisão fundamentada de teste",
  });
  await role(null);
  assert.equal(await rpc("read_public_work", [work.public_id]), null);
  await role(c);
  await denied(() =>
    rpc("publish_private_work", [
      work.id,
      work.revision,
      "publish",
      randomUUID(),
    ]),
  );
  await editorial("save_entry", {
    entry_id: work.entries[0].id,
    entry_revision: work.entries[0].revision,
    title: "Capítulo",
    content: "Alteração privada sob revisão",
  });
  assert.equal(
    (await member("decisions", { id: report.id, source: "center" })).length,
    1,
  );
  await member("create_ticket", {
    title: "Pedido de revisão",
    category: "appeal",
    body: "Gostaria de solicitar revisão.",
    case_id: report.id,
    case_source: "center",
  });
  await role(d);
  assert.equal((await member("reports")).length, 1);
  assert.equal(
    (await member("decisions", { id: report.id, source: "center" })).length,
    1,
  );
  await role(b);
  await admin("decide_report", {
    id: report.id,
    source: "center",
    decision: "restore_work",
    reason: "Restauro revisto pela administração",
  });
  assert.equal(
    (await rpc("read_public_work", [work.public_id])).entries[0].content,
    "Texto publicado",
  );
  // Campaign scheduling, public projection, legal approval and optimistic revision.
  const campaign = await admin("save_item", {
    kind: "campaign",
    slug: "campanha-teste",
    title: "Campanha de teste",
    body: "Texto verificado",
    state: "draft",
  });
  await role(null);
  assert.deepEqual(await rpc("center_public", ["campaign"]), []);
  await role(a);
  await admin("save_item", {
    id: campaign.id,
    revision: 1,
    kind: "campaign",
    slug: "campanha-teste",
    title: "Campanha de teste",
    body: "Texto verificado",
    state: "published",
  });
  await denied(() =>
    admin("save_item", {
      id: campaign.id,
      revision: 1,
      kind: "campaign",
      slug: "campanha-teste",
      title: "Desatualizada",
      body: "Não deve guardar",
      state: "draft",
    }),
  );
  await role(null);
  assert.equal(
    (await rpc("center_public", ["campaign"]))[0].title,
    "Campanha de teste",
  );
  assert.ok(!("approved_by" in (await rpc("center_public", ["campaign"]))[0]));
  await role(a);
  await denied(() =>
    admin("save_item", {
      kind: "policy",
      slug: "termos",
      title: "Minuta de termos",
      body: "Texto não aprovado",
      state: "published",
    }),
  );
  await admin("save_item", {
    kind: "policy",
    slug: "termos",
    title: "Minuta de termos",
    body: "Texto não aprovado",
    state: "draft",
  });
  await denied(() =>
    admin("save_item", {
      kind: "status",
      slug: "status-1",
      title: "Estado manual",
      body: "Informação não confirmada",
      state: "published",
    }),
  );
  await role(null);
  assert.deepEqual(await rpc("center_public", ["policy"]), []);
  assert.deepEqual(await rpc("center_public", ["status"]), []);
  // Official announcements: opt-in required, exactly once per recipient, no social notifications generated.
  await role(c);
  await member("set_preferences", { official: true });
  await role(a);
  const broadcast = await admin("create_broadcast", {
    title: "Comunicado oficial",
    body: "Atualização institucional real.",
    audience: "opted_in",
  });
  const sendOp = randomUUID();
  assert.equal(
    (await admin("dispatch_broadcast", { id: broadcast.id }, sendOp)).delivered,
    1,
  );
  assert.equal(
    (await admin("dispatch_broadcast", { id: broadcast.id }, sendOp)).delivered,
    1,
  );
  assert.equal(
    (await admin("dispatch_broadcast", { id: broadcast.id })).delivered,
    0,
  );
  await role(c);
  const notices = await member("notifications");
  assert.equal(notices.filter((n) => n.kind === "official").length, 1);
  await role(d);
  assert.equal(
    (await member("notifications")).filter((n) => n.kind === "official").length,
    0,
  );

  // Additional moderation data is retained in full, with explicit concurrency control.
  await role(c);
  const commentId = (
    await rpc("mutate_social", [
      work.public_id,
      null,
      "comment",
      { body: "Comentário público para teste" },
      randomUUID(),
    ])
  ).comment_id;
  await role(d);
  const description = "Evidência de teste. ".repeat(100);
  const detailed = await member("report", {
    kind: "comment",
    target_id: commentId,
    category: "abuse",
    description,
  });
  await role(a);
  const queued = (await admin("reports")).find(
    (r) => r.id === detailed.id && r.source === "social",
  );
  assert.equal(queued.description, description.trim());
  await admin("classify_report", {
    id: detailed.id,
    source: "social",
    category: "other",
  });
  await role(b);
  await denied(() =>
    admin("decide_report", {
      id: detailed.id,
      source: "social",
      revision: queued.revision,
      expected_status: queued.status,
      decision: "hide_comment",
      reason: "Decisão antiga não deve passar",
    }),
  );
  await admin("decide_report", {
    id: detailed.id,
    source: "social",
    decision: "hide_comment",
    reason: "Ocultação fundamentada em teste",
  });
  await role(d);
  assert.equal(
    (await member("decisions", { id: detailed.id, source: "social" })).length,
    1,
  );
  await member("create_ticket", {
    title: "Rever comentário",
    category: "appeal",
    body: "Acompanhar a decisão do comentário.",
    case_id: detailed.id,
    case_source: "social",
  });
  for (const source of ["center", "invalid", null]) {
    await denied(() => member("decisions", { id: detailed.id, source }));
    await denied(() =>
      member("create_ticket", {
        title: "Origem trocada",
        category: "appeal",
        body: "Não associar processo de outro tipo.",
        case_id: detailed.id,
        case_source: source,
      }),
    );
  }
  await role(c); // The subject of the decision may appeal their own moderation case.
  assert.equal(
    (await member("decisions", { id: detailed.id, source: "social" })).length,
    1,
  );
  await member("create_ticket", {
    title: "Contestar decisão",
    category: "appeal",
    body: "Revisão da decisão sobre o meu comentário.",
    case_id: detailed.id,
    case_source: "social",
  });
  await role(a); // Moderator status alone grants no member-level case access.
  await denied(() =>
    member("decisions", { id: detailed.id, source: "social" }),
  );
  await denied(() =>
    member("create_ticket", {
      title: "Caso de terceiro",
      category: "appeal",
      body: "Sem acesso fora do painel administrativo.",
      case_id: detailed.id,
      case_source: "social",
    }),
  );
  await role(null);
  assert.equal(
    (
      await rpc("read_social_comments", [work.public_id, null, null, null, 20])
    )[0].body,
    "",
  );
  // Drafts/schedules never leak and only explicit legal approval makes a policy public.
  await role(a);
  const policy = (await admin("items", { kind: "policy" }))[0];
  await admin("save_item", {
    id: policy.id,
    revision: policy.revision,
    kind: "policy",
    slug: "termos",
    title: "Termos de teste aprovados",
    body: "Revisão jurídica simulada exclusivamente no teste local.",
    state: "published",
    legal_approved: true,
  });
  await admin("save_item", {
    kind: "campaign",
    slug: "futura",
    title: "Campanha futura",
    body: "Ainda não deve aparecer",
    state: "published",
    starts_at: new Date(Date.now() + 86400000).toISOString(),
  });
  await admin("save_item", {
    kind: "campaign",
    slug: "expirada",
    title: "Campanha expirada",
    body: "Já não deve aparecer",
    state: "published",
    starts_at: new Date(Date.now() - 86400000).toISOString(),
    ends_at: new Date(Date.now() - 3600000).toISOString(),
  });
  await denied(() =>
    admin("save_item", {
      kind: "campaign",
      slug: "imagem-privada",
      title: "Imagem sem permissão",
      body: "Não pode ser servida",
      state: "draft",
      image_publication: work.id,
      image_asset: randomUUID(),
      image_permission: true,
    }),
  );
  await role(null);
  assert.equal(
    (await rpc("center_public", ["policy"]))[0].title,
    "Termos de teste aprovados",
  );
  assert.equal((await rpc("center_public", ["campaign"])).length, 1);
  // Bulk delivery is bounded and replay-safe beyond one page.
  await db.exec("RESET ROLE");
  for (let i = 0; i < 121; i++) {
    const id = randomUUID();
    await db.query("INSERT INTO auth.users(id) VALUES($1)", [id]);
    await db.query(
      "INSERT INTO public.center_preferences(user_id,official) VALUES($1,true)",
      [id],
    );
  }
  await role(a);
  const bulk = await admin("create_broadcast", {
      title: "Comunicado em lotes",
      body: "Mensagem de teste para contas optantes",
      audience: "opted_in",
    }),
    batchOp = randomUUID();
  const firstBatch = await admin(
    "dispatch_broadcast",
    { id: bulk.id },
    batchOp,
  );
  assert.equal(firstBatch.delivered, 100);
  assert.equal(firstBatch.done, false);
  assert.equal(
    (await admin("dispatch_broadcast", { id: bulk.id }, batchOp)).delivered,
    100,
  );
  const lastBatch = await admin("dispatch_broadcast", { id: bulk.id });
  assert.equal(lastBatch.delivered, 22);
  assert.equal(lastBatch.done, true);
  assert.equal(
    (await admin("dispatch_broadcast", { id: bulk.id })).delivered,
    0,
  );
  await denied(() => db.query("SELECT * FROM public.center_administrators"));
  await role(a);
  await denied(() => rpc("center_is_admin"));
  await denied(() =>
    rpc("center_notify", [d, "official", "spoof", "Spoof", "Spoof", {}]),
  );
  await db.exec("RESET ROLE");
  const exposed = (
    await db.query(
      "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(p.proacl) acl WHERE n.nspname='public' AND (p.proname LIKE 'center_%' OR p.proname IN ('admin_console','read_admin_bootstrap')) AND acl.grantee=0 AND acl.privilege_type='EXECUTE'",
    )
  ).rows;
  assert.equal(exposed.length, 0);
  await role(d);
  for (const table of [
    "center_administrators",
    "center_audit",
    "center_operations",
    "center_reports",
    "center_tickets",
    "center_notifications",
    "center_items",
    "center_item_versions",
    "center_report_queue",
  ])
    await denied(() => db.query("SELECT * FROM public." + table));
  await role(a);
  assert.ok((await admin("audit")).length > 0);
  await db.exec("RESET ROLE");
  await assert.rejects(
    db.query(
      "INSERT INTO public.center_administrators(slot,user_id) VALUES(3,$1)",
      [d],
    ),
  );
  console.log(
    "PASS F5.2 SQL: two-UUID registry independent of extra moderators/usernames; live session revocation; hostile default grants/RLS; private support/replies; duplicate reports; moderation and publication blocking; appeals; campaign schedule/revisions; legal drafts; opt-in official notices/idempotence; audit and no direct access.",
  );
} finally {
  await db.close();
}
