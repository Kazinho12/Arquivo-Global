import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui";
import { useAuth } from "../auth/AuthProvider";
import {
  createSocialRepository,
  socialEnabled,
  type SocialRepository,
} from "./repository";
export function AuthorFollow({
  id,
  enabled = socialEnabled,
  repository,
}: {
  id: string;
  enabled?: boolean;
  repository?: SocialRepository;
}) {
  const { state } = useAuth();
  return enabled ? (
    <Follow
      key={`${id}:${state.user?.id}`}
      id={id}
      user={state.user?.id}
      repository={repository}
    />
  ) : null;
}
function Follow({
  id,
  user,
  repository,
}: {
  id: string;
  user?: string;
  repository?: SocialRepository;
}) {
  const repo = useMemo(
    () => repository ?? createSocialRepository(undefined, user),
    [repository, user],
  );
  const [data, setData] = useState<{
      followers: number;
      followed: number;
      following: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setData(null);
    setError("");
    repo.author(id).then(
      (d) => {
        if (current) setData(d);
      },
      (e) => {
        if (current) setError(e.message);
      },
    );
    return () => {
      current = false;
    };
  }, [repo, id, retry]);
  return (
    <section className="social-author" aria-label="Acompanhar escritor">
      {data ? (
        <>
          <p aria-live="polite">A seguir ({data.followed})</p>
          {user !== id &&
            (user ? (
              <Button
                disabled={busy}
                aria-pressed={data.following}
                onClick={async () => {
                  if (lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  setError("");
                  const before = data;
                  setData({
                    ...data,
                    following: !data.following,
                    followers: data.followers + (data.following ? -1 : 1),
                  });
                  try {
                    const result = await repo.followAuthor(
                      id,
                      !before.following,
                    );
                    if (alive.current) {
                      setData(result);
                      window.dispatchEvent(new Event("ag:author-follow"));
                    }
                  } catch (e) {
                    if (alive.current) {
                      setData(before);
                      setError((e as Error).message);
                    }
                  } finally {
                    lock.current = false;
                    if (alive.current) setBusy(false);
                  }
                }}
              >
                {data.following
                  ? "Deixar de seguir escritor"
                  : "Seguir escritor"}
              </Button>
            ) : (
              <Link to="/entrar">Inicia sessão para seguir este escritor</Link>
            ))}
        </>
      ) : (
        !error && <p role="status">A carregar acompanhamento…</p>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <Button variant="ghost" onClick={() => setRetry((v) => v + 1)}>
            Tentar novamente
          </Button>
        </p>
      )}
    </section>
  );
}
