import { useEffect, useRef, useState } from "react";
import { readSlot, type visualMedia } from "./media";
import { thumbnail } from "./image";
import type { UploadItem } from "./types";
import { Button } from "../../components/ui";
export function VisualImage({
  item,
  workId,
  entryId,
  api,
  full = false,
  cache,
}: {
  item: UploadItem;
  workId: string;
  entryId: string;
  api: ReturnType<typeof visualMedia>;
  full?: boolean;
  cache: Map<string, Blob>;
}) {
  const host = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false),
    [source, setSource] = useState({ key: "", url: "" }),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const key = `${workId}/${entryId}/${item.id}/${item.asset?.id}/${full}/${item.file?.name || ""}`;
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0].isIntersecting),
      { rootMargin: full ? "900px" : "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    let url = "",
      alive = true;
    setError("");
    const load = async () => {
      let blob: Blob;
      if (!full && item.thumbnail) blob = item.thumbnail;
      else if (full && item.file) blob = item.file;
      else if (!full && cache.has(item.asset?.id || ""))
        blob = cache.get(item.asset!.id)!;
      else if (item.asset) {
        blob = await readSlot(
          () => api.read(workId, entryId, item.asset!.id, abort.signal),
          abort.signal,
        );
        if (!full) {
          blob = await thumbnail(blob, item.width, item.height);
          if (alive) {
            cache.set(item.asset.id, blob);
            while (cache.size > 32) cache.delete(cache.keys().next().value!);
          }
        }
      } else return;
      if (alive && !abort.signal.aborted) {
        url = URL.createObjectURL(blob);
        setSource({ key, url });
      }
    };
    void load().catch((e) => {
      if (alive && !abort.signal.aborted)
        setError(e instanceof Error ? e.message : "Imagem indisponível.");
    });
    return () => {
      alive = false;
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, key, item.thumbnail, item.file, api, full, retry, cache]);
  return (
    <div
      ref={host}
      className={full ? "visual-full-image" : "visual-thumb"}
      style={
        full ? { aspectRatio: `${item.width || 1} / ${item.height || 1}` } : {}
      }
    >
      {visible && source.key === key ? (
        <img
          src={source.url}
          alt={item.name}
          decoding="async"
          onError={() => setError("Não foi possível descodificar esta imagem.")}
        />
      ) : (
        <span aria-hidden="true">Imagem</span>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSource({ key: "", url: "" });
              setRetry((n) => n + 1);
            }}
          >
            Repetir leitura
          </Button>
        </div>
      )}
    </div>
  );
}
