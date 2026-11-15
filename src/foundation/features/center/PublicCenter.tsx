import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui";
import { publicCoverUrl } from "../media/covers";
import {
  createCenterRepository,
  type CenterItem,
  type CenterRepository,
} from "./repository";
export function CampaignImage({
  image,
}: {
  image?: { publication: string; asset: string } | null;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image?.publication, image?.asset]);
  let src = "";
  try {
    if (image) src = publicCoverUrl(image.publication, image.asset);
  } catch {}
  return src && !failed ? (
    <img
      className="center-campaign-image"
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : null;
}
export function InstitutionalCard({
  item,
  preview = false,
}: {
  item: CenterItem;
  preview?: boolean;
}) {
  return (
    <article className="panel center-item">
      <CampaignImage image={item.image} />
      <p className="eyebrow">
        {preview
          ? "PRÉ-VISUALIZAÇÃO LOCAL"
          : item.kind === "campaign"
            ? "CAMPANHA"
            : "INFORMAÇÃO PUBLICADA"}
      </p>
      <h2>{item.title}</h2>
      <p className="center-text">{item.body}</p>
      {item.kind === "status" && (
        <p>
          Estado declarado:{" "}
          {
            (
              {
                operational: "operacional",
                degraded: "degradação",
                outage: "indisponibilidade",
                maintenance: "manutenção",
                information: "informação",
              } as Record<string, string>
            )[item.severity]
          }
        </p>
      )}
      {!preview && (
        <p>
          Atualizado pela administração:{" "}
          <time dateTime={item.updated_at}>
            {new Date(item.updated_at).toLocaleString("pt-PT")}
          </time>
          {item.verified_at && (
            <>
              {" "}
              · informação confirmada em{" "}
              {new Date(item.verified_at).toLocaleString("pt-PT")}
            </>
          )}
        </p>
      )}
    </article>
  );
}
export function PublicCenterPage({
  kind = "campaign",
  repository,
}: {
  kind?: string;
  repository?: CenterRepository;
}) {
  const repo = useMemo(
      () => repository ?? createCenterRepository(),
      [repository],
    ),
    [filter, setFilter] = useState(kind),
    [rows, setRows] = useState<CenterItem[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [more, setMore] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setRows([]);
    repo
      .publicItems(filter)
      .then(
        (r) => {
          if (active) {
            setRows(r);
            setMore(r.length === 12);
          }
        },
        (e) => {
          if (active) setError(e.message);
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repo, filter, retry]);
  return (
    <div className="container discovery-page">
      <h1>
        {kind === "campaign"
          ? "Campanhas"
          : "Transparência e estado da plataforma"}
      </h1>
      {kind !== "campaign" && (
        <label className="field">
          <span>Tipo de informação</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="status">Estado declarado</option>
            <option value="notice">Avisos e problemas conhecidos</option>
            <option value="update">Atualizações</option>
          </select>
        </label>
      )}
      <p>
        {kind === "campaign"
          ? "Campanhas publicadas pela administração, dentro do período indicado."
          : "Informações confirmadas e publicadas manualmente pela administração. Não constitui monitorização automática em tempo real."}
      </p>
      {loading && <p role="status">A carregar informações…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <Button onClick={() => setRetry((v) => v + 1)}>
            Tentar novamente
          </Button>
        </p>
      )}
      {!loading && !error && !rows.length && (
        <p>
          {kind === "campaign"
            ? "Nenhuma campanha publicada neste período."
            : `Nenhuma informação publicada nesta seleção.${filter === "status" ? " Não há um estado operacional confirmado para apresentar." : ""}`}
        </p>
      )}
      <div className="center-grid">
        {rows.map((item) => (
          <InstitutionalCard key={item.id} item={item} />
        ))}
      </div>
      {more && (
        <Button
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            try {
              const result = await repo.publicItems(
                filter,
                undefined,
                rows.at(-1),
              );
              setRows((prev) => [
                ...new Map([...prev, ...result].map((x) => [x.id, x])).values(),
              ]);
              setMore(result.length === 12);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setLoading(false);
            }
          }}
        >
          Carregar mais
        </Button>
      )}
      <p>
        <Link to="/suporte">Pedir suporte</Link> ·{" "}
        <Link to="/contacto">Contacto institucional</Link>
      </p>
    </div>
  );
}
