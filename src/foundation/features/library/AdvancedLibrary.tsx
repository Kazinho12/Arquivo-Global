import { importDeviceProgress } from "./importProgress";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui";
import { useReadingSync } from "./ReadingProvider";
import {
  clearPoints,
  points,
  point,
  putPoint,
  cacheWarning,
} from "./readingCache";
import { libraryStore } from "./store";
import { inScope } from "../local/persistence";
import { createSocialRepository } from "../social/repository";
import {
  createPublicWorksRepository,
  getPublicClient,
} from "../catalog/repository";
import type {
  AccountLibraryItem,
  PrivateReadingList,
  ReadingSettings,
} from "./syncRepository";
import type { ReadingSync } from "./syncEngine";
function useCommands(engine: ReadingSync) {
  const pending = useRef(new Map<string, string>()),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function run(
    action: string,
    data: Record<string, unknown>,
    after?: (r: any) => void,
  ) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const key = JSON.stringify([action, data]),
      op = pending.current.get(key) ?? crypto.randomUUID();
    pending.current.set(key, op);
    try {
      const r = await engine.repo.call(action, data, op);
      pending.current.delete(key);
      if (engine.active) {
        after?.(r);
        setNotice("Operação confirmada pelo servidor.");
      }
      return r;
    } catch (e) {
      if (engine.active) setError((e as Error).message);
      return undefined;
    } finally {
      locked.current = false;
      if (engine.active) setBusy(false);
    }
  }
  return { run, busy, error, notice, setError };
}
export function ReadingPrivacy() {
  const engine = useReadingSync();
  if (!engine) return null;
  return <Privacy key={engine.owner} engine={engine} />;
}
function Privacy({ engine }: { engine: ReadingSync }) {
  const command = useCommands(engine);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const confirm = (text: string) => window.confirm(text);
  async function setting(sync: boolean, history: boolean) {
    setBusy(true);
    setMessage("");
    try {
      await engine.settingsChange(sync, history);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function reset(action: string) {
    if (
      !confirm(
        "Confirmas esta remoção dos teus dados sincronizados? Os dados locais são geridos separadamente.",
      )
    )
      return;
    await command.run(action, { epoch: engine.settings?.epoch }, (r) => {
      engine.settings = r as ReadingSettings;
      engine.pending.forEach((q) => (q.conflict = true));
      engine.persist();
    });
  }
  async function importLocal() {
    if (!engine.settings?.sync) return;
    const candidates = new Map(
      points("guest").map((p) => [p.work + ":" + p.entry, p]),
    );
    for (const e of inScope("guest", () => libraryStore.getEntries()))
      if (
        e.lastReadChapterId &&
        !candidates.has(e.workId + ":" + e.lastReadChapterId)
      )
        candidates.set(e.workId + ":" + e.lastReadChapterId, {
          work: e.workId,
          entry: e.lastReadChapterId,
          position: e.lastReadPosition ?? 0,
          locator: { kind: e.format === "Poesia" ? "poetry" : "prose" },
          completed: e.status === "completed",
          time: e.lastReadAtIso ?? new Date().toISOString(),
        });
    if (
      !confirm(
        `Importar ${candidates.size} posições deste dispositivo? Posições já confirmadas na conta serão preservadas. Os originais locais não serão apagados.`,
      )
    )
      return;
    setBusy(true);
    let queued = 0,
      skipped = 0;
    try {
      const repo = createPublicWorksRepository(getPublicClient());
      const imported = await importDeviceProgress(
        engine,
        [...candidates.values()],
        repo,
      );
      queued = imported.queued;
      skipped = imported.skipped;
      setMessage(
        `${queued} posições preparadas para sincronização; ${skipped} preservadas/indisponíveis. A confirmação depende do servidor; os originais permanecem no dispositivo.`,
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="reading-sync-panel">
      <summary>Sincronização, importação e privacidade</summary>
      <p>
        Progresso e histórico são privados. Estas preferências não ativam
        métricas nem divulgam leituras a autores ou administradores. A
        sincronização e o histórico começam desligados.
      </p>
      {!engine.settings ? (
        <Button disabled={busy} onClick={() => void engine.start()}>
          Carregar definições
        </Button>
      ) : (
        <>
          <label>
            <input
              type="checkbox"
              checked={engine.settings.sync}
              disabled={busy}
              onChange={(e) =>
                void setting(e.target.checked, engine.settings!.history)
              }
            />{" "}
            Sincronizar progresso entre dispositivos
          </label>
          <label>
            <input
              type="checkbox"
              checked={engine.settings.history}
              disabled={busy}
              onChange={(e) =>
                void setting(engine.settings!.sync, e.target.checked)
              }
            />{" "}
            Registar histórico de leitura sincronizado
          </label>
          <p>
            Desligar não elimina dados anteriores. Posições locais continuam
            separadas por conta. Após alterações das definições, revê as
            posições pendentes antes de reenviar.
          </p>
          <div className="actions">
            <Button
              disabled={busy || !engine.settings.sync}
              onClick={() => void importLocal()}
            >
              Importar o meu progresso deste dispositivo
            </Button>
            <Button
              disabled={command.busy}
              onClick={() => void reset("clear_history")}
            >
              Limpar histórico sincronizado
            </Button>
            <Button
              disabled={command.busy}
              onClick={() => void reset("clear_all")}
            >
              Limpar todo o progresso sincronizado
            </Button>
            <Button
              disabled={command.busy}
              onClick={() => void reset("remove_completed")}
            >
              Remover capítulos concluídos
            </Button>
          </div>
        </>
      )}
      <div className="actions">
        <Button
          onClick={() => {
            if (
              confirm(
                "Limpar apenas o progresso local desta conta neste dispositivo? A fila pendente e os dados remotos não são alterados.",
              )
            ) {
              clearPoints(undefined, "user:" + engine.owner);
              inScope("user:" + engine.owner, () =>
                libraryStore.clearHistory(),
              );
              setRetry(retry + 1);
            }
          }}
        >
          Limpar progresso local desta conta
        </Button>
        <Button
          onClick={() => {
            if (
              confirm(
                "Limpar o progresso anónimo deste dispositivo? Não elimina os dados da conta.",
              )
            ) {
              clearPoints(undefined, "guest");
              inScope("guest", () => libraryStore.clearHistory());
            }
          }}
        >
          Limpar progresso local anónimo
        </Button>
        <Button
          onClick={() => {
            const blob = new Blob(
              [
                JSON.stringify(
                  {
                    points: points("user:" + engine.owner),
                    pending: engine.pending,
                    originalQueue: (() => {
                      try {
                        return localStorage.getItem(engine.key());
                      } catch {
                        return null;
                      }
                    })(),
                  },
                  null,
                  2,
                ),
              ],
              { type: "application/json" },
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "arquivo-global-leituras-privadas.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Exportar cópia local privada
        </Button>
      </div>
      <Button
        onClick={() => {
          if (
            confirm(
              "Eliminar a fila de envios pendentes desta conta neste dispositivo? Exporta antes uma cópia. Posições locais e dados remotos são preservados.",
            )
          )
            engine.resetQueue();
        }}
      >
        Limpar fila local pendente
      </Button>
      {(message ||
        command.error ||
        engine.error ||
        engine.storageWarning ||
        cacheWarning) && (
        <p role="status">
          {message ||
            command.error ||
            engine.error ||
            engine.storageWarning ||
            cacheWarning}
        </p>
      )}
      {!!engine.pending.length && (
        <>
          <p>
            {engine.pending.length} posições pendentes; envio limitado a uma
            operação a cada 15 segundos.
          </p>
          <Button onClick={() => void engine.flush()}>
            Tentar sincronizar
          </Button>
          <ul>
            {engine.pending
              .filter((q) => q.conflict)
              .map((q) => (
                <li key={q.operation}>
                  Conflito de posição ·{" "}
                  <Link to={`/obras/${q.point.work}`}>
                    Abrir obra atual para rever
                  </Link>
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await engine.resolve(q, false);
                      } catch (e) {
                        setMessage((e as Error).message);
                      }
                    }}
                  >
                    Usar posição da conta
                  </Button>
                  <Button
                    disabled={busy || !engine.settings?.sync}
                    onClick={async () => {
                      if (
                        !confirm(
                          "Reenviar explicitamente a posição deste dispositivo sobre a versão atual?",
                        )
                      )
                        return;
                      try {
                        await engine.resolve(q, true);
                      } catch (e) {
                        setMessage((e as Error).message);
                      }
                    }}
                  >
                    Usar posição deste dispositivo
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Descartar apenas este envio pendente? Não apaga os dados remotos nem a posição local.",
                        )
                      )
                        engine.discard(q);
                    }}
                  >
                    Descartar envio pendente
                  </Button>
                </li>
              ))}
          </ul>
        </>
      )}
    </details>
  );
}
export function AdvancedLibrary() {
  const engine = useReadingSync();
  if (!engine) return null;
  return <AccountLibrary key={engine.owner} engine={engine} />;
}
function AccountLibrary({ engine }: { engine: ReadingSync }) {
  const location = useLocation(),
    { id } = useParams(),
    navigate = useNavigate();
  const path = location.pathname;
  const mode = path.includes("/listas")
    ? "lists"
    : path.includes("/historico")
      ? "history"
      : "library";
  const [q, setQ] = useState(""),
    [filter, setFilter] = useState(
      path.endsWith("/favoritos") ? "favorite" : "all",
    ),
    [format, setFormat] = useState(""),
    [genre, setGenre] = useState(""),
    [author, setAuthor] = useState(""),
    [updated, setUpdated] = useState(""),
    [sort, setSort] = useState("recent");
  const [rows, setRows] = useState<any[]>([]),
    [detail, setDetail] = useState<PrivateReadingList | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [more, setMore] = useState(false),
    [retry, setRetry] = useState(0);
  const [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const command = useCommands(engine);
  const request = useRef(0),
    loadLock = useRef(false);
  const params = useMemo(
    () => ({
      q,
      filter,
      format,
      genre,
      author,
      updated: updated ? new Date(updated).toISOString() : "",
      sort,
    }),
    [q, filter, format, genre, author, updated, sort],
  );
  useEffect(() => {
    setFilter(path.endsWith("/favoritos") ? "favorite" : "all");
  }, [path]);
  useEffect(() => {
    const version = ++request.current;
    setLoading(true);
    setError("");
    setRows([]);
    setDetail(null);
    const timer = setTimeout(() => {
      engine.repo
        .call(mode === "lists" ? (id ? "list" : "lists") : mode, {
          ...params,
          ...(id ? { id } : {}),
          offset: 0,
        })
        .then(
          (result) => {
            if (version !== request.current || !engine.active) return;
            if (mode === "lists" && id) {
              setDetail(result);
              setName(result.name);
              setDescription(result.description);
            } else {
              setRows(result);
              setMore(result.length === 30);
            }
          },
          (e) => {
            if (version === request.current) setError(e.message);
          },
        )
        .finally(() => {
          if (version === request.current) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [engine, mode, id, params, retry]);
  async function loadMore() {
    if (loadLock.current) return;
    loadLock.current = true;
    setLoading(true);
    const generation = request.current;
    try {
      const next = await engine.repo.call(mode === "lists" ? "lists" : mode, {
        ...params,
        offset: rows.length,
      });
      if (generation === request.current && engine.active) {
        setRows((old) => [...old, ...next]);
        setMore(next.length === 30);
      }
    } catch (e) {
      if (generation === request.current) setError((e as Error).message);
    } finally {
      loadLock.current = false;
      if (generation === request.current) setLoading(false);
    }
  }
  const refresh = () => setRetry((r) => r + 1);
  async function saveItems(items: string[]) {
    if (!detail) return;
    await command.run(
      "save_list",
      {
        id: detail.id,
        revision: detail.revision,
        name: detail.name,
        description: detail.description,
        items,
      },
      () => refresh(),
    );
  }
  const social = useMemo(
    () => createSocialRepository(undefined, engine.owner),
    [engine.owner],
  );
  return (
    <div className="container library-page">
      <header className="library-header">
        <div>
          <span className="eyebrow">A TUA COLEÇÃO</span>
          <h1>
            {mode === "history"
              ? "Histórico de Leitura"
              : mode === "lists"
                ? (detail?.name ?? "Listas de Leitura")
                : "Biblioteca Pessoal"}
          </h1>
          <p>
            Organização privada da tua conta. Só as publicações atualmente
            públicas podem ser abertas.
          </p>
        </div>
      </header>
      <nav className="actions" aria-label="Secções da biblioteca">
        <Link to="/biblioteca">Biblioteca</Link>
        <Link to="/biblioteca/favoritos">Favoritas</Link>
        <Link to="/biblioteca/historico">Histórico</Link>
        <Link to="/biblioteca/listas">Listas privadas</Link>
        <Link to="/catalogo">Explorar catálogo</Link>
        <Link to={location.pathname + "?local=1"}>Dados deste dispositivo</Link>
      </nav>
      <ReadingPrivacy />
      {mode !== "lists" && (
        <form
          className="library-sync-filters"
          onSubmit={(e) => e.preventDefault()}
        >
          <label>
            Pesquisar
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={160}
            />
          </label>
          <label>
            Formato
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">Todos</option>
              {[
                "Romance",
                "Conto",
                "Poesia",
                "HQ / Comic",
                "Mangá",
                "Webtoon",
              ].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          {mode === "library" && (
            <>
              <label>
                Organização
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  {[
                    ["all", "Todas"],
                    ["reading", "A ler"],
                    ["completed", "Concluídas"],
                    ["want", "Quero ler"],
                    ["favorite", "Favoritas"],
                    ["saved", "Guardadas"],
                    ["later", "Ler depois"],
                    ["following", "Obras seguidas"],
                    ["recent", "Histórico recente"],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Género
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  maxLength={100}
                />
              </label>
              <label>
                Autor
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  maxLength={160}
                />
              </label>
              <label>
                Atualizadas desde
                <input
                  type="date"
                  value={updated}
                  onChange={(e) => setUpdated(e.target.value)}
                />
              </label>
              <label>
                Ordenar
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="recent">Última leitura</option>
                  <option value="added">Adição à biblioteca</option>
                  <option value="updated">Atualização da obra</option>
                  <option value="title">Título</option>
                </select>
              </label>
            </>
          )}
        </form>
      )}
      {loading && <p role="status">A carregar dados privados…</p>}
      {(error || command.error) && (
        <p role="alert">
          {error || command.error}{" "}
          <Button onClick={refresh}>Tentar novamente</Button>
        </p>
      )}
      {command.notice && <p role="status">{command.notice}</p>}
      {mode === "lists" && (!id || detail) && (
        <form
          className="reading-sync-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            await command.run(
              "save_list",
              {
                ...(detail ? { id: detail.id, revision: detail.revision } : {}),
                name,
                description,
              },
              () => {
                setName("");
                setDescription("");
                refresh();
              },
            );
          }}
        >
          <h2>{detail ? "Editar lista privada" : "Criar lista privada"}</h2>
          <label>
            Nome
            <input
              required
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Descrição
            <textarea
              value={description}
              maxLength={1000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={command.busy || !name.trim()}>
            Guardar lista
          </Button>
          {detail && (
            <Button
              disabled={command.busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "Eliminar esta lista? As obras não serão eliminadas.",
                  )
                )
                  return;
                await command.run(
                  "delete_list",
                  { id: detail.id, revision: detail.revision },
                  () => navigate("/biblioteca/listas"),
                );
              }}
            >
              Eliminar lista
            </Button>
          )}
        </form>
      )}
      {mode === "lists" && !id && (
        <ul className="lists-grid">
          {(rows as PrivateReadingList[]).map((l) => (
            <li className="list-card" key={l.id}>
              <h2>
                <Link to={`/biblioteca/listas/${l.id}`}>{l.name}</Link>
              </h2>
              <p>{l.description}</p>
              <p>
                {l.count} obras · Atualizada em{" "}
                {new Date(l.updated_at).toLocaleDateString("pt-PT")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {detail && (
        <>
          <p>
            Adiciona obras usando «Adicionar a lista privada» na página pública
            de cada obra. Uma obra pode estar em várias listas.
          </p>
          <ol>
            {detail.items?.map((item, index, all) => (
              <li key={item.id}>
                {item.available ? (
                  <Link to={`/obras/${item.id}`}>{item.title}</Link>
                ) : (
                  "Obra indisponível"
                )}
                <div className="actions">
                  <Button
                    disabled={command.busy || index === 0}
                    aria-label={`Subir ${item.title ?? "obra"}`}
                    onClick={() => {
                      const ids = all.map((i) => i.id);
                      [ids[index - 1], ids[index]] = [
                        ids[index],
                        ids[index - 1],
                      ];
                      void saveItems(ids);
                    }}
                  >
                    Subir
                  </Button>
                  <Button
                    disabled={command.busy || index === all.length - 1}
                    aria-label={`Descer ${item.title ?? "obra"}`}
                    onClick={() => {
                      const ids = all.map((i) => i.id);
                      [ids[index + 1], ids[index]] = [
                        ids[index],
                        ids[index + 1],
                      ];
                      void saveItems(ids);
                    }}
                  >
                    Descer
                  </Button>
                  <Button
                    disabled={command.busy}
                    onClick={() =>
                      void saveItems(
                        all.filter((i) => i.id !== item.id).map((i) => i.id),
                      )
                    }
                  >
                    Remover da lista
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {mode === "history" && (
        <ul>
          {rows.map((row) => (
            <li className="reading-sync-panel" key={row.id + row.entry_id}>
              {row.available ? (
                <Link
                  to={
                    row.entry_id
                      ? `/obras/${row.id}/capitulos/${row.entry_id}`
                      : `/obras/${row.id}`
                  }
                >
                  {row.title} · {row.chapter}
                </Link>
              ) : (
                <span>Leitura indisponível nesta publicação</span>
              )}
              <p>
                {new Date(row.seen_at).toLocaleString("pt-PT")} ·{" "}
                {row.completed ? "Concluído" : "Em leitura"}
              </p>
              <Button
                disabled={command.busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Remover esta entrada do histórico? A posição continua guardada.",
                    )
                  )
                    void command.run(
                      "forget_history",
                      {
                        work: row.id,
                        entry: row.entry_id,
                        epoch: engine.settings?.epoch,
                      },
                      (r) => {
                        engine.settings = r;
                        engine.pending.forEach((q) => (q.conflict = true));
                        engine.persist();
                        refresh();
                      },
                    );
                }}
              >
                Remover do histórico
              </Button>
            </li>
          ))}
        </ul>
      )}
      {mode === "library" && (
        <ul className="library-grid">
          {(rows as AccountLibraryItem[]).map((row) => (
            <li className="library-card reading-sync-panel" key={row.id}>
              <h2>
                {row.available ? (
                  <Link to={`/obras/${row.id}`}>{row.title}</Link>
                ) : (
                  "Obra indisponível"
                )}
              </h2>
              <p>
                {row.author} · {row.format} · {row.genre}
              </p>
              <p>
                {[
                  row.favorite && "Favorita",
                  row.saved && "Guardada",
                  row.later && "Ler depois",
                  row.following && "Obra seguida",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {row.available && (
                <>
                  <Link
                    to={
                      row.last_entry
                        ? `/obras/${row.id}/capitulos/${row.last_entry}`
                        : `/obras/${row.id}`
                    }
                  >
                    Retomar leitura
                  </Link>
                  <label>
                    Estado pessoal
                    <select
                      value={row.state ?? ""}
                      disabled={command.busy}
                      onChange={(e) =>
                        void command.run(
                          "state",
                          {
                            work: row.id,
                            revision: row.revision ?? 0,
                            state: e.target.value,
                          },
                          refresh,
                        )
                      }
                    >
                      <option disabled value="">
                        Sem estado pessoal
                      </option>
                      <option value="reading">A ler</option>
                      <option value="completed">Concluída</option>
                      <option value="want">Quero ler</option>
                    </select>
                  </label>
                </>
              )}
              <div className="actions">
                {(["favorite", "saved", "later", "following"] as const)
                  .filter((k) => row[k])
                  .map((k) => (
                    <Button
                      key={k}
                      disabled={command.busy}
                      onClick={async () => {
                        try {
                          if (k === "following")
                            await social.mutate(row.id, undefined, "follow", {
                              value: false,
                            });
                          else await social.removeLibrary(row.id, k);
                          refresh();
                        } catch (e) {
                          command.setError((e as Error).message);
                        }
                      }}
                    >
                      {k === "following"
                        ? "Deixar de seguir"
                        : k === "favorite"
                          ? "Retirar favorito"
                          : k === "saved"
                            ? "Remover guardado"
                            : "Retirar de ler depois"}
                    </Button>
                  ))}
                <Button
                  disabled={command.busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Limpar o progresso sincronizado desta obra? Favoritos e listas serão preservados.",
                      )
                    )
                      void command.run(
                        "clear_work",
                        { work: row.id, revision: row.revision ?? 0 },
                        () => {
                          engine.pending
                            .filter((q) => q.point.work === row.id)
                            .forEach((q) => (q.conflict = true));
                          engine.works.delete(row.id);
                          engine.persist();
                          refresh();
                        },
                      );
                  }}
                >
                  Limpar progresso desta obra
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && !rows.length && !detail && (
        <p className="library-empty-state">
          Ainda não existem itens nesta seleção.
        </p>
      )}
      {detail && !detail.items?.length && (
        <p>Esta lista ainda não contém obras.</p>
      )}
      {more && !(mode === "lists" && id) && (
        <Button disabled={loading} onClick={() => void loadMore()}>
          Carregar mais
        </Button>
      )}
    </div>
  );
}
export function ReadingListPicker({ work }: { work: string }) {
  const engine = useReadingSync();
  if (!engine) return null;
  return <ListPicker key={engine.owner + work} engine={engine} work={work} />;
}
function ListPicker({ engine, work }: { engine: ReadingSync; work: string }) {
  const [lists, setLists] = useState<PrivateReadingList[] | null>(null),
    [offset, setOffset] = useState(0);
  const cmd = useCommands(engine);
  async function load() {
    try {
      const next = await engine.repo.call<PrivateReadingList[]>("lists", {
        offset,
      });
      setLists((old) => [...(old ?? []), ...next]);
      setOffset(offset + next.length);
    } catch (e) {
      cmd.setError((e as Error).message);
    }
  }
  return (
    <section className="reading-sync-panel">
      <h2>Listas privadas</h2>
      <Button onClick={() => void load()} disabled={cmd.busy}>
        Carregar {lists ? "mais listas" : "as minhas listas"}
      </Button>
      <Link to="/biblioteca/listas">Criar ou gerir listas</Link>
      <ul>
        {lists?.map((list) => (
          <li key={list.id}>
            {list.name}
            <Button
              disabled={cmd.busy}
              onClick={async () => {
                try {
                  const current = await engine.repo.call<PrivateReadingList>(
                    "list",
                    { id: list.id },
                  );
                  if (current.items?.some((i) => i.id === work)) {
                    cmd.setError("Esta obra já está nesta lista.");
                    return;
                  }
                  await cmd.run("save_list", {
                    id: current.id,
                    revision: current.revision,
                    name: current.name,
                    description: current.description,
                    items: [...(current.items?.map((i) => i.id) ?? []), work],
                  });
                } catch (e) {
                  cmd.setError((e as Error).message);
                }
              }}
            >
              Adicionar a lista privada
            </Button>
          </li>
        ))}
      </ul>
      {lists?.length === 0 && <p>Ainda não criaste listas.</p>}
      {(cmd.error || cmd.notice) && (
        <p role="status">{cmd.error || cmd.notice}</p>
      )}
    </section>
  );
}
