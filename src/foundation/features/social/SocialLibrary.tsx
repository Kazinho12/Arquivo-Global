import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui";
import { useAuth } from "../auth/AuthProvider";
import {
  createSocialRepository,
  socialEnabled,
  type SocialItem,
  type SocialRepository,
} from "./repository";
export function SocialLibrary({
  enabled = socialEnabled,
  repository,
}: {
  enabled?: boolean;
  repository?: SocialRepository;
}) {
  const { state } = useAuth();
  return enabled ? (
    <Library
      key={state.user?.id ?? "anon"}
      user={state.user?.id}
      repository={repository}
    />
  ) : null;
}
function Library({
  user,
  repository,
}: {
  user?: string;
  repository?: SocialRepository;
}) {
  const repo = useMemo(
    () => repository ?? createSocialRepository(undefined, user),
    [repository, user],
  );
  const [rows, setRows] = useState<SocialItem[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [more, setMore] = useState(false),
    [filter, setFilter] = useState("all"),
    [retry, setRetry] = useState(0);
  const alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let current = true;
    setLoading(true);
    setError("");
    repo
      .library()
      .then(
        (items) => {
          if (current) {
            setRows(items);
            setMore(items.length === 24);
          }
        },
        (e) => {
          if (current) setError(e.message);
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [repo, user, retry]);
  return (
    <section className="social-panel" aria-label="Biblioteca sincronizada">
      <h2>Biblioteca da conta</h2>
      <p>
        Guardados, favoritos e ler depois são privados e sincronizados. Os itens
        locais abaixo são preservados, sem importação automática.
      </p>
      {!user ? (
        <Link to="/entrar">
          Inicia sessão para consultar a biblioteca da conta
        </Link>
      ) : (
        <>
          <label className="field">
            <span>Mostrar itens da conta</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">Todos</option>
              <option value="following">Obras seguidas</option>
              <option value="saved">Guardados</option>
              <option value="favorite">Favoritos</option>
              <option value="later">Ler depois</option>
            </select>
          </label>
          {loading && <p role="status">A carregar biblioteca…</p>}
          {error && (
            <p role="alert">
              {error}{" "}
              <Button onClick={() => setRetry((v) => v + 1)}>
                Tentar novamente
              </Button>
            </p>
          )}
          {!loading && !error && !rows.length && (
            <p>Ainda não guardaste obras nesta conta.</p>
          )}
          <ul>
            {rows
              .filter(
                (r) =>
                  filter === "all" ||
                  r[filter as "saved" | "favorite" | "later" | "following"],
              )
              .map((row) => (
                <li key={row.id}>
                  {row.available ? (
                    <Link to={`/obras/${row.id}`}>{row.title}</Link>
                  ) : (
                    <span>Obra indisponível</span>
                  )}{" "}
                  · {row.format ?? ""}{" "}
                  <span>
                    {[
                      row.saved && "Guardada",
                      row.favorite && "Favorita",
                      row.later && "Ler depois",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <div className="actions">
                    {row.following && (
                      <Button
                        variant="ghost"
                        disabled={loading}
                        onClick={async () => {
                          if (lock.current) return;
                          lock.current = true;
                          setLoading(true);
                          setError("");
                          try {
                            await repo.mutate(row.id, undefined, "follow", {
                              value: false,
                            });
                            if (alive.current) setRetry((v) => v + 1);
                          } catch (e) {
                            if (alive.current) setError((e as Error).message);
                          } finally {
                            lock.current = false;
                            if (alive.current) setLoading(false);
                          }
                        }}
                      >
                        Deixar de seguir obra
                      </Button>
                    )}

                    {(["saved", "favorite", "later"] as const)
                      .filter((k) => row[k])
                      .map((k) => (
                        <Button
                          key={k}
                          variant="ghost"
                          disabled={loading}
                          onClick={async () => {
                            if (lock.current) return;
                            lock.current = true;
                            setLoading(true);
                            setError("");
                            try {
                              await repo.removeLibrary(row.id, k);
                              if (alive.current) setRetry((v) => v + 1);
                            } catch (e) {
                              if (alive.current) setError((e as Error).message);
                            } finally {
                              lock.current = false;
                              if (alive.current) setLoading(false);
                            }
                          }}
                        >
                          {k === "saved"
                            ? "Remover guardado"
                            : k === "favorite"
                              ? "Retirar favorito"
                              : "Retirar de ler depois"}
                        </Button>
                      ))}
                  </div>
                </li>
              ))}
          </ul>
          {more && (
            <Button
              disabled={loading}
              onClick={async () => {
                if (lock.current) return;
                lock.current = true;
                setLoading(true);
                try {
                  const items = await repo.library(rows.at(-1));
                  if (alive.current) {
                    setRows((previous) => [
                      ...new Map(
                        [...previous, ...items].map((r) => [r.id, r]),
                      ).values(),
                    ]);
                    setMore(items.length === 24);
                  }
                } catch (e) {
                  if (alive.current) setError((e as Error).message);
                } finally {
                  lock.current = false;
                  if (alive.current) setLoading(false);
                }
              }}
            >
              Carregar mais itens
            </Button>
          )}
        </>
      )}
    </section>
  );
}
