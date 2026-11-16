import { Bell } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui";
import { useAuth } from "../auth/AuthProvider";
import {
  createNotificationRepository,
  notificationLink,
  notificationsAnalyticsEnabled,
  type InboxItem,
  type NotificationPreferences,
  type NotificationRepository,
} from "./repository";
const Count = createContext<{ unread: number | null; refresh: () => void }>({
  unread: null,
  refresh: () => {},
});
const changed = () =>
  window.dispatchEvent(new Event("ag:notifications-changed"));
export function NotificationCountProvider({
  children,
  enabled = notificationsAnalyticsEnabled,
  repositoryFactory = createNotificationRepository,
}: {
  children: ReactNode;
  enabled?: boolean;
  repositoryFactory?: typeof createNotificationRepository;
}) {
  const { state } = useAuth();
  const owner = enabled ? state.user?.id : undefined;
  return (
    <Counter
      key={owner ?? "guest"}
      owner={owner}
      repositoryFactory={repositoryFactory}
    >
      {children}
    </Counter>
  );
}
function Counter({
  owner,
  children,
  repositoryFactory,
}: {
  owner?: string;
  children: ReactNode;
  repositoryFactory: typeof createNotificationRepository;
}) {
  const repo = useMemo(
    () => (owner ? repositoryFactory(owner) : null),
    [owner, repositoryFactory],
  );
  const [unread, setUnread] = useState<number | null>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!repo) return;
    let active = true,
      inflight = false;
    const read = async () => {
      if (inflight || document.visibilityState === "hidden") return;
      inflight = true;
      try {
        const r = await repo.member("count");
        if (active)
          setUnread(
            Number.isSafeInteger(r.unread) && r.unread >= 0 ? r.unread : null,
          );
      } catch {
        if (active) setUnread(null);
      } finally {
        inflight = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 45000);
    const refresh = () => void read();
    window.addEventListener("ag:notifications-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("ag:notifications-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [repo, retry]);
  return (
    <Count.Provider value={{ unread, refresh: () => setRetry((r) => r + 1) }}>
      {children}
    </Count.Provider>
  );
}
export function NotificationHeader({
  enabled = notificationsAnalyticsEnabled,
}: { enabled?: boolean } = {}) {
  const { state } = useAuth();
  const { unread } = useContext(Count);
  if (!enabled || !state.user) return null;
  return (
    <Link
      className="notification-header"
      to="/notificacoes"
      aria-label={
        unread === null
          ? "Notificações; contador indisponível"
          : `Notificações: ${unread} não lidas`
      }
    >
      <Bell size={18} aria-hidden="true" />
      <span className="notification-header-label">Notificações</span>
      {unread !== null && (
        <span aria-hidden="true"> ({unread > 99 ? "99+" : unread})</span>
      )}
    </Link>
  );
}
const categories = [
  ["followers", "Novos seguidores"],
  ["likes", "Curtidas"],
  ["comments", "Comentários nas minhas obras"],
  ["replies", "Respostas aos meus comentários"],
  ["authors", "Publicações de escritores seguidos"],
  ["works", "Atualizações de obras seguidas"],
  ["official", "Comunicados oficiais opcionais"],
] as const;
const filters = [
  ["all", "Todas"],
  ["unread", "Não lidas"],
  ["interactions", "Interações"],
  ["followers", "Seguidores"],
  ["publications", "Publicações"],
  ["official", "Comunicados oficiais"],
  ["service", "Mensagens de serviço"],
];
export function NotificationInbox({
  repository,
}: {
  repository?: NotificationRepository;
}) {
  const { state } = useAuth();
  return state.user ? (
    <Inbox key={state.user.id} owner={state.user.id} repository={repository} />
  ) : (
    <section className="container">
      <h1>Notificações</h1>
      <p>
        <Link to="/entrar">
          Inicia sessão para consultar a tua caixa de entrada privada.
        </Link>
      </p>
    </section>
  );
}
export function Inbox({
  owner,
  repository,
}: {
  owner: string;
  repository?: NotificationRepository;
}) {
  const repo = useMemo(
    () => repository ?? createNotificationRepository(owner),
    [owner, repository],
  );
  const [rows, setRows] = useState<InboxItem[]>([]),
    [preferences, setPreferences] = useState<NotificationPreferences | null>(
      null,
    ),
    [draft, setDraft] = useState<NotificationPreferences | null>(null),
    [filter, setFilter] = useState("all"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [more, setMore] = useState(false),
    [retry, setRetry] = useState(0),
    [unread, setUnread] = useState<number | null>(null);
  const scope = useRef(0),
    lock = useRef(false),
    alive = useRef(true);
  const cutoff = useRef<string>("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    repo.member<NotificationPreferences>("preferences").then(
      (p) => {
        if (active) {
          setPreferences(p);
          setDraft(p);
        }
      },
      (e) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [repo]);
  useEffect(() => {
    const generation = ++scope.current;
    setLoading(true);
    setError("");
    setRows([]);
    async function read() {
      try {
        const [items, count] = await Promise.all([
          repo.member<InboxItem[]>("list", { filter }),
          repo.member("count"),
        ]);
        if (generation === scope.current && alive.current) {
          setRows(items);
          setMore(items.length === 20);
          setUnread(count.unread);
          cutoff.current = count.as_of;
        }
      } catch (e) {
        if (generation === scope.current && alive.current)
          setError((e as Error).message);
      } finally {
        if (generation === scope.current && alive.current) setLoading(false);
      }
    }
    void read();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !lock.current) void read();
    }, 45000);
    const visible = () => {
      if (document.visibilityState === "visible" && !lock.current) void read();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      scope.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [repo, filter, retry]);
  async function write(action: string, data: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await repo.member(action, data, true);
      if (alive.current) {
        setNotice("Alteração confirmada.");
        changed();
        setRetry((r) => r + 1);
        return true;
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="container notification-page">
      <header>
        <span className="eyebrow">CAIXA DE ENTRADA PRIVADA</span>
        <h1>Notificações</h1>
        <p>
          Atualizações discretas, sem email, sons ou notificações externas.{" "}
          {unread !== null ? `${unread} não lidas.` : "Contador indisponível."}
        </p>
      </header>
      <details className="panel notification-preferences">
        <summary>Preferências de notificação</summary>
        <p>
          As categorias sociais começam desligadas. Avisos de serviço sobre
          suporte e decisões permanecem separados. Não há importação de eventos
          antigos ao ativar uma categoria.
        </p>
        {draft && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await write("preferences_save", { ...draft })) {
                try {
                  const fresh =
                    await repo.member<NotificationPreferences>("preferences");
                  if (alive.current) {
                    setPreferences(fresh);
                    setDraft(fresh);
                  }
                } catch (e) {
                  if (alive.current) setError((e as Error).message);
                }
              }
            }}
          >
            {categories.map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={draft[key]}
                  disabled={busy}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
            <Button type="submit" disabled={busy || !preferences}>
              Guardar preferências
            </Button>
          </form>
        )}
        <Button
          disabled={busy}
          onClick={async () => {
            try {
              const p =
                await repo.member<NotificationPreferences>("preferences");
              if (alive.current) {
                setPreferences(p);
                setDraft(p);
                setRetry((r) => r + 1);
              }
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Recarregar preferências da conta
        </Button>
      </details>
      <div className="actions">
        <label>
          Mostrar
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {filters.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={busy || !cutoff.current}
          onClick={() => void write("read_all", { as_of: cutoff.current })}
        >
          Marcar todas como lidas
        </Button>
        <Button disabled={busy} onClick={() => setRetry((r) => r + 1)}>
          Atualizar
        </Button>
      </div>
      {loading && <p role="status">A carregar notificações…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!loading && !error && !rows.length && (
        <p>Ainda não há notificações nesta seleção.</p>
      )}
      <ul className="center-list">
        {rows.map((n) => {
          const path = notificationLink(n);
          return (
            <li key={n.id}>
              <article
                className={
                  n.read_at ? "notification-read" : "notification-unread"
                }
              >
                <span>
                  {n.kind === "official"
                    ? "Comunicado oficial"
                    : n.kind === "service"
                      ? "Mensagem de serviço"
                      : n.category === "publications"
                        ? "Publicação"
                        : n.category === "followers"
                          ? "Seguidores"
                          : "Interação"}{" "}
                  · {n.read_at ? "Lida" : "Não lida"}
                </span>
                <h2>{n.title}</h2>
                <p>
                  {n.kind === "social" && !path
                    ? "A publicação, comentário ou perfil já não está disponível."
                    : n.body}
                </p>
                {n.group_count > 1 && (
                  <p>{n.group_count} eventos agrupados neste aviso.</p>
                )}
                <time dateTime={n.created_at}>
                  {new Date(n.created_at).toLocaleString("pt-PT")}
                </time>
                <div className="actions">
                  {path && <Link to={path}>Abrir contexto</Link>}
                  {!n.read_at && (
                    <Button
                      disabled={busy}
                      onClick={() => void write("read", { id: n.id })}
                    >
                      Marcar como lida
                    </Button>
                  )}
                  <Button
                    disabled={busy}
                    onClick={() => void write("hide", { id: n.id })}
                  >
                    Ocultar notificação
                  </Button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      {more && (
        <Button
          disabled={busy || loading}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setLoading(true);
            const generation = scope.current;
            try {
              const items = await repo.member<InboxItem[]>("list", {
                filter,
                before: rows.at(-1)?.created_at,
                before_id: rows.at(-1)?.id,
              });
              if (generation === scope.current && alive.current) {
                setRows((old) => [
                  ...new Map([...old, ...items].map((n) => [n.id, n])).values(),
                ]);
                setMore(items.length === 20);
              }
            } catch (e) {
              if (alive.current) setError((e as Error).message);
            } finally {
              lock.current = false;
              if (generation === scope.current && alive.current)
                setLoading(false);
            }
          }}
        >
          Carregar mais notificações
        </Button>
      )}
    </section>
  );
}
