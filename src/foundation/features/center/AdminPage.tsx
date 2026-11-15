import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { NotFound } from "../../pages/States";
import { Button, Field, Select } from "../../components/ui";
import {
  AdminNotFound,
  createAdminRepository,
  centerLabel,
  type AdminRepository,
  type CenterItem,
  type Ticket,
  type CenterMessage,
} from "./repository";
import { InstitutionalCard } from "./PublicCenter";
import { ReplyForm } from "./MemberCenter";
const labels: Record<string, string> = {
  users: "Utilizadores",
  registrations_7d: "Cadastros em 7 dias",
  registrations_30d: "Cadastros em 30 dias",
  works: "Obras guardadas",
  publications: "Publicações acessíveis",
  consented_views: "Visualizações consentidas",
  chapter_reads: "Leituras consentidas de capítulos",
  likes: "Curtidas",
  favorites: "Favoritos",
  comments: "Comentários visíveis",
  author_follows: "Seguimentos de escritores",
  work_follows: "Seguimentos de obras",
  open_reports: "Denúncias abertas",
  open_tickets: "Pedidos de suporte abertos",
};
const blank = () => ({
  kind: "campaign",
  slug: "",
  title: "",
  body: "",
  state: "draft",
  severity: "information",
  starts_at: "",
  ends_at: "",
  image_publication: "",
  image_asset: "",
  image_permission: false,
  legal_approved: false,
  verified: false,
  id: undefined as string | undefined,
  revision: undefined as number | undefined,
});
export default function AdminPage({
  repository,
}: {
  repository?: AdminRepository;
}) {
  const { state } = useAuth();
  if (state.status === "initializing")
    return <p role="status">A confirmar sessão…</p>;
  if (!state.user) return <NotFound />;
  return (
    <AdminContent
      key={state.user.id}
      owner={state.user.id}
      injected={repository}
    />
  );
}
function AdminContent({
  owner,
  injected,
}: {
  owner: string;
  injected?: AdminRepository;
}) {
  const repo = useMemo(
    () => injected ?? createAdminRepository(undefined, owner),
    [injected, owner],
  );
  const [authorized, setAuthorized] = useState(false),
    [denied, setDenied] = useState(false),
    [tab, setTab] = useState("dashboard"),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [more, setMore] = useState(false),
    [filter, setFilter] = useState("");
  const [editor, setEditor] = useState(blank),
    [selected, setSelected] = useState<Ticket | null>(null),
    [messages, setMessages] = useState<CenterMessage[]>([]),
    [messageMore, setMessageMore] = useState(false),
    [status, setStatus] = useState("awaiting_user"),
    [versions, setVersions] = useState<any[] | null>(null),
    [broadcastTitle, setBroadcastTitle] = useState(""),
    [broadcastBody, setBroadcastBody] = useState(""),
    [audience, setAudience] = useState("opted_in"),
    [recipients, setRecipients] = useState("");
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    repo.call("bootstrap").then(
      () => {
        if (active) setAuthorized(true);
      },
      (e) => {
        if (active) {
          if (e instanceof AdminNotFound) setDenied(true);
          else setError(e.message);
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [repo]);
  useEffect(() => {
    if (!authorized) return;
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    repo
      .call(
        tab,
        filter ? (tab === "items" ? { kind: filter } : { status: filter }) : {},
      )
      .then(
        (r) => {
          if (
            tab === "dashboard" &&
            (!r ||
              Array.isArray(r) ||
              Object.keys(labels).some(
                (key) => !Number.isSafeInteger(r[key]) || r[key] < 0,
              ) ||
              !Number.isFinite(Date.parse(r.as_of)))
          )
            throw Error("Resposta administrativa inválida.");
          if (tab !== "dashboard" && !Array.isArray(r))
            throw Error("Resposta administrativa inválida.");
          if (active) {
            setData(r);
            setMore(
              Array.isArray(r) && r.length === (tab === "audit" ? 25 : 20),
            );
          }
        },
        (e) => {
          if (active) {
            if (e instanceof AdminNotFound) setDenied(true);
            else setError(e.message);
          }
        },
      )
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authorized, repo, tab, filter, retry]);
  async function execute(action: string, payload: Record<string, unknown>) {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await repo.call(action, payload, true);
      if (alive.current) {
        setNotice(
          `Operação confirmada.${result.delivered !== undefined ? ` ${result.delivered} notificações entregues neste lote.${result.done ? " Envio concluído." : " Existem destinatários pendentes."}` : ""}`,
        );
        setRetry((v) => v + 1);
      }
      return result;
    } catch (e) {
      if (alive.current) {
        if (e instanceof AdminNotFound) setDenied(true);
        else setError((e as Error).message);
      }
      return null;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function openTicket(ticket: Ticket) {
    setSelected(ticket);
    setMessages([]);
    try {
      const r = await repo.call<CenterMessage[]>("messages", { id: ticket.id });
      if (alive.current) {
        setMessages(r);
        setMessageMore(r.length === 30);
      }
    } catch (e) {
      if (e instanceof AdminNotFound) setDenied(true);
      else setError((e as Error).message);
    }
  }
  if (denied) return <NotFound />;
  if (!authorized)
    return error ? (
      <div className="container">
        <p role="alert">{error}</p>
        <Button onClick={() => window.location.reload()}>
          Tentar novamente
        </Button>
      </div>
    ) : (
      <p role="status">A verificar autorização administrativa…</p>
    );
  return (
    <div className="container discovery-page center-admin">
      <h1>Centro Administrativo</h1>
      <p>
        Operações verificadas no servidor. As alterações e decisões ficam
        auditadas.
      </p>
      <nav className="actions" aria-label="Secções administrativas">
        {Object.entries({
          dashboard: "Dashboard",
          reports: "Denúncias",
          tickets: "Suporte",
          items: "Campanhas e informação",
          broadcasts: "Comunicados",
          audit: "Auditoria",
        }).map(([value, label]) => (
          <Button
            key={value}
            variant={tab === value ? "primary" : "secondary"}
            disabled={busy}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value);
              setFilter("");
              setSelected(null);
              setVersions(null);
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
      <Button
        variant="secondary"
        disabled={loading || busy}
        onClick={() => setRetry((v) => v + 1)}
      >
        Atualizar
      </Button>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <Button disabled={busy} onClick={() => setRetry((v) => v + 1)}>
            Atualizar dados
          </Button>
        </p>
      )}
      {loading && <p role="status">A carregar dados administrativos…</p>}
      {tab === "dashboard" && data && !Array.isArray(data) && (
        <>
          <dl className="center-grid">
            {Object.entries(labels).map(([key, label]) => (
              <div className="panel" key={key}>
                <dt>{label}</dt>
                <dd>{data[key]}</dd>
              </div>
            ))}
          </dl>
          <p>
            Dados reais em {new Date(data.as_of).toLocaleString("pt-PT")}.
            Contagens de obras privadas são agregadas; textos privados e dados
            de autenticação não são apresentados.
          </p>
        </>
      )}
      {tab === "reports" && (
        <>
          <Select
            label="Estado da denúncia"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">Todos</option>
            {["new", "reviewing", "actioned", "dismissed"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <ul className="center-list">
            {(Array.isArray(data) ? data : []).map((r: any) => (
              <li key={`${r.source}:${r.id}`}>
                <h2>
                  {r.target_kind} · {r.id}
                </h2>
                <p>
                  Categoria: {r.category} · Estado: {centerLabel(r.status)}
                </p>
                <p className="center-text">{r.description}</p>
                <div className="actions">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      const category = window.prompt(
                        "Categoria: spam, abuse, copyright, privacy ou other",
                        r.category,
                      );
                      if (category)
                        void execute("classify_report", {
                          id: r.id,
                          source: r.source,
                          revision: r.revision,
                          expected_status: r.status,
                          category,
                        });
                    }}
                  >
                    Classificar e analisar
                  </Button>
                  {[
                    "no_action",
                    "warn",
                    ...(r.target_kind === "comment"
                      ? ["hide_comment", "restore_comment"]
                      : r.target_kind === "work"
                        ? ["restrict_work", "restore_work"]
                        : []),
                  ].map((decision) => (
                    <Button
                      key={decision}
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(
                          `Fundamentação da decisão ${decision} (10 a 2000 caracteres). Será comunicada às partes autorizadas.`,
                        );
                        if (
                          reason &&
                          window.confirm(
                            "Confirmar a decisão e comunicar às partes?",
                          )
                        )
                          void execute("decide_report", {
                            id: r.id,
                            source: r.source,
                            revision: r.revision,
                            expected_status: r.status,
                            decision,
                            reason,
                          });
                      }}
                    >
                      {
                        (
                          {
                            no_action: "Sem ação",
                            warn: "Advertir",
                            hide_comment: "Ocultar comentário",
                            restore_comment: "Restaurar comentário",
                            restrict_work: "Restringir publicação",
                            restore_work: "Restaurar publicação",
                          } as Record<string, string>
                        )[decision]
                      }
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === "tickets" && (
        <>
          <Select
            label="Estado do suporte"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">Todos</option>
            {["open", "reviewing", "awaiting_user", "resolved", "closed"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </Select>
          <ul className="center-list">
            {(Array.isArray(data) ? data : []).map((t: Ticket) => (
              <li key={t.id}>
                <h2>{t.title}</h2>
                <p>
                  {t.category} · {centerLabel(t.status)} · {t.id}
                </p>
                <Button onClick={() => void openTicket(t)}>
                  Abrir conversa
                </Button>
              </li>
            ))}
          </ul>
          {selected && (
            <section className="panel">
              <h2>{selected.title}</h2>
              {messages.map((m) => (
                <article key={m.id}>
                  <strong>
                    {m.administrative ? "Administração" : "Utilizador"}
                  </strong>
                  <p className="center-text">{m.body}</p>
                </article>
              ))}
              {messageMore && (
                <Button
                  onClick={async () => {
                    const last = messages.at(-1)!;
                    try {
                      const next = await repo.call<CenterMessage[]>(
                        "messages",
                        {
                          id: selected.id,
                          after: last.created_at,
                          after_id: last.id,
                        },
                      );
                      setMessageMore(next.length === 30);
                      setMessages((prev) => [
                        ...new Map(
                          [...prev, ...next].map((m) => [m.id, m]),
                        ).values(),
                      ]);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Mais mensagens
                </Button>
              )}
              <Select
                label="Estado após resposta"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {[
                  "open",
                  "reviewing",
                  "awaiting_user",
                  "resolved",
                  "closed",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
              <ReplyForm
                disabled={busy}
                submit={async (body) => {
                  const result = await execute("reply_ticket", {
                    id: selected.id,
                    body,
                    status,
                  });
                  if (result) {
                    await openTicket(selected);
                    return true;
                  }
                  return false;
                }}
              />
            </section>
          )}
        </>
      )}
      {tab === "items" && (
        <>
          <Select
            label="Tipo de conteúdo"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">Todos</option>
            {["campaign", "notice", "update", "status", "policy"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Button variant="secondary" onClick={() => setEditor(blank())}>
            Novo conteúdo
          </Button>
          <ul className="center-list">
            {(Array.isArray(data) ? data : []).map((item: CenterItem) => (
              <li key={item.id}>
                <h2>{item.title}</h2>
                <p>
                  {centerLabel(item.kind)} ·{" "}
                  {centerLabel(item.state ?? "draft")} · revisão {item.revision}
                </p>
                <Button
                  onClick={() =>
                    setEditor({
                      ...blank(),
                      ...item,
                      image_publication: item.image_publication ?? "",
                      image_asset: item.image_asset ?? "",
                      image_permission: !!item.image_permission,
                      legal_approved: false,
                      starts_at: item.starts_at.slice(0, 16),
                      ends_at: item.ends_at?.slice(0, 16) ?? "",
                      verified: false,
                    } as ReturnType<typeof blank>)
                  }
                >
                  Editar / pré-visualizar
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void repo
                      .call<any[]>("versions", { id: item.id })
                      .then(setVersions)
                      .catch((e) => setError(e.message))
                  }
                >
                  Histórico
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="panel center-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                editor.state === "published" &&
                !window.confirm(
                  "Confirmar publicação/agendamento desta versão? Políticas exigem revisão e autorização jurídica explícitas.",
                )
              )
                return;
              const result = await execute("save_item", {
                ...editor,
                starts_at: editor.starts_at
                  ? new Date(editor.starts_at + "Z").toISOString()
                  : null,
                ends_at: editor.ends_at
                  ? new Date(editor.ends_at + "Z").toISOString()
                  : null,
              });
              if (result)
                setEditor((prev) => ({
                  ...prev,
                  id: result.id,
                  revision: result.revision,
                }));
            }}
          >
            <h2>{editor.id ? "Editar conteúdo" : "Criar conteúdo"}</h2>
            <Select
              label="Natureza"
              disabled={!!editor.id}
              value={editor.kind}
              onChange={(e) =>
                setEditor({
                  ...editor,
                  kind: e.target.value,
                  legal_approved: false,
                })
              }
            >
              {["campaign", "notice", "update", "status", "policy"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            <Field
              label="Identificador de URL (slug)"
              required
              pattern="[a-z0-9][a-z0-9-]{0,79}"
              value={editor.slug}
              onChange={(e) => setEditor({ ...editor, slug: e.target.value })}
            />
            <Field
              label="Título"
              required
              minLength={3}
              maxLength={160}
              value={editor.title}
              onChange={(e) =>
                setEditor({
                  ...editor,
                  title: e.target.value,
                  legal_approved: false,
                })
              }
            />
            <label className="field">
              <span>Descrição / conteúdo em texto</span>
              <textarea
                required
                maxLength={12000}
                value={editor.body}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    body: e.target.value,
                    legal_approved: false,
                    verified: false,
                  })
                }
              />
            </label>
            <Select
              label="Estado"
              value={editor.state}
              onChange={(e) => setEditor({ ...editor, state: e.target.value })}
            >
              {["draft", "published", "withdrawn"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            <Select
              label="Classificação do aviso"
              value={editor.severity}
              onChange={(e) =>
                setEditor({ ...editor, severity: e.target.value })
              }
            >
              {[
                "information",
                "operational",
                "degraded",
                "outage",
                "maintenance",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            <Field
              type="datetime-local"
              label="Início (UTC; vazio = agora)"
              value={editor.starts_at}
              onChange={(e) =>
                setEditor({ ...editor, starts_at: e.target.value })
              }
            />
            <Field
              type="datetime-local"
              label="Fim (UTC, opcional)"
              value={editor.ends_at}
              onChange={(e) =>
                setEditor({ ...editor, ends_at: e.target.value })
              }
            />
            <Field
              label="Imagem opcional: UUID de uma publicação com capa pública"
              value={editor.image_publication}
              onChange={(e) =>
                setEditor({
                  ...editor,
                  image_publication: e.target.value,
                  image_permission: false,
                })
              }
            />
            <Field
              label="UUID do asset dessa capa pública"
              value={editor.image_asset}
              onChange={(e) =>
                setEditor({
                  ...editor,
                  image_asset: e.target.value,
                  image_permission: false,
                })
              }
            />
            <label>
              <input
                type="checkbox"
                checked={editor.image_permission}
                onChange={(e) =>
                  setEditor({ ...editor, image_permission: e.target.checked })
                }
              />{" "}
              Confirmei autorização para reutilizar esta imagem pública
            </label>
            <label>
              <input
                type="checkbox"
                checked={editor.verified}
                onChange={(e) =>
                  setEditor({ ...editor, verified: e.target.checked })
                }
              />{" "}
              Verifiquei a informação deste aviso/estado
            </label>
            {editor.kind === "policy" && (
              <label>
                <input
                  type="checkbox"
                  checked={editor.legal_approved}
                  onChange={(e) =>
                    setEditor({ ...editor, legal_approved: e.target.checked })
                  }
                />{" "}
                Confirmo revisão jurídica concluída e autorização para publicar
                esta versão
              </label>
            )}
            <Button disabled={busy}>Guardar versão</Button>
          </form>
          <InstitutionalCard
            preview
            item={{
              ...editor,
              id: editor.id ?? "preview",
              updated_at: new Date().toISOString(),
              verified_at: null,
              image: editor.image_permission
                ? {
                    publication: editor.image_publication,
                    asset: editor.image_asset,
                  }
                : null,
            }}
          />
          {versions && (
            <section>
              <h2>Histórico de versões</h2>
              {versions.map((v) => (
                <details key={v.revision}>
                  <summary>
                    Revisão {v.revision} · {v.created_at}
                  </summary>
                  <p className="center-text">{v.snapshot.body}</p>
                </details>
              ))}
            </section>
          )}
        </>
      )}
      {tab === "broadcasts" && (
        <>
          <form
            className="center-form panel"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await execute("create_broadcast", {
                title: broadcastTitle,
                body: broadcastBody,
                audience,
                recipients:
                  audience === "selected"
                    ? [...new Set(recipients.split(/[\s,]+/).filter(Boolean))]
                    : [],
              });
              if (result) {
                setBroadcastTitle("");
                setBroadcastBody("");
                setRecipients("");
              }
            }}
          >
            <h2>Preparar comunicado oficial</h2>
            <Field
              label="Título do comunicado"
              minLength={3}
              maxLength={160}
              required
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
            />
            <label className="field">
              <span>Mensagem</span>
              <textarea
                required
                maxLength={8000}
                value={broadcastBody}
                onChange={(e) => setBroadcastBody(e.target.value)}
              />
            </label>
            <Select
              label="Destinatários autorizados"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            >
              <option value="opted_in">
                Contas que optaram por comunicados
              </option>
              <option value="selected">
                UUIDs selecionados, com preferência ativa
              </option>
            </Select>
            {audience === "selected" && (
              <Field
                label="UUIDs separados por vírgulas (máximo 100)"
                required
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
            )}
            <p>
              A criação prepara um rascunho. O envio é confirmado separadamente,
              até 100 destinatários por lote. Não inclui notificações sociais.
            </p>
            <Button disabled={busy}>Preparar comunicado</Button>
            <aside className="panel">
              <h3>{broadcastTitle || "Pré-visualização do título"}</h3>
              <p className="center-text">
                {broadcastBody || "A mensagem aparecerá aqui antes do envio."}
              </p>
            </aside>
          </form>
          <ul className="center-list">
            {(Array.isArray(data) ? data : []).map((b: any) => (
              <li key={b.id}>
                <h2>{b.title}</h2>
                <p className="center-text">{b.body}</p>
                <p>
                  {b.sent_at ? "Envio concluído" : "Envio pendente"} ·{" "}
                  {b.delivered} entregues · {b.audience}
                </p>
                <Button
                  disabled={busy || !!b.sent_at}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Enviar o próximo lote aos destinatários elegíveis?",
                      )
                    )
                      void execute("dispatch_broadcast", { id: b.id });
                  }}
                >
                  Enviar próximo lote
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === "audit" && (
        <ul className="center-list">
          {(Array.isArray(data) ? data : []).map((r: any) => (
            <li key={r.id}>
              <strong>{r.action}</strong> · {r.actor ?? "Gestão técnica"} ·{" "}
              {r.created_at}
              <p>Referência: {r.target_id ?? "sem objeto"}</p>
              <pre className="center-text">
                {JSON.stringify(r.details, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      )}
      {!loading && Array.isArray(data) && !data.length && (
        <p>Nenhum registo nesta seleção.</p>
      )}
      {more && (
        <Button
          disabled={loading || busy}
          onClick={async () => {
            setLoading(true);
            try {
              const last = data.at(-1),
                next = await repo.call<any[]>(tab, {
                  ...(filter
                    ? tab === "items"
                      ? { kind: filter }
                      : { status: filter }
                    : {}),
                  before: last.updated_at ?? last.created_at,
                  before_id: last.id,
                });
              setData((prev: any[]) => [
                ...new Map(
                  [...prev, ...next].map((r) => [
                    `${r.source ?? ""}:${r.id}`,
                    r,
                  ]),
                ).values(),
              ]);
              setMore(next.length === (tab === "audit" ? 25 : 20));
            } catch (e) {
              if (e instanceof AdminNotFound) setDenied(true);
              else setError((e as Error).message);
            } finally {
              setLoading(false);
            }
          }}
        >
          Carregar mais registos
        </Button>
      )}
    </div>
  );
}
