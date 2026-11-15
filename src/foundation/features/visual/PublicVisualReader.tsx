import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Select } from "../../components/ui";
import type { PublishedWork } from "../catalog/repository";
import { getPublicClient } from "../catalog/repository";
import type { Chapter } from "../reader/types";
import { recordReading } from "../reader/progress";
import { currentScope, inScope } from "../local/persistence";
import {
  createPublicVisualRepository,
  publicVisualImageUrl,
  PUBLIC_VISUAL_BATCH,
  visualStep,
  type PublicVisualRepository,
  type PublicVisualPage,
} from "./public";

export function PublicVisualImage({
  page,
  src,
  onRead,
}: {
  page: PublicVisualPage;
  src: string;
  onRead?: () => void;
}) {
  const host = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <figure
      ref={host}
      className="public-visual-image"
      data-reader-page={page.position}
      style={{ aspectRatio: `${page.width}/${page.height}` }}
    >
      {visible && !error && (
        <img
          key={`${src}:${retry}`}
          src={src}
          alt={`Página ${page.position}`}
          width={page.width}
          height={page.height}
          decoding="async"
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={onRead}
          onError={() => setError(true)}
        />
      )}
      {!visible && <span className="sr-only">Página {page.position}</span>}
      {error && (
        <div className="public-visual-image-error" role="alert">
          <p>
            Não foi possível carregar a página {page.position}. A imagem pode
            estar indisponível ou a publicação pode ter sido retirada.
          </p>
          <Button
            onClick={() => {
              setError(false);
              setRetry((n) => n + 1);
            }}
          >
            Repetir imagem {page.position}
          </Button>
        </div>
      )}
    </figure>
  );
}
export function PublicVisualReader({
  work,
  chapter,
  repository,
  imageUrl = publicVisualImageUrl,
}: {
  work: PublishedWork;
  chapter: Chapter;
  repository?: PublicVisualRepository;
  imageUrl?: (work: string, entry: string, page: string) => string;
}) {
  const api = useMemo(
    () => repository ?? createPublicVisualRepository(getPublicClient()),
    [repository],
  );
  const settings = work.visualSettings!;
  const total = chapter.publicVisualPageCount ?? 0;
  const [mode, setMode] = useState(settings.mode),
    [direction, setDirection] = useState(settings.direction),
    [current, setCurrent] = useState(0);
  const [fit, setFit] = useState<"width" | "height">("width"),
    [zoom, setZoom] = useState(100),
    [immersive, setImmersive] = useState(false),
    [theme, setTheme] = useState("platform");
  const [pages, setPages] = useState<Map<number, PublicVisualPage>>(new Map()),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [unavailable, setUnavailable] = useState(false),
    [end, setEnd] = useState(PUBLIC_VISUAL_BATCH),
    [revision, setRevision] = useState(0);
  const pending = useRef(new Set<number>()),
    loaded = useRef(new Set<number>()),
    alive = useRef(true),
    sentinel = useRef<HTMLDivElement>(null),
    reader = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const scope = currentScope();
  useEffect(() => {
    if (!immersive) return;
    const prior = document.activeElement as HTMLElement | null;
    reader.current?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const controls = [
        ...(reader.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not(:disabled),select,summary,[tabindex="0"]',
        ) ?? []),
      ].filter((el) => el.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (!first) return;
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === reader.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.removeEventListener("keydown", trap);
      prior?.focus();
    };
  }, [immersive]);
  useEffect(() => {
    if (mode !== "vertical" || !pages.has(current) || unavailable) return;
    const timer = setTimeout(
      () =>
        inScope(scope, () =>
          recordReading({
            workId: work.id,
            workTitle: work.title,
            author: work.author,
            chapters: work.chapters,
            currentChapter: chapter,
            mode: work.format === "Mangá" ? "manga" : "comic",
            position: (current + 1) / Math.max(total, 1),
          }),
        ),
      250,
    );
    return () => clearTimeout(timer);
  }, [mode, current, pages, scope, unavailable, work, chapter, total]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(
    async (offset: number) => {
      if (
        offset >= total ||
        offset < 0 ||
        pending.current.has(offset) ||
        loaded.current.has(offset)
      )
        return;
      pending.current.add(offset);
      setLoading(true);
      setError("");
      try {
        const batch = await api.pages(work.id, chapter.id, offset);
        if (!alive.current) return;
        if (!batch) {
          setUnavailable(true);
          setPages(new Map());
          return;
        }
        if (batch.total !== total)
          throw Error(
            "Esta edição foi atualizada. Reabre a obra para carregar a nova sequência.",
          );
        loaded.current.add(offset);
        setPages((old) => {
          const next = new Map(old);
          batch.items.forEach((p) => next.set(p.position - 1, p));
          return next;
        });
      } catch (e) {
        if (alive.current)
          setError(
            e instanceof Error
              ? e.message
              : "Não foi possível carregar as páginas.",
          );
      } finally {
        pending.current.delete(offset);
        if (alive.current) setLoading(pending.current.size > 0);
      }
    },
    [api, work.id, chapter.id, total],
  );
  useEffect(() => {
    void load(Math.floor(current / PUBLIC_VISUAL_BATCH) * PUBLIC_VISUAL_BATCH);
  }, [load, current, revision]);
  useEffect(() => {
    if (mode !== "vertical") return;
    for (
      let offset = 0;
      offset < Math.min(total, end);
      offset += PUBLIC_VISUAL_BATCH
    )
      void load(offset);
  }, [load, mode, end, revision, total]);
  useEffect(() => {
    const node = sentinel.current;
    if (mode !== "vertical" || !node || loading || error || end >= total)
      return;
    const observer = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting)
          setEnd((n) => Math.min(total, n + PUBLIC_VISUAL_BATCH));
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [mode, loading, error, end, total]);
  const visiblePages =
    mode === "vertical"
      ? [...pages.entries()]
          .filter(([index]) => index < end)
          .sort(([a], [b]) => a - b)
          .map(([, p]) => p)
      : pages.has(current)
        ? [pages.get(current)!]
        : [];
  const go = useCallback(
    (index: number) => setCurrent(Math.max(0, Math.min(total - 1, index))),
    [total],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setImmersive(false);
        return;
      }
      const target = e.target as HTMLElement;
      if (
        mode !== "paged" ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        (target instanceof Element &&
          target.closest(
            'input,select,textarea,button,a,[contenteditable="true"]',
          ))
      )
        return;
      const delta = visualStep(e.key, direction);
      if (delta) {
        e.preventDefault();
        go(current + delta);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, direction, go, mode]);
  useEffect(() => {
    if (mode !== "vertical") return;
    const root = reader.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0])
          setCurrent(
            Number((visible[0].target as HTMLElement).dataset.readerPage) - 1,
          );
      },
      { root: immersive ? root : null, rootMargin: "-10% 0px -50% 0px" },
    );
    root
      .querySelectorAll("[data-reader-page]")
      .forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [mode, pages, immersive]);
  function record(index: number) {
    inScope(scope, () =>
      recordReading({
        workId: work.id,
        workTitle: work.title,
        author: work.author,
        chapters: work.chapters,
        currentChapter: chapter,
        mode: work.format === "Mangá" ? "manga" : "comic",
        position: (index + 1) / Math.max(total, 1),
      }),
    );
  }
  // Prefetch at most one next image, and only metadata already loaded. No full-chapter download.
  const nextPage = mode === "paged" ? pages.get(current + 1) : undefined;
  const slow =
    typeof navigator !== "undefined"
      ? (
          navigator as Navigator & {
            connection?: { saveData?: boolean; effectiveType?: string };
          }
        ).connection
      : undefined;
  const preload =
    nextPage &&
    !slow?.saveData &&
    !["slow-2g", "2g"].includes(slow?.effectiveType ?? "");
  const index = work.chapters.findIndex((e) => e.id === chapter.id),
    previous = work.chapters[index - 1],
    next = work.chapters[index + 1];
  if (unavailable || total < 1)
    return (
      <section className="container">
        <h1>Capítulo indisponível</h1>
        <p>Esta sequência já não está publicada.</p>
        <Link to={`/obras/${work.id}`}>Voltar à obra</Link>
      </section>
    );
  return (
    <div
      ref={reader}
      tabIndex={-1}
      className={`public-visual-reader ${immersive ? "public-visual-immersive" : ""}`}
      data-reading-theme={theme}
      data-mode={mode}
      aria-label="Leitor visual público"
    >
      <header className="public-visual-toolbar">
        <Link to={`/obras/${work.id}`}>← {work.title}</Link>
        <h1>{chapter.title}</h1>
        <p>
          {work.authorUsername ? (
            <Link to={`/utilizadores/${work.authorUsername}`}>
              {work.author}
            </Link>
          ) : (
            work.author
          )}
        </p>
        <div className="public-visual-controls">
          <Select
            label="Modo de leitura"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as typeof mode);
              setCurrent(0);
            }}
          >
            <option value="paged">Paginado</option>
            <option value="vertical">Vertical contínuo</option>
          </Select>
          {mode === "paged" && (
            <Select
              label="Direção de leitura"
              value={direction}
              onChange={(e) => setDirection(e.target.value as typeof direction)}
            >
              <option value="ltr">Esquerda → direita</option>
              <option value="rtl">Direita → esquerda</option>
            </Select>
          )}
          <Select
            label="Ajustar página"
            value={fit}
            onChange={(e) => setFit(e.target.value as typeof fit)}
          >
            <option value="width">À largura</option>
            <option value="height">À altura</option>
          </Select>
          <Select
            label="Tema de leitura"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="platform">Tema da aplicação</option>
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
          </Select>
          <Button
            variant="secondary"
            disabled={zoom <= 50}
            onClick={() => setZoom((n) => Math.max(50, n - 25))}
            aria-label="Diminuir zoom"
          >
            −
          </Button>
          <output aria-label="Zoom">{zoom}%</output>
          <Button
            variant="secondary"
            disabled={zoom >= 250}
            onClick={() => setZoom((n) => Math.min(250, n + 25))}
            aria-label="Aumentar zoom"
          >
            +
          </Button>
          <Button variant="ghost" onClick={() => setZoom(100)}>
            Repor zoom
          </Button>
          <Button
            aria-pressed={immersive}
            onClick={() => setImmersive((v) => !v)}
          >
            {immersive ? "Sair do modo imersivo" : "Modo imersivo"}
          </Button>
        </div>
        <details>
          <summary>Índice de capítulos</summary>
          <ol>
            {work.chapters.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/obras/${work.id}/capitulos/${c.id}`}
                  aria-current={c.id === chapter.id ? "page" : undefined}
                >
                  {c.number}. {c.title}
                </Link>
              </li>
            ))}
          </ol>
        </details>
        <p role="status" aria-live="polite">
          Página {current + 1} de {total} ·{" "}
          {Math.round(((current + 1) / total) * 100)}%
        </p>
        <progress
          aria-label="Progresso do capítulo"
          value={current + 1}
          max={total}
        />
        {mode === "paged" && (
          <div
            className="actions"
            style={{
              flexDirection: direction === "rtl" ? "row-reverse" : "row",
            }}
          >
            <Button disabled={current === 0} onClick={() => go(current - 1)}>
              Página anterior
            </Button>
            <Button
              disabled={current >= total - 1}
              onClick={() => go(current + 1)}
            >
              Página seguinte
            </Button>
          </div>
        )}
      </header>
      {error && (
        <div role="alert" className="notice">
          <p>{error}</p>
          <Button onClick={() => setRevision((n) => n + 1)}>
            Repetir carregamento
          </Button>
          <Link to={`/obras/${work.id}`}>Reabrir a obra</Link>
        </div>
      )}
      {loading && <p role="status">A carregar páginas publicadas…</p>}
      <section
        className={`public-visual-canvas fit-${fit}`}
        tabIndex={0}
        aria-label="Páginas publicadas"
        style={{ "--visual-zoom": String(zoom / 100) } as React.CSSProperties}
        onTouchStart={(e) => {
          touch.current =
            e.touches.length === 1
              ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
              : null;
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          if (
            !start ||
            mode !== "paged" ||
            zoom !== 100 ||
            e.changedTouches.length !== 1 ||
            e.currentTarget.scrollWidth > e.currentTarget.clientWidth + 1
          )
            return;
          const dx = e.changedTouches[0].clientX - start.x,
            dy = e.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
            go(
              current +
                visualStep(dx > 0 ? "ArrowLeft" : "ArrowRight", direction),
            );
        }}
      >
        {visiblePages.map((page) => (
          <PublicVisualImage
            key={page.id}
            page={page}
            src={imageUrl(work.id, chapter.id, page.id)}
            onRead={() => {
              if (mode === "paged") record(page.position - 1);
            }}
          />
        ))}
        {preload && (
          <img
            className="public-visual-preload"
            aria-hidden="true"
            alt=""
            src={imageUrl(work.id, chapter.id, nextPage!.id)}
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
          />
        )}
      </section>
      {mode === "vertical" && (
        <>
          <div ref={sentinel} />
          {end < total && (
            <Button
              disabled={loading || Boolean(error)}
              onClick={() =>
                setEnd((n) => Math.min(total, n + PUBLIC_VISUAL_BATCH))
              }
            >
              Carregar próximas imagens
            </Button>
          )}
          <Button variant="ghost" onClick={() => record(current)}>
            Guardar posição neste navegador
          </Button>
        </>
      )}
      <nav
        className="public-visual-chapter-links"
        aria-label="Navegar entre capítulos"
      >
        {previous && (
          <Link to={`/obras/${work.id}/capitulos/${previous.id}`}>
            ← {previous.title}
          </Link>
        )}
        {next && (
          <Link to={`/obras/${work.id}/capitulos/${next.id}`}>
            {next.title} →
          </Link>
        )}
      </nav>
    </div>
  );
}
