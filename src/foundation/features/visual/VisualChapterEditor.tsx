import { useState, useRef, useEffect, useMemo, lazy, Suspense } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Field, Select, Modal } from "../../components/ui";
import { useRemoteWorks } from "../studio/RemoteWorksProvider";
import type { StudioWork } from "../studio/types";
import type { Chapter } from "../reader/types";
import { entryPath } from "../studio/RemoteEntryEditor";
import { VisualImage } from "./VisualImage";
import { visualMedia, mapLimited } from "./media";
import { inspectFile, thumbnail } from "./image";
import {
  defaultVisualSettings,
  VISUAL_LIMITS,
  savedItems,
  pagePayload,
  moveItem,
  naturalOrder,
  type UploadItem,
  type VisualLimits,
  type VisualSettings,
} from "./types";
const RichEditor = lazy(() =>
  import("../writing/RichEditor").then((m) => ({ default: m.RichEditor })),
);
export function VisualChapterEditor({
  work,
  entry,
  media,
}: {
  work: StudioWork;
  entry: Chapter;
  media?: ReturnType<typeof visualMedia>;
}) {
  const remote = useRemoteWorks(),
    navigate = useNavigate(),
    buffer = remote.controller?.visualBuffers.get(entry.id);
  const [base, setBase] = useState(buffer?.base ?? work),
    [title, setTitle] = useState(buffer?.title ?? entry.title),
    [script, setScript] = useState(buffer?.script ?? entry.content ?? "");
  const [settings, setSettings] = useState<VisualSettings>(
    buffer?.settings ??
      work.visualSettings ??
      defaultVisualSettings(work.format),
  );
  const [items, setItems] = useState<UploadItem[]>(
    () =>
      buffer?.items.map((p) =>
        p.status === "uploading"
          ? { ...p, status: p.file ? "local" : "error" }
          : p,
      ) ?? savedItems(entry.visualPages ?? []),
  );
  const [limits, setLimits] = useState<VisualLimits>(VISUAL_LIMITS),
    [limitsReady, setLimitsReady] = useState(false),
    [limitsRetry, setLimitsRetry] = useState(0),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [uploading, setUploading] = useState(false),
    [preparing, setPreparing] = useState(false),
    [prepared, setPrepared] = useState(0),
    [scriptOpen, setScriptOpen] = useState(false),
    [preview, setPreview] = useState(false),
    [current, setCurrent] = useState(0),
    [shown, setShown] = useState(20),
    [dragging, setDragging] = useState<string | null>(null),
    [confirmation, setConfirmation] = useState<{
      kind: "remove" | "delete" | "recover" | "cleanup" | "sort";
      id?: string;
    } | null>(null);
  const alive = useRef(true),
    uploadAbort = useRef<AbortController | null>(null),
    replaceTarget = useRef<string | null>(null),
    replacementInput = useRef<HTMLInputElement>(null),
    cache = useRef(new Map<string, Blob>());
  const api = useMemo(
    () => media ?? visualMedia(work.ownerId ?? ""),
    [media, work.ownerId],
  );
  useEffect(
    () => setCurrent((n) => Math.max(0, Math.min(n, items.length - 1))),
    [items.length],
  );
  const original = base.chapters.find((c) => c.id === entry.id),
    episode = settings.format === "webtoon",
    label = episode ? "episódio" : "capítulo";
  const stored = original?.visualPages ?? [];
  const dirty =
    title !== (original?.title ?? entry.title) ||
    script !== (original?.content ?? entry.content ?? "") ||
    JSON.stringify(settings) !==
      JSON.stringify(
        base.visualSettings ?? defaultVisualSettings(base.format),
      ) ||
    items.length !== stored.length ||
    items.some(
      (p, i) =>
        p.status !== "saved" ||
        p.id !== stored[i]?.id ||
        p.asset?.id !== stored[i]?.asset.id,
    );
  const busy = uploading || preparing || remote.saving,
    disabled = busy || Boolean(base.archivedAt),
    unready = items.some((p) => !["saved", "uploaded"].includes(p.status));
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      uploadAbort.current?.abort();
      cache.current.clear();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLimitsReady(false);
    api.limits().then(
      (v) => {
        if (active) {
          setLimits(v);
          setLimitsReady(true);
        }
      },
      (e) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [api, limitsRetry]);
  useEffect(() => {
    if (dirty || uploading || preparing)
      remote.controller?.visualBuffers.set(entry.id, {
        base,
        title,
        script,
        settings,
        items,
      });
    else remote.controller?.visualBuffers.delete(entry.id);
  }, [
    base,
    title,
    script,
    settings,
    items,
    dirty,
    uploading,
    preparing,
    entry.id,
    remote.controller,
  ]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const links = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest?.("a[href]") || e.defaultPrevented)
        return;
      if (
        busy ||
        !window.confirm(
          "Há alterações visuais por guardar. Sair e descartá-las?",
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      } else remote.controller?.visualBuffers.delete(entry.id);
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("click", links, true);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("click", links, true);
    };
  }, [dirty, busy, entry.id, remote.controller]);
  function update(id: string, patch: Partial<UploadItem>) {
    if (alive.current)
      setItems((rows) =>
        rows.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      );
  }
  async function select(files: File[], replaceId?: string) {
    if (disabled || !limitsReady || !files.length) return;
    if (!replaceId && items.length + files.length > limits.pages) {
      setError(`O limite configurado é ${limits.pages} imagens por ${label}.`);
      return;
    }
    setPreparing(true);
    setPrepared(0);
    setSaved(false);
    setError("");
    const pending = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      bytes: file.size,
      width: 0,
      height: 0,
      status: "local" as const,
    }));
    if (!replaceId) setItems((rows) => [...rows, ...pending]);
    try {
      for (let i = 0; i < pending.length; i++) {
        const item = pending[i];
        try {
          if (item.file.size > limits.bytes)
            throw Error(
              `A imagem excede ${Math.round(limits.bytes / 1048576)} MB.`,
            );
          const info = await inspectFile(item.file);
          if (
            info.width > limits.width ||
            info.height > limits.height ||
            info.width * info.height > limits.pixels
          )
            throw Error("Dimensões acima do limite configurado.");
          const small = await thumbnail(item.file, info.width, info.height);
          if (!alive.current) return;
          if (replaceId)
            setItems((rows) =>
              rows.map((p) =>
                p.id === replaceId
                  ? { ...item, id: replaceId, thumbnail: small, ...info }
                  : p,
              ),
            );
          else update(item.id, { ...info, thumbnail: small });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Imagem inválida.";
          if (replaceId) {
            update(replaceId, {
              error: `Substituição recusada: ${message} Imagem anterior preservada.`,
            });
          } else update(item.id, { status: "error", error: message });
        }
        if (!alive.current) return;
        setPrepared(i + 1);
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      if (alive.current) setPreparing(false);
    }
  }
  async function upload(onlyId?: string) {
    if (disabled || !limitsReady) return;
    const pending = items.filter(
      (p) =>
        p.file &&
        (onlyId
          ? p.id === onlyId
          : p.status === "local" || p.status === "error"),
    );
    if (!pending.length) return;
    const abort = new AbortController();
    uploadAbort.current = abort;
    setUploading(true);
    setError("");
    setSaved(false);
    try {
      await mapLimited(
        pending,
        2,
        async (item) => {
          update(item.id, { status: "uploading", error: undefined });
          try {
            const asset = await api.upload(
              base.id,
              entry.id,
              item.file!,
              abort.signal,
            );
            update(item.id, {
              asset,
              status: "uploaded",
              name: asset.filename,
              width: asset.width,
              height: asset.height,
              bytes: asset.bytes,
              error: undefined,
            });
          } catch (e) {
            update(item.id, {
              status: "error",
              error: e instanceof Error ? e.message : "Falha no upload.",
            });
          }
        },
        abort.signal,
      );
    } finally {
      if (alive.current) setUploading(false);
    }
  }
  async function save() {
    if (disabled || !original || !remote.controller) return;
    setError("");
    setSaved(false);
    try {
      const pages = pagePayload(items);
      const result = await remote.controller.saveVisual(
        base,
        entry.id,
        original.revision!,
        { title, script, settings, pages },
      );
      if (result && alive.current) {
        setBase(result);
        const fresh = result.chapters.find((c) => c.id === entry.id)!;
        setTitle(fresh.title);
        setScript(fresh.content ?? "");
        setSettings(result.visualSettings ?? settings);
        setItems(savedItems(fresh.visualPages ?? []));
        setSaved(true);
        remote.controller.visualBuffers.delete(entry.id);
      } else if (alive.current)
        setError(
          remote.controller.getSnapshot().error ||
            "O servidor não confirmou o capítulo. As alterações locais foram preservadas.",
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível guardar.");
    }
  }
  async function recover() {
    const result = await remote.controller?.recover(work.id);
    if (result) {
      remote.controller?.visualBuffers.delete(entry.id);
      const fresh = result.chapters.find((c) => c.id === entry.id);
      if (!fresh) {
        navigate(`/estudio/obras/${work.id}`);
        return;
      }
      setBase(result);
      setTitle(fresh.title);
      setScript(fresh.content ?? "");
      setSettings(
        result.visualSettings ?? defaultVisualSettings(result.format),
      );
      setItems(savedItems(fresh.visualPages ?? []));
      setSaved(false);
      setError("");
    }
  }
  async function structure(
    action: "add_entry" | "delete_entry" | "reorder_entries",
    payload: Record<string, unknown> = {},
  ) {
    if (disabled || dirty) return;
    const result = await remote.controller?.editorial(base, action, payload);
    if (!result?.work) {
      setError(
        remote.controller?.getSnapshot().error ||
          "Não foi possível alterar os capítulos.",
      );
      return;
    }
    setBase(result.work);
    if (action === "add_entry") {
      const next = result.work.chapters.find(
        (c) => !base.chapters.some((old) => old.id === c.id),
      );
      if (next) navigate(entryPath(result.work, next));
    }
    if (action === "delete_entry") {
      const next = result.work.chapters[0];
      navigate(
        next ? entryPath(result.work, next) : `/estudio/obras/${work.id}`,
      );
    }
  }
  function moveChapter(index: number, step: number) {
    const ids = base.chapters.map((c) => c.id);
    void structure("reorder_entries", {
      ids: moveItem(ids, index, index + step),
    });
  }
  function movePage(id: string, target: number) {
    if (disabled) return;
    setItems((rows) =>
      moveItem(
        rows,
        rows.findIndex((p) => p.id === id),
        target,
      ),
    );
    setSaved(false);
  }
  function showPage(index: number) {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setCurrent(next);
    setShown((n) => Math.max(n, Math.ceil((next + 1) / 20) * 20));
    if (settings.mode === "vertical")
      requestAnimationFrame(() =>
        document
          .getElementById(`visual-preview-${next}`)
          ?.scrollIntoView({ block: "start" }),
      );
  }
  async function confirm() {
    const action = confirmation;
    setConfirmation(null);
    if (!action) return;
    if (action.kind === "remove")
      setItems((rows) => rows.filter((p) => p.id !== action.id));
    if (action.kind === "sort") setItems((rows) => naturalOrder(rows));
    if (action.kind === "recover") await recover();
    if (action.kind === "delete")
      await structure("delete_entry", {
        entry_id: entry.id,
        entry_revision: original?.revision,
      });
    if (action.kind === "cleanup")
      try {
        const removed = await api.cleanup();
        setError("");
        setSaved(false);
        setNotice(`${removed} ficheiros antigos não utilizados eliminados.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Limpeza indisponível.");
      }
  }
  const [notice, setNotice] = useState("");
  const statusText = {
    local: "Local · por enviar",
    uploading: "A enviar…",
    uploaded: "Enviada · por associar",
    saved: "Guardada no capítulo",
    error: "Erro · por enviar",
  };
  const completed = items.filter(
    (p) => p.status === "uploaded" || p.status === "saved",
  ).length;
  return (
    <section
      className="container studio-page visual-editor"
      aria-label="Editor visual privado"
    >
      <header className="editor-top-bar">
        <Link to={`/estudio/obras/${work.id}`}>← {work.title}</Link>
        <span>
          Editor visual privado ·{" "}
          {episode
            ? "Webtoon"
            : settings.format === "manga"
              ? "Mangá"
              : settings.format === "webcomic"
                ? "Webcomic"
                : "HQ"}
        </span>
      </header>
      <h1>
        {episode ? "Editar episódio" : "Editar capítulo"} — {entry.title}
      </h1>
      <p role="status">
        {preparing
          ? `A preparar imagens: ${prepared}`
          : uploading
            ? `Upload em curso · ${completed}/${items.length} enviadas`
            : remote.saving
              ? "A guardar…"
              : dirty
                ? "Alterações locais por guardar"
                : saved
                  ? "Capítulo guardado na conta"
                  : "Última versão persistida"}
      </p>
      {(error || remote.error) && <p role="alert">{error || remote.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!limitsReady && (
        <div className="notice">
          <p>Uploads bloqueados até confirmar os limites do serviço.</p>
          <Button
            onClick={() => {
              setError("");
              setLimitsRetry((n) => n + 1);
            }}
          >
            Repetir configuração
          </Button>
        </div>
      )}
      {base.archivedAt && (
        <p>Obra arquivada: restaura-a na gestão para editar.</p>
      )}
      <p className="notice">
        Estas imagens são privadas. A publicação visual aguarda a F4.2-C/D.{" "}
        {base.status === "published"
          ? "A versão pública anterior permanece inalterada."
          : ""}
      </p>
      <div className="visual-workspace">
        <details className="visual-chapter-nav" open>
          <summary>
            {episode ? "Episódios" : "Capítulos"} ({base.chapters.length})
          </summary>
          <Button
            disabled={disabled || dirty}
            onClick={() =>
              void structure("add_entry", {
                title: `${episode ? "Episódio" : "Capítulo"} ${base.chapters.length + 1}`,
              })
            }
          >
            Adicionar {label}
          </Button>
          <ol>
            {base.chapters.map((chapter, i) => (
              <li key={chapter.id}>
                <Link
                  to={entryPath(base, chapter)}
                  aria-current={chapter.id === entry.id ? "page" : undefined}
                >
                  {chapter.number}. {chapter.title}
                </Link>
                <div className="actions">
                  <Button
                    variant="ghost"
                    aria-label={`Subir ${chapter.title}`}
                    disabled={disabled || dirty || i === 0}
                    onClick={() => moveChapter(i, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Descer ${chapter.title}`}
                    disabled={
                      disabled || dirty || i === base.chapters.length - 1
                    }
                    onClick={() => moveChapter(i, 1)}
                  >
                    ↓
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </details>
        <section className="visual-editor-main">
          <fieldset disabled={disabled}>
            <Field
              label={`Título do ${label}`}
              value={title}
              maxLength={200}
              onChange={(e) => {
                setTitle(e.target.value);
                setSaved(false);
              }}
            />
            <div className="visual-settings">
              <Select
                label="Formato visual"
                value={settings.format}
                onChange={(e) =>
                  setSettings((v) => ({
                    ...v,
                    format: e.target.value as VisualSettings["format"],
                    ...(e.target.value === "webtoon"
                      ? { mode: "vertical" as const, direction: "ltr" as const }
                      : {}),
                  }))
                }
              >
                <option value="hq">HQ</option>
                <option value="manga">Mangá</option>
                <option value="webtoon">Webtoon</option>
                <option value="webcomic">Webcomic</option>
              </Select>
              <Select
                label="Modo de pré-visualização"
                value={settings.mode}
                disabled={episode}
                onChange={(e) =>
                  setSettings((v) => ({
                    ...v,
                    mode: e.target.value as "paged" | "vertical",
                  }))
                }
              >
                <option value="paged">Paginado</option>
                <option value="vertical">Vertical contínuo</option>
              </Select>
              {settings.mode === "paged" && (
                <Select
                  label="Direção de leitura"
                  value={settings.direction}
                  onChange={(e) =>
                    setSettings((v) => ({
                      ...v,
                      direction: e.target.value as "ltr" | "rtl",
                    }))
                  }
                >
                  <option value="ltr">Esquerda → direita</option>
                  <option value="rtl">Direita → esquerda</option>
                </Select>
              )}
            </div>
            <div
              className="visual-drop-zone"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) e.preventDefault();
              }}
              onDrop={(e) => {
                if (e.dataTransfer.files.length) {
                  e.preventDefault();
                  void select(Array.from(e.dataTransfer.files));
                }
              }}
            >
              <label className="field">
                <span>
                  Adicionar {episode ? "imagens ou segmentos" : "páginas"} ·
                  selecionar ou largar ficheiros
                </span>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  disabled={!limitsReady}
                  onChange={(e) => {
                    const files = Array.from(e.currentTarget.files ?? []);
                    e.currentTarget.value = "";
                    void select(files);
                  }}
                />
              </label>
              <p>
                Até {Math.floor(limits.bytes / 1048576)} MB por imagem,{" "}
                {Math.floor(limits.pixels / 1000000)} MP e {limits.pages}{" "}
                imagens por {label}. Sem recorte; a ordem escolhida é
                preservada.
              </p>
            </div>
            <input
              ref={replacementInput}
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file && replaceTarget.current)
                  void select([file], replaceTarget.current);
              }}
            />
            <div className="actions">
              <Button
                type="button"
                disabled={
                  !limitsReady ||
                  !items.some(
                    (p) =>
                      p.file && (p.status === "local" || p.status === "error"),
                  )
                }
                onClick={() => void upload()}
              >
                Enviar pendentes / repetir falhadas
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={items.length < 2}
                onClick={() => setConfirmation({ kind: "sort" })}
              >
                Ordenar por nome (natural)
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!items.length}
                onClick={() => {
                  setPreview((v) => !v);
                  setCurrent(0);
                }}
              >
                {" "}
                {preview ? "Fechar pré-visualização" : "Pré-visualizar"}{" "}
              </Button>
            </div>
            <p>
              A direção de leitura não altera a ordem editorial das imagens.
            </p>
          </fieldset>
          {uploading && (
            <Button
              variant="secondary"
              onClick={() => uploadAbort.current?.abort()}
            >
              Interromper uploads
            </Button>
          )}
          <progress
            aria-label="Imagens enviadas"
            max={Math.max(1, items.length)}
            value={completed}
          />
          {!items.length && (
            <div className="empty">
              <h2>Ainda não há imagens</h2>
              <p>
                Adiciona as páginas deste {label}. O título e o guião existentes
                foram preservados.
              </p>
            </div>
          )}
          <ol className="visual-page-list" aria-label="Ordem das imagens">
            {items.map((item, i) => (
              <li
                key={item.id}
                draggable={!disabled}
                onDragStart={(e) => {
                  setDragging(item.id);
                  e.dataTransfer.setData("text/plain", item.id);
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => {
                  if (dragging) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (dragging) {
                    e.preventDefault();
                    movePage(dragging, i);
                    setDragging(null);
                  }
                }}
              >
                <VisualImage
                  item={item}
                  workId={base.id}
                  entryId={entry.id}
                  api={api}
                  cache={cache.current}
                />
                <div className="visual-page-info">
                  <h2>
                    {i + 1}. {item.name}
                  </h2>
                  <p>
                    {item.width
                      ? `${item.width} × ${item.height} px`
                      : "Dimensões por validar"}{" "}
                    · {(item.bytes / 1048576).toFixed(2)} MB
                  </p>
                  <p role="status">{statusText[item.status]}</p>
                  {item.status === "uploading" && (
                    <progress aria-label={`Upload de ${item.name}`} />
                  )}
                  {item.error && <p role="alert">{item.error}</p>}
                  <div className="actions">
                    <Button
                      variant="ghost"
                      disabled={disabled || i === 0}
                      aria-label={`Subir imagem ${i + 1}`}
                      onClick={() => movePage(item.id, i - 1)}
                    >
                      ↑ Subir
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={disabled || i === items.length - 1}
                      aria-label={`Descer imagem ${i + 1}`}
                      onClick={() => movePage(item.id, i + 1)}
                    >
                      ↓ Descer
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => {
                        replaceTarget.current = item.id;
                        replacementInput.current?.click();
                      }}
                    >
                      Substituir
                    </Button>
                    {item.file && item.status === "error" && (
                      <Button
                        disabled={disabled}
                        onClick={() => void upload(item.id)}
                      >
                        Repetir upload
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() =>
                        setConfirmation({ kind: "remove", id: item.id })
                      }
                    >
                      Remover
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {preview && items.length > 0 && (
            <section
              className={`visual-private-preview ${settings.mode}`}
              aria-label="Pré-visualização privada"
              onKeyDown={(e) => {
                if ((e.target as HTMLElement).tagName === "INPUT") return;
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const right = e.key === "ArrowRight";
                  showPage(
                    current +
                      (right === (settings.direction === "ltr") ? 1 : -1),
                  );
                }
              }}
              tabIndex={0}
            >
              <h2>
                Pré-visualização privada ·{" "}
                {settings.mode === "paged"
                  ? `Página ${current + 1} de ${items.length}`
                  : "Imagens na ordem editorial"}
              </h2>
              <div
                className="actions"
                style={{
                  flexDirection:
                    settings.direction === "rtl" && settings.mode === "paged"
                      ? "row-reverse"
                      : "row",
                }}
              >
                <Button
                  disabled={current === 0}
                  onClick={() => showPage(current - 1)}
                >
                  Anterior
                </Button>
                <Button
                  disabled={current >= items.length - 1}
                  onClick={() => showPage(current + 1)}
                >
                  Seguinte
                </Button>
              </div>
              {settings.mode === "paged" ? (
                <VisualImage
                  key={items[current]?.id}
                  item={items[current] ?? items[0]}
                  workId={base.id}
                  entryId={entry.id}
                  api={api}
                  cache={cache.current}
                  full
                />
              ) : (
                <>
                  {items.slice(0, shown).map((item, i) => (
                    <figure id={`visual-preview-${i}`} key={item.id}>
                      <figcaption>
                        Imagem {i + 1} de {items.length} · {item.name}
                      </figcaption>
                      <VisualImage
                        item={item}
                        workId={base.id}
                        entryId={entry.id}
                        api={api}
                        cache={cache.current}
                        full
                      />
                    </figure>
                  ))}
                  {shown < items.length && (
                    <Button onClick={() => setShown((n) => n + 20)}>
                      Mostrar mais imagens
                    </Button>
                  )}
                </>
              )}
            </section>
          )}
          <details
            className="visual-script"
            onToggle={(e) => setScriptOpen(e.currentTarget.open)}
          >
            <summary>
              Guião e notas editoriais — conteúdo existente preservado
            </summary>
            {scriptOpen && (
              <Suspense fallback={<p>A carregar editor de guião…</p>}>
                <RichEditor
                  label="Guião e notas editoriais"
                  value={script}
                  alignment={entry.alignment ?? "left"}
                  onChange={(value) => setScript(value)}
                  disabled={disabled}
                />
              </Suspense>
            )}
          </details>
          <div className="actions visual-save-actions">
            <Button
              disabled={disabled || !dirty || unready || !title.trim()}
              onClick={() => void save()}
            >
              Guardar {label}
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => setConfirmation({ kind: "recover" })}
            >
              Recuperar versão guardada
            </Button>
            <Button
              variant="ghost"
              disabled={disabled || dirty}
              onClick={() => setConfirmation({ kind: "delete" })}
            >
              Eliminar {label}
            </Button>
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => setConfirmation({ kind: "cleanup" })}
            >
              Limpar uploads antigos não utilizados
            </Button>
          </div>
          <p>
            Enviar ficheiros não guarda a sequência. Guarda o {label} para
            associar as imagens e a configuração. Recarregar sem guardar perde
            alterações locais.
          </p>
        </section>
      </div>
      {confirmation && (
        <Modal
          open
          title={
            confirmation.kind === "sort"
              ? "Ordenar imagens por nome?"
              : confirmation.kind === "recover"
                ? "Substituir alterações locais?"
                : confirmation.kind === "cleanup"
                  ? "Eliminar uploads antigos não utilizados?"
                  : confirmation.kind === "delete"
                    ? `Eliminar ${label}?`
                    : "Remover imagem da sequência?"
          }
          onClose={() => setConfirmation(null)}
        >
          <p>
            {confirmation.kind === "cleanup"
              ? "Apenas ficheiros sem referências, com mais de 24 horas. A eliminação física é permanente."
              : confirmation.kind === "recover"
                ? "As alterações locais serão descartadas e substituídas pela versão do servidor."
                : confirmation.kind === "delete"
                  ? "O título, guião e sequência desta entrada serão eliminados da obra."
                  : "A alteração da sequência só fica persistida ao guardar; ficheiros referenciados não são apagados."}
          </p>
          <div className="actions">
            <Button variant="secondary" onClick={() => setConfirmation(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void confirm()}>Confirmar</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
