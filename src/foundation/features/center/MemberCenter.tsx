import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Field, Select } from "../../components/ui";
import { useAuth } from "../auth/AuthProvider";
import {
  createCenterRepository,
  centerLabel,
  type CenterMessage,
  type Ticket,
  type OfficialNotification,
  type CenterRepository,
} from "./repository";
export function MemberCenter({
  mode,
  repository,
}: {
  mode: "support" | "reports" | "notifications";
  repository?: CenterRepository;
}) {
  const { state } = useAuth();
  const [routeParams] = useSearchParams();
  if (state.status === "initializing")
    return <p role="status">A confirmar sessão…</p>;
  return state.user ? (
    <MemberContent
      key={`${mode}:${state.user.id}:${routeParams.toString()}`}
      mode={mode}
      owner={state.user.id}
      injected={repository}
    />
  ) : (
    <div className="container">
      <h1>
        {mode === "support"
          ? "Suporte"
          : mode === "reports"
            ? "Denunciar conteúdo"
            : "Notificações"}
      </h1>
      <p>
        <Link to="/entrar">Inicia sessão</Link> para enviar e acompanhar pedidos
        privados.
      </p>
      <Link to="/contacto">Contacto sem conta</Link>
    </div>
  );
}
function MemberContent({
  mode,
  owner,
  injected,
}: {
  mode: "support" | "reports" | "notifications";
  owner: string;
  injected?: CenterRepository;
}) {
  const repo = useMemo(
    () => injected ?? createCenterRepository(undefined, owner),
    [injected, owner],
  );
  const [params] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]),
    [messages, setMessages] = useState<CenterMessage[]>([]),
    [messageMore, setMessageMore] = useState(false),
    [selected, setSelected] = useState<Ticket | null>(null),
    [decisions, setDecisions] = useState<any[] | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [official, setOfficial] = useState<boolean | null>(null),
    [retry, setRetry] = useState(0),
    [more, setMore] = useState(false);
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [category, setCategory] = useState(
      mode === "reports"
        ? "other"
        : params.get("categoria") === "appeal"
          ? "appeal"
          : "technical",
    ),
    [kind, setKind] = useState(params.get("tipo") ?? "work"),
    [target, setTarget] = useState(params.get("id") ?? ""),
    [caseId, setCaseId] = useState(params.get("caso") ?? ""),
    [caseSource, setCaseSource] = useState(params.get("origem") ?? "center");
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const action =
    mode === "support"
      ? "tickets"
      : mode === "reports"
        ? "reports"
        : "notifications";
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    repo
      .member<any[]>(action)
      .then(
        (r) => {
          if (!Array.isArray(r)) throw Error("Resposta inválida.");
          if (active) {
            setRows(r);
            setMore(r.length === 20);
          }
        },
        (e) => {
          if (active) setError(e.message);
        },
      )
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    if (mode === "notifications")
      void repo
        .member<{ official: boolean }>("preferences")
        .then((p) => {
          if (active) setOfficial(p.official);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [repo, action, retry, mode]);
  useEffect(() => {
    const id = params.get("pedido");
    if (mode !== "support" || !id) return;
    let active = true;
    repo
      .member<Ticket>("ticket", { id })
      .then((ticket) => {
        if (active) void open(ticket);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [repo, mode, params.toString()]);
  async function write(action: string, payload: Record<string, unknown>) {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await repo.member(action, payload, true);
      if (alive.current) {
        setNotice("Pedido confirmado pelo servidor.");
        setRetry((v) => v + 1);
      }
      return result;
    } catch (e) {
      if (alive.current) setError((e as Error).message);
      return null;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function open(ticket: Ticket) {
    setSelected(ticket);
    setMessages([]);
    setError("");
    try {
      const result = await repo.member<CenterMessage[]>("messages", {
        id: ticket.id,
      });
      if (alive.current) {
        setMessages(result);
        setMessageMore(result.length === 30);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }
  return (
    <div className="container discovery-page center-member">
      <h1>
        {mode === "support"
          ? "Pedidos de suporte"
          : mode === "reports"
            ? "Denunciar e acompanhar"
            : "Notificações oficiais"}
      </h1>
      <Button
        variant="secondary"
        disabled={loading || busy}
        onClick={() => setRetry((v) => v + 1)}
      >
        Atualizar
      </Button>
      {error && (
        <p role="alert">
          {error}{" "}
          <Button variant="secondary" onClick={() => setRetry((v) => v + 1)}>
            Atualizar pedidos
          </Button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">A carregar…</p>}
      {mode === "notifications" ? (
        <>
          <label>
            <input
              type="checkbox"
              checked={official ?? false}
              disabled={busy || official === null}
              onChange={async (e) => {
                const value = e.target.checked;
                const result = await write("set_preferences", {
                  official: value,
                });
                if (result) setOfficial(value);
              }}
            />{" "}
            Receber comunicados oficiais opcionais
          </label>
          <p>
            Respostas de suporte e decisões sobre os teus pedidos continuam a
            ser entregues como mensagens de serviço.
          </p>
          <ul className="center-list">
            {(rows as OfficialNotification[]).map((n) => (
              <li key={n.id}>
                <article>
                  <h2>{n.title}</h2>
                  {n.context.action && <p>{centerLabel(n.context.action)}</p>}
                  <p className="center-text">{n.body}</p>
                  <p>
                    {n.read_at ? "Lida" : "Não lida"} ·{" "}
                    {new Date(n.created_at).toLocaleString("pt-PT")}
                  </p>
                  {n.context.ticket_id && (
                    <Link to={`/suporte?pedido=${n.context.ticket_id}`}>
                      Abrir suporte
                    </Link>
                  )}
                  {n.context.case_id && (
                    <Link
                      to={`/suporte?categoria=appeal&caso=${n.context.case_id}&origem=${n.context.source}`}
                    >
                      Pedir revisão da decisão
                    </Link>
                  )}
                  {!n.read_at && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void write("read_notification", { id: n.id })
                      }
                    >
                      Marcar como lida
                    </Button>
                  )}
                </article>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <form
            className="center-form panel"
            onSubmit={async (e) => {
              e.preventDefault();
              const payload =
                mode === "reports"
                  ? {
                      kind,
                      target_id: target.trim(),
                      category,
                      description: body.trim(),
                    }
                  : {
                      title: title.trim(),
                      body: body.trim(),
                      category,
                      ...(caseId.trim()
                        ? { case_id: caseId.trim(), case_source: caseSource }
                        : {}),
                    };
              const result = await write(
                mode === "reports" ? "report" : "create_ticket",
                payload,
              );
              if (result) {
                setBody("");
                setTitle("");
                setNotice(
                  `Pedido registado: ${result.id}. ${mode === "reports" ? "Denúncias equivalentes reutilizam o mesmo processo." : "Podes acompanhar o estado abaixo."}`,
                );
              }
            }}
          >
            {mode === "reports" ? (
              <>
                <Select
                  label="Conteúdo denunciado"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="work">Obra publicada</option>
                  <option value="profile">Perfil público</option>
                  <option value="comment">Comentário</option>
                </Select>
                <Field
                  label="Identificador público (UUID)"
                  required
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
                <p>
                  Usa a ligação «Denunciar» da obra/perfil/comentário para
                  preencher o identificador. Não envies passwords, tokens ou
                  documentos pessoais.
                </p>
              </>
            ) : (
              <Field
                label="Assunto"
                required
                minLength={3}
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
            <Select
              label="Categoria"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {(mode === "reports"
                ? [
                    ["spam", "Spam"],
                    ["abuse", "Abuso"],
                    ["copyright", "Direitos de autor"],
                    ["privacy", "Privacidade"],
                    ["other", "Outro"],
                  ]
                : [
                    ["technical", "Problema técnico"],
                    ["account", "Conta"],
                    ["copyright", "Direitos de autor"],
                    ["appeal", "Contestação de moderação"],
                    ["other", "Outro"],
                  ]
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            {mode === "support" && category === "appeal" && (
              <>
                <Field
                  label="Processo relacionado (opcional)"
                  value={caseId}
                  onChange={(e) => setCaseId(e.target.value)}
                />
                <Select
                  label="Origem do processo"
                  value={caseSource}
                  onChange={(e) => setCaseSource(e.target.value)}
                >
                  <option value="center">Obra/perfil</option>
                  <option value="social">Comentário</option>
                </Select>
              </>
            )}
            <label className="field">
              <span>Descrição — inclui apenas os dados necessários</span>
              <textarea
                required
                minLength={10}
                maxLength={mode === "reports" ? 4000 : 8000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <Button disabled={busy}>
              Enviar {mode === "reports" ? "denúncia" : "pedido"}
            </Button>
          </form>
          <h2>
            {mode === "reports" ? "As tuas denúncias" : "Os teus pedidos"}
          </h2>
          <ul className="center-list">
            {rows.map((row) => (
              <li key={`${row.source ?? "ticket"}:${row.id}`}>
                <h3>{row.title ?? `${row.target_kind} · ${row.id}`}</h3>
                <p>
                  Estado: {centerLabel(row.status)} ·{" "}
                  {new Date(row.updated_at ?? row.created_at).toLocaleString(
                    "pt-PT",
                  )}
                </p>
                {mode === "support" ? (
                  <Button variant="secondary" onClick={() => void open(row)}>
                    Abrir conversa
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          setDecisions(
                            await repo.member("decisions", {
                              id: row.id,
                              source: row.source,
                            }),
                          );
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Ver decisões
                    </Button>
                    <Link
                      to={`/suporte?categoria=appeal&caso=${row.id}&origem=${row.source}`}
                    >
                      Solicitar revisão
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
          {decisions && (
            <section aria-label="Decisões do processo">
              <h2>Decisões</h2>
              {!decisions.length && <p>Ainda não há decisões comunicadas.</p>}
              {decisions.map((d) => (
                <article key={d.id}>
                  <h3>{centerLabel(d.action)}</h3>
                  <p className="center-text">{d.reason}</p>
                  <time dateTime={d.created_at}>
                    {new Date(d.created_at).toLocaleString("pt-PT")}
                  </time>
                </article>
              ))}
            </section>
          )}
          {selected && (
            <section className="panel" aria-label="Conversa de suporte">
              <h2>{selected.title}</h2>
              {messages.map((m) => (
                <article key={m.id}>
                  <strong>{m.administrative ? "Administração" : "Tu"}</strong>
                  <p className="center-text">{m.body}</p>
                  <time dateTime={m.created_at}>
                    {new Date(m.created_at).toLocaleString("pt-PT")}
                  </time>
                </article>
              ))}
              {messageMore && (
                <Button
                  onClick={async () => {
                    const last = messages.at(-1)!;
                    try {
                      const next = await repo.member<CenterMessage[]>(
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
              <ReplyForm
                disabled={busy || selected.status === "closed"}
                submit={async (reply) => {
                  const result = await write("reply_ticket", {
                    id: selected.id,
                    body: reply,
                  });
                  if (result) {
                    await open(selected);
                    return true;
                  }
                  return false;
                }}
              />
            </section>
          )}
        </>
      )}
      {!loading && !error && !rows.length && <p>Nenhum registo nesta conta.</p>}
      {more && (
        <Button
          disabled={loading || busy}
          onClick={async () => {
            setLoading(true);
            try {
              const last = rows.at(-1);
              const next = await repo.member<any[]>(action, {
                before: last.updated_at ?? last.created_at,
                before_id: last.id,
              });
              setRows((prev) => [
                ...new Map(
                  [...prev, ...next].map((r) => [
                    `${r.source ?? ""}:${r.id}`,
                    r,
                  ]),
                ).values(),
              ]);
              setMore(next.length === 20);
            } catch (e) {
              setError((e as Error).message);
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
export function ReplyForm({
  disabled,
  submit,
}: {
  disabled: boolean;
  submit: (body: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await submit(body.trim())) setBody("");
      }}
    >
      <label className="field">
        <span>Mensagem</span>
        <textarea
          required
          maxLength={8000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <Button disabled={disabled || !body.trim()}>Enviar resposta</Button>
    </form>
  );
}
