class MetricResponseError extends Error {}
import { useEffect, useState } from "react";
export function metricFailureMessage(code?: string) {
  const messages: Record<string, string> = {
    METRICS_PROOF_REJECTED:
      "A integração de métricas precisa de validação administrativa (prova recusada).",
    METRICS_PERMISSION_DENIED:
      "As permissões da integração de métricas precisam de revisão.",
    METRICS_SCHEMA_UNAVAILABLE:
      "As funções de métricas ainda não estão disponíveis neste ambiente.",
    METRICS_CONTENT_UNAVAILABLE:
      "Esta publicação já não está disponível para contagem.",
  };
  return (
    (code && Object.hasOwn(messages, code) ? messages[code] : undefined) ??
    "A contagem de leitura está temporariamente indisponível."
  );
}
const preference = "ag_social_metrics_optin_v1";
export function ReadingMetric({
  workId,
  entryId,
  onCount,
}: {
  workId: string;
  entryId?: string;
  onCount: () => void;
}) {
  const [enabled, setEnabled] = useState(() => {
      try {
        return localStorage.getItem(preference) === "true";
      } catch {
        return false;
      }
    }),
    [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let elapsed = 0,
      last = performance.now(),
      active = false,
      sent = false;
    const interaction = (e: Event) => {
      if (e.isTrusted) active = true;
    };
    for (const name of ["pointerdown", "keydown", "scroll"])
      window.addEventListener(name, interaction, { passive: true });
    const timer = setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === "visible" && active)
        elapsed += Math.min(now - last, 1500);
      last = now;
      if (sent || elapsed < (entryId ? 20000 : 8000)) return;
      sent = true;
      void fetch("/api/social-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work: workId, entry: entryId ?? null }),
        credentials: "same-origin",
        cache: "no-store",
      })
        .then(async (r) => {
          if (!r.ok) {
            const failure = await r.json().catch(() => null);
            throw new MetricResponseError(metricFailureMessage(failure?.code));
          }
          const result = await r.json();
          if (typeof result.counted !== "boolean") throw Error();
          onCount();
        })
        .catch((e) =>
          setError(
            e instanceof MetricResponseError
              ? e.message
              : metricFailureMessage(),
          ),
        );
    }, 1000);
    return () => {
      clearInterval(timer);
      for (const name of ["pointerdown", "keydown", "scroll"])
        window.removeEventListener(name, interaction);
    };
    // Keep one dwell window per displayed public target; aggregate refresh must not restart it.
  }, [enabled, workId, entryId]);
  return (
    <div className="social-metric-preference">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            const value = e.target.checked;
            setEnabled(value);
            setError("");
            try {
              localStorage.setItem(preference, String(value));
            } catch {}
            if (!value)
              void fetch("/api/social-metrics", {
                method: "DELETE",
                credentials: "same-origin",
              }).catch(() =>
                setError(
                  "Não foi possível limpar o identificador de contagem agora.",
                ),
              );
          }}
        />{" "}
        Permitir contagem de leitura neste navegador
      </label>
      <p>
        Opcional. Usa um identificador pseudónimo por 30 dias, sem associar a
        contagem à tua conta. Atualizações em menos de 24 horas não contam
        novamente. Páginas pré-carregadas não contam como leitura.
      </p>
      {error && <p role="status">{error}</p>}
    </div>
  );
}
