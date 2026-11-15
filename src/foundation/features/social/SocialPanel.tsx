import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui";
import { useAuth } from "../auth/AuthProvider";
import {
  createSocialRepository,
  socialEnabled,
  type SocialAction,
  type SocialComment,
  type SocialState,
  type SocialRepository,
} from "./repository";
import { ReadingMetric } from "./metrics";
export function SocialPanel({
  workId,
  entryId,
  enabled = socialEnabled,
  repository,
}: {
  workId: string;
  entryId?: string;
  enabled?: boolean;
  repository?: SocialRepository;
}) {
  const { state } = useAuth();
  return enabled ? (
    <SocialContent
      key={`${workId}:${entryId}:${state.user?.id ?? "anon"}`}
      workId={workId}
      entryId={entryId}
      userId={state.user?.id}
      repository={repository}
    />
  ) : null;
}
function SocialContent({
  workId,
  entryId,
  userId,
  repository,
}: {
  workId: string;
  entryId?: string;
  userId?: string;
  repository?: SocialRepository;
}) {
  const repo = useMemo(
    () => repository ?? createSocialRepository(undefined, userId),
    [repository, userId],
  );
  const [state, setState] = useState<SocialState | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const [comments, setComments] = useState<SocialComment[]>([]),
    [more, setMore] = useState(false),
    [body, setBody] = useState(""),
    [mode, setMode] = useState<{
      action: "comment" | "edit_comment";
      id?: string;
      reply?: string;
    }>({ action: "comment" });
  const [reports, setReports] = useState<Awaited<
    ReturnType<SocialRepository["reports"]>
  > | null>(null);
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function reload() {
    const [summary, rows] = await Promise.all([
      repo.state(workId, entryId),
      repo.comments(workId, entryId),
    ]);
    if (alive.current) {
      setState(summary);
      setComments(rows);
      setMore(rows.length === 20);
    }
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([repo.state(workId, entryId), repo.comments(workId, entryId)])
      .then(
        ([summary, rows]) => {
          if (active) {
            setState(summary);
            setComments(rows);
            setMore(rows.length === 20);
          }
        },
        (e) => {
          if (active) {
            setState(null);
            setComments([]);
            setError(e.message);
          }
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repo, workId, entryId, retry]);
  async function operate(
    action: SocialAction,
    payload: Record<string, unknown>,
    optimistic?: Partial<SocialState>,
  ) {
    if (lock.current || !userId) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const previous = state;
    if (optimistic && state) setState({ ...state, ...optimistic });
    try {
      await repo.mutate(workId, entryId, action, payload);
      if (!alive.current) return false;
      if (action === "report") setNotice("Denúncia enviada para análise.");
      try {
        await reload();
      } catch {
        if (alive.current)
          setError(
            "Operação confirmada. Não foi possível atualizar as contagens; atualiza as interações.",
          );
      }
      return true;
    } catch (e) {
      if (alive.current) {
        if (optimistic) setState(previous);
        setError(
          e instanceof Error
            ? e.message
            : "Não foi possível guardar a interação.",
        );
      }
      return false;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function loadMore() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const rows = await repo.comments(workId, entryId, comments.at(-1));
      if (alive.current) {
        setComments((prev) => [
          ...new Map([...prev, ...rows].map((c) => [c.id, c])).values(),
        ]);
        setMore(rows.length === 20);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const toggle = (
    action: "like" | "follow" | "saved" | "favorite" | "later",
    key: "liked" | "following" | "saved" | "favorite" | "later",
  ) => {
    if (!state) return;
    const value = !state[key];
    void operate(
      action,
      { value },
      {
        [key]: value,
        ...(action === "like" ? { likes: state.likes + (value ? 1 : -1) } : {}),
        ...(action === "follow"
          ? { followers: state.followers + (value ? 1 : -1) }
          : {}),
      },
    );
  };
  return (
    <section
      className="social-panel"
      aria-label={entryId ? "Interações do capítulo" : "Interações da obra"}
    >
      <h2>{entryId ? "Comunidade do capítulo" : "Comunidade da obra"}</h2>
      {loading && <p role="status">A carregar interações…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button
            variant="secondary"
            onClick={() => setRetry((v) => v + 1)}
            disabled={busy}
          >
            Atualizar interações
          </Button>
        </div>
      )}
      {!loading && state && (
        <>
          <p aria-live="polite">
            {state.likes} curtidas · {state.comments} comentários ·{" "}
            {state.followers} seguidores da obra · {state.views}{" "}
            {entryId ? "leituras" : "visualizações"} · {state.visitors}{" "}
            visitantes únicos estimados
          </p>
          {!userId && (
            <p>
              <Link to="/entrar">Inicia sessão</Link> para curtir, comentar,
              seguir e guardar.
            </p>
          )}
          <div className="actions social-actions">
            <Button
              variant="secondary"
              disabled={busy || !userId}
              aria-pressed={state.liked}
              onClick={() => toggle("like", "liked")}
            >
              {state.liked ? "Retirar curtida" : "Curtir"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !userId}
              aria-pressed={state.following}
              onClick={() => toggle("follow", "following")}
            >
              {state.following ? "Deixar de seguir obra" : "Seguir obra"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !userId}
              aria-pressed={state.saved}
              onClick={() => toggle("saved", "saved")}
            >
              {state.saved ? "Remover da biblioteca" : "Guardar na biblioteca"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !userId}
              aria-pressed={state.favorite}
              onClick={() => toggle("favorite", "favorite")}
            >
              {state.favorite ? "Retirar favorito" : "Favoritar"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !userId}
              aria-pressed={state.later}
              onClick={() => toggle("later", "later")}
            >
              {state.later ? "Retirar de ler depois" : "Ler depois"}
            </Button>
          </div>
          <p className="muted">
            Guardar organiza a biblioteca; favoritar assinala uma preferência.
            Biblioteca e favoritos são privados.
          </p>
          <ReadingMetric
            workId={workId}
            entryId={entryId}
            onCount={() =>
              void reload().catch(() => {
                if (alive.current)
                  setError(
                    "A leitura foi registada; atualiza as interações para recuperar as contagens.",
                  );
              })
            }
          />
          {userId && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!body.trim()) return;
                const ok = await operate(
                  mode.action,
                  mode.action === "edit_comment"
                    ? { comment_id: mode.id, body: body.trim() }
                    : {
                        body: body.trim(),
                        ...(mode.reply ? { parent_id: mode.reply } : {}),
                      },
                );
                if (ok && alive.current) {
                  setBody("");
                  setMode({ action: "comment" });
                }
              }}
            >
              <label className="field">
                <span>
                  {mode.action === "edit_comment"
                    ? "Editar comentário"
                    : mode.reply
                      ? "Responder ao comentário"
                      : "Escrever comentário"}
                </span>
                <textarea
                  required
                  maxLength={4000}
                  value={body}
                  disabled={busy}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <Button disabled={busy || !body.trim()}>
                {mode.action === "edit_comment"
                  ? "Guardar edição"
                  : "Enviar comentário"}
              </Button>
              {(mode.id || mode.reply) && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setBody("");
                    setMode({ action: "comment" });
                  }}
                >
                  Cancelar edição/resposta
                </Button>
              )}
            </form>
          )}
          {!comments.length && <p>Ainda não há comentários.</p>}
          <ol className="social-comments">
            {comments.map((c) => (
              <li key={c.id} id={`comentario-${c.id}`}>
                <article>
                  <header>
                    {c.author_username ? (
                      <Link to={`/utilizadores/${c.author_username}`}>
                        {c.author_name || c.author_username}
                      </Link>
                    ) : (
                      "Conta indisponível"
                    )}{" "}
                    ·{" "}
                    <time dateTime={c.created_at}>
                      {new Date(c.created_at).toLocaleString("pt-PT")}
                    </time>
                    {c.edited_at && " · editado"}
                  </header>
                  {c.parent_id && (
                    <p>
                      Em resposta ao comentário{" "}
                      {comments.some((parent) => parent.id === c.parent_id) ? (
                        <a href={`#comentario-${c.parent_id}`}>
                          {c.parent_id.slice(0, 8)}
                        </a>
                      ) : (
                        <span>
                          anterior ({c.parent_id.slice(0, 8)}), que pode estar
                          noutra página
                        </span>
                      )}
                    </p>
                  )}
                  <p className="social-comment-body">
                    {c.status === "visible"
                      ? c.body
                      : c.status === "hidden"
                        ? "Comentário ocultado pela moderação."
                        : "Comentário removido."}
                  </p>
                  {c.status === "visible" && (
                    <div className="actions">
                      <Button
                        variant="ghost"
                        disabled={!userId || busy}
                        aria-pressed={c.liked}
                        onClick={() =>
                          void operate("comment_like", {
                            comment_id: c.id,
                            value: !c.liked,
                          })
                        }
                      >
                        {c.liked ? "Retirar curtida" : "Curtir comentário"} (
                        {c.likes})
                      </Button>
                      {!c.parent_id && (
                        <Button
                          variant="ghost"
                          disabled={!userId || busy}
                          onClick={() => {
                            setBody("");
                            setMode({ action: "comment", reply: c.id });
                          }}
                        >
                          Responder
                        </Button>
                      )}
                      {c.own && (
                        <>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              setBody(c.body);
                              setMode({ action: "edit_comment", id: c.id });
                            }}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm("Eliminar este comentário?"))
                                void operate("delete_comment", {
                                  comment_id: c.id,
                                });
                            }}
                          >
                            Eliminar comentário
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        disabled={!userId || busy}
                        onClick={() => {
                          const reason = window.prompt(
                            "Motivo da denúncia (3 a 500 caracteres):",
                          );
                          if (reason?.trim())
                            void operate("report", {
                              comment_id: c.id,
                              reason: reason.trim(),
                            });
                        }}
                      >
                        Denunciar
                      </Button>
                      {state.can_moderate && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void operate("hide", { comment_id: c.id })
                          }
                        >
                          Ocultar
                        </Button>
                      )}
                    </div>
                  )}
                  {c.status === "hidden" && c.own && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Eliminar este comentário?"))
                          void operate("delete_comment", { comment_id: c.id });
                      }}
                    >
                      Eliminar comentário
                    </Button>
                  )}
                  {c.status === "hidden" && state.can_moderate && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void operate("restore_comment", { comment_id: c.id })
                      }
                    >
                      Restaurar comentário
                    </Button>
                  )}
                </article>
              </li>
            ))}
          </ol>
          {more && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void loadMore()}
            >
              Carregar mais comentários
            </Button>
          )}
          {state.can_moderate && (
            <aside>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void repo
                    .reports()
                    .then((rows) => {
                      if (alive.current) setReports(rows);
                    })
                    .catch((e) => {
                      if (alive.current) setError(e.message);
                    })
                }
              >
                Denúncias pendentes
              </Button>
              {reports && (
                <ul>
                  {reports.map((r) => (
                    <li key={r.id}>
                      <p>{r.reason}</p>
                      <p>{r.body}</p>
                      <Button
                        disabled={busy}
                        onClick={async () => {
                          try {
                            await repo.mutate(
                              r.publication_id,
                              r.entry_id ?? undefined,
                              "hide",
                              { comment_id: r.comment_id },
                            );
                            await reload();
                            setReports(await repo.reports());
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Ocultar denunciado
                      </Button>
                      <Button
                        disabled={busy}
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await repo.mutate(
                              r.publication_id,
                              r.entry_id ?? undefined,
                              "dismiss_report",
                              { comment_id: r.comment_id },
                            );
                            setReports(await repo.reports());
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Dispensar denúncia
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}
        </>
      )}
    </section>
  );
}
