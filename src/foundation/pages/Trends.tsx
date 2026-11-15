import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageIntro } from "../components/Discovery";
import { Button, EmptyState, Select } from "../components/ui";
import { WorkCard } from "../components/WorkCard";
import { discoveryFormats } from "../features/catalog/discovery";
import { socialEnabled } from "../features/social/repository";
import {
  createRankingsRepository,
  rankingModes,
  type RankingMode,
  type RankingPage,
  type RankingsRepository,
} from "../features/social/rankings";
export default function Trends({
  repository,
  enabled = socialEnabled,
}: { repository?: RankingsRepository; enabled?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const repo = useMemo(
    () => repository ?? createRankingsRepository(),
    [repository],
  );
  const mode = rankingModes.includes(params.get("ordem") as RankingMode)
    ? (params.get("ordem") as RankingMode)
    : "featured";
  const format = discoveryFormats.includes(params.get("formato") ?? "")
      ? params.get("formato")!
      : "",
    sensitive = params.get("conteudo") === "explicito";
  const number = Number(params.get("pagina") ?? 1),
    page = Number.isSafeInteger(number)
      ? Math.max(1, Math.min(number, 10000))
      : 1;
  const [data, setData] = useState<RankingPage | null>(null),
    [loading, setLoading] = useState(enabled),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setLoading(true);
    setError("");
    setData(null);
    repo
      .list(mode, format, sensitive, page)
      .then(
        (result) => {
          if (current) setData(result);
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
  }, [repo, mode, format, sensitive, page, retry, enabled]);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key !== "pagina") next.delete("pagina");
    setParams(next);
  };
  return (
    <div className="container discovery-page">
      <PageIntro
        eyebrow="DESCOBERTA"
        title="O que nos move a imaginar."
        description="Tendências de obras publicadas, calculadas a partir de interações reais."
      />
      {!enabled ? (
        <EmptyState title="Tendências em preparação">
          <Link to="/catalogo">Explorar obras publicadas</Link>
        </EmptyState>
      ) : (
        <>
          <p>Classificações acumuladas de interações confirmadas.</p>
          <div className="actions social-actions">
            <Select
              label="Classificação"
              value={mode}
              onChange={(e) => change("ordem", e.target.value)}
            >
              <option value="featured">Em destaque</option>
              <option value="views">Mais vistas</option>
              <option value="likes">Mais curtidas</option>
              <option value="favorites">Mais favoritadas</option>
              <option value="comments">Mais comentadas</option>
            </Select>
            <Select
              label="Formato"
              value={format}
              onChange={(e) => change("formato", e.target.value)}
            >
              <option value="">Todos os formatos</option>
              {discoveryFormats.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            <label>
              <input
                type="checkbox"
                checked={sensitive}
                onChange={(e) =>
                  change("conteudo", e.target.checked ? "explicito" : "geral")
                }
              />{" "}
              Incluir obras +18 e com avisos de conteúdo
            </label>
          </div>
          <details>
            <summary>Como calculamos o destaque</summary>
            <p>
              Combinamos visualizações, curtidas, favoritos, seguidores e
              comentários visíveis. Usamos logaritmos para equilibrar os
              volumes: ln(1 + vistas) + 3 × ln(1 + curtidas) + 4 × ln(1 +
              favoritos) + 2 × ln(1 + seguidores) + ln(1 + comentários). Empates
              são ordenados pela primeira publicação mais recente e pelo
              identificador público.
            </p>
          </details>
          {loading && <p role="status">A carregar tendências…</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <Button onClick={() => setRetry((v) => v + 1)}>
                Tentar novamente
              </Button>
            </div>
          )}
          {!loading && !error && data && !data.items.length && (
            <EmptyState title="Ainda não há obras com interações nesta seleção">
              <p>
                Experimenta outra classificação ou formato. As tendências surgem
                com as interações reais dos leitores.
              </p>
              <Link to="/catalogo">Explorar o catálogo</Link>
            </EmptyState>
          )}
          {data && data.items.length > 0 && (
            <>
              <p>{data.total} obras nesta classificação</p>
              <ol
                className="work-grid social-rankings"
                start={(data.page - 1) * data.size + 1}
              >
                {data.items.map((item) => (
                  <li key={item.work.id}>
                    <WorkCard work={item.work} />
                    <p>
                      {item.views} visualizações · {item.likes} curtidas ·{" "}
                      {item.favorites} favoritos · {item.comments} comentários
                    </p>
                  </li>
                ))}
              </ol>
              <nav className="actions" aria-label="Paginação de tendências">
                <Button
                  variant="secondary"
                  disabled={loading || page <= 1}
                  onClick={() => change("pagina", String(page - 1))}
                >
                  Anterior
                </Button>
                <span>Página {data.page}</span>
                <Button
                  variant="secondary"
                  disabled={loading || data.page * data.size >= data.total}
                  onClick={() => change("pagina", String(page + 1))}
                >
                  Seguinte
                </Button>
              </nav>
            </>
          )}
        </>
      )}
    </div>
  );
}
