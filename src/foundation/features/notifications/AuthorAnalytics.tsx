import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui";
import { useAuth } from "../auth/AuthProvider";
import {
  createNotificationRepository,
  type NotificationRepository,
} from "./repository";
export function AuthorAnalytics({
  repository,
}: {
  repository?: NotificationRepository;
}) {
  const { state } = useAuth();
  return state.user ? (
    <Analytics
      key={state.user.id}
      owner={state.user.id}
      repository={repository}
    />
  ) : (
    <p className="container">
      Inicia sessão para consultar as estatísticas das tuas obras.
    </p>
  );
}
const labels: Record<string, string> = {
  views: "Visualizações qualificadas de obras",
  reads: "Leituras qualificadas de entradas",
  likes: "Curtidas de obras",
  chapter_likes: "Curtidas de entradas",
  comments: "Comentários visíveis (obra e entradas)",
  favorites: "Favoritos agregados",
  followers: "Seguidores de obras",
};
export function Analytics({
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
  const [summary, setSummary] = useState<any>(null),
    [works, setWorks] = useState<any[]>([]),
    [chapters, setChapters] = useState<any[]>([]),
    [days, setDays] = useState<any[]>([]),
    [work, setWork] = useState(""),
    [period, setPeriod] = useState(30),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [moreWorks, setMoreWorks] = useState(false),
    [moreChapters, setMoreChapters] = useState(false);
  const generation = useRef(0),
    lock = useRef(false);
  useEffect(() => {
    let active = true;
    repo.analytics("works").then(
      (rows) => {
        if (active) {
          setWorks(rows);
          setMoreWorks(rows.length === 20);
        }
      },
      (e) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [repo, retry]);
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setSummary(null);
    setChapters([]);
    setDays([]);
    Promise.all([
      repo.analytics("overview", work || undefined, undefined, period),
      repo.analytics("daily", work || undefined, undefined, period),
      work ? repo.analytics("chapters", work) : Promise.resolve([]),
    ])
      .then(
        ([s, d, c]) => {
          if (current === generation.current) {
            setSummary(s);
            setDays(d);
            setChapters(c);
            setMoreChapters(c.length === 20);
          }
        },
        (e) => {
          if (current === generation.current) setError(e.message);
        },
      )
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [repo, work, period, retry]);
  async function more(kind: "works" | "chapters") {
    if (lock.current) return;
    lock.current = true;
    const current = generation.current;
    try {
      const rows = await repo.analytics(
        kind,
        kind === "chapters" ? work : undefined,
        (kind === "works" ? works : chapters).at(-1)?.id,
        period,
      );
      if (current !== generation.current) return;
      if (kind === "works") {
        setWorks((old) => [
          ...new Map([...old, ...rows].map((r) => [r.id, r])).values(),
        ]);
        setMoreWorks(rows.length === 20);
      } else {
        setChapters((old) => [
          ...new Map([...old, ...rows].map((r) => [r.id, r])).values(),
        ]);
        setMoreChapters(rows.length === 20);
      }
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      lock.current = false;
    }
  }
  const max = Math.max(
    1,
    ...days.map((d) => Number(d.views) + Number(d.reads)),
  );
  return (
    <section className="container studio-page author-analytics">
      <header>
        <span className="eyebrow">AUDIÊNCIA AGREGADA</span>
        <h1>Estatísticas do Autor</h1>
        <p>
          Contadores reais das tuas publicações, incluindo as retiradas. Sem
          identidades, posições, bibliotecas privadas ou histórico individual de
          leitores.
        </p>
      </header>
      <div className="actions">
        <label>
          Obra
          <select value={work} onChange={(e) => setWork(e.target.value)}>
            <option value="">Todas as minhas publicações</option>
            {works.map((w) => (
              <option value={w.id} key={w.id}>
                {w.title}
                {w.is_public ? "" : " (retirada)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Período observado
          <select
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
          >
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
        </label>
        <Button onClick={() => setRetry((r) => r + 1)}>
          Atualizar estatísticas
        </Button>
      </div>
      {loading && <p role="status">A carregar estatísticas privadas…</p>}
      {error && <p role="alert">{error}</p>}
      {summary && (
        <>
          <p>
            Atualizado em {new Date(summary.as_of).toLocaleString("pt-PT")}. Os
            totais abaixo são <strong>acumulados</strong>; o filtro de período
            aplica-se apenas à evolução observada.
          </p>
          <p>
            {summary.published} obras atualmente públicas ·{" "}
            {summary.writer_followers} seguidores do escritor. Variação líquida
            de seguidores observada no período:{" "}
            {summary.writer_followers_change > 0 ? "+" : ""}
            {summary.writer_followers_change}.
          </p>
          <dl className="analytics-totals">
            {Object.entries(labels).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{Number(summary.totals[key]).toLocaleString("pt-PT")}</dd>
              </div>
            ))}
          </dl>
          <p>
            Captura temporal iniciada em{" "}
            {new Date(summary.stats_since).toLocaleString("pt-PT")}.{" "}
            {summary.partial_period
              ? "Este período é parcial; o passado não foi reconstruído."
              : "O período selecionado está dentro da janela de captura."}{" "}
            Não são calculadas percentagens sem uma base comparável.
          </p>
        </>
      )}
      <h2>Evolução observada (UTC)</h2>
      {!loading && !days.length && (
        <p>
          Ainda não há eventos agregados neste período. Os contadores anteriores
          continuam nos totais acumulados.
        </p>
      )}
      {!!days.length && (
        <>
          <svg
            role="img"
            aria-labelledby="analytics-chart-title"
            viewBox={`0 0 ${Math.max(1, days.length) * 28} 120`}
            className="analytics-chart"
          >
            <title id="analytics-chart-title">
              Visualizações e leituras qualificadas por dia; valores na tabela
              seguinte
            </title>
            {days.map((d, i) => (
              <g key={d.day}>
                <rect
                  x={i * 28 + 2}
                  y={110 - ((Number(d.views) + Number(d.reads)) / max) * 100}
                  width={20}
                  height={((Number(d.views) + Number(d.reads)) / max) * 100}
                  fill="currentColor"
                >
                  <title>
                    {d.day}: {d.views} visualizações, {d.reads} leituras
                  </title>
                </rect>
              </g>
            ))}
          </svg>
          <div className="analytics-table-scroll">
            <table>
              <caption>
                Dias com eventos observados; variações sociais são líquidas
              </caption>
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Visualizações</th>
                  <th>Leituras</th>
                  <th>Curtidas</th>
                  <th>Comentários</th>
                  <th>Favoritos</th>
                  <th>Seguidores de obras</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day}>
                    <th scope="row">{d.day}</th>
                    <td>{d.views}</td>
                    <td>{d.reads}</td>
                    <td>{d.likes_change}</td>
                    <td>{d.comments_change}</td>
                    <td>{d.favorites_change}</td>
                    <td>{d.followers_change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h2>Comparação de publicações · acumulados</h2>
      {!works.length && !loading && !error && (
        <p>Ainda não tens publicações com métricas para consultar.</p>
      )}
      <div className="analytics-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Obra</th>
              <th>Estado</th>
              <th>Visualizações</th>
              <th>Leituras</th>
              <th>Curtidas da obra</th>
              <th>Favoritos</th>
              <th>Seguidores</th>
            </tr>
          </thead>
          <tbody>
            {works.map((w) => (
              <tr key={w.id}>
                <th scope="row">
                  {w.is_public ? (
                    <Link to={`/obras/${w.id}`}>{w.title}</Link>
                  ) : (
                    w.title
                  )}
                </th>
                <td>{w.is_public ? "Pública" : "Retirada"}</td>
                <td>{w.views}</td>
                <td>{w.reads}</td>
                <td>{w.likes}</td>
                <td>{w.favorites}</td>
                <td>{w.followers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {moreWorks && (
        <Button onClick={() => void more("works")}>Carregar mais obras</Button>
      )}
      {work && (
        <>
          <h2>Entradas · acumulados</h2>
          <p>
            Leituras qualificadas por capítulo/poema/episódio. Entradas
            retiradas preservam apenas os agregados históricos.
          </p>
          <ol>
            {[...chapters]
              .sort(
                (a, b) =>
                  Number(b.reads) - Number(a.reads) || a.id.localeCompare(b.id),
              )
              .map((c) => (
                <li key={c.id}>
                  {c.current_entry
                    ? c.title
                    : "Entrada indisponível nesta edição"}{" "}
                  · {c.reads} leituras · {c.likes} curtidas · {c.comments}{" "}
                  comentários
                </li>
              ))}
          </ol>
          {!loading && !chapters.length && <p>Sem entradas com dados.</p>}
          {moreChapters && (
            <Button onClick={() => void more("chapters")}>
              Carregar mais entradas
            </Button>
          )}
        </>
      )}
    </section>
  );
}
export function NotificationDiagnostics({
  repository,
}: {
  repository?: NotificationRepository;
}) {
  const { state } = useAuth();
  const repo = useMemo(
    () =>
      repository ??
      (state.user ? createNotificationRepository(state.user.id) : null),
    [repository, state.user?.id],
  );
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh(retry?: string) {
    if (!repo || busy) return;
    setBusy(true);
    setError("");
    try {
      setData(await repo.diagnostics(retry));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Processamento de notificações</h2>
      <p>Diagnóstico operacional sem mensagens pessoais nem destinatários.</p>
      <Button disabled={busy} onClick={() => void refresh()}>
        Consultar processamento
      </Button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            {data.pending} pendentes · {data.failed} falhadas · {data.done}{" "}
            concluídas. Eventos: {data.events_enabled ? "ativos" : "desligados"}
            ; entrega: {data.delivery_enabled ? "ativa" : "desligada"}.
          </p>
          {data.oldest_pending && (
            <p>
              Pendente mais antigo:{" "}
              {new Date(data.oldest_pending).toLocaleString("pt-PT")}
            </p>
          )}
          <ul>
            {data.failed_batches.map((r: any) => (
              <li key={r.id}>
                Lote {r.id} · {r.attempts} tentativas · código {r.error_code}
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Recolocar este lote na fila? A entrega mantém deduplicação.",
                      )
                    )
                      void refresh(r.id);
                  }}
                >
                  Repetir lote falhado
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
