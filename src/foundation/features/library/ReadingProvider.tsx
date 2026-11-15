import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { currentScope } from "../local/persistence";
import {
  subscribeReading,
  readingVersion,
  connectReading,
  point,
  putPoint,
  points,
  clearPoints,
} from "./readingCache";
import { ReadingSync } from "./syncEngine";
import { createReadingRepository, readingSyncEnabled } from "./syncRepository";
import type { PublishedWork } from "../catalog/repository";
export const ReadingContext = createContext<ReadingSync | null>(null);
export function useReadingSync() {
  const engine = useContext(ReadingContext);
  useSyncExternalStore(subscribeReading, readingVersion, readingVersion);
  return engine;
}
export function ReadingProvider({
  children,
  enabled = readingSyncEnabled,
  repositoryFactory = createReadingRepository,
}: {
  children: ReactNode;
  enabled?: boolean;
  repositoryFactory?: typeof createReadingRepository;
}) {
  const { state } = useAuth();
  const owner = enabled ? state.user?.id : undefined;
  const engine = useMemo(
    () => (owner ? new ReadingSync(owner, repositoryFactory(owner)) : null),
    [owner, repositoryFactory],
  );
  useEffect(() => {
    if (!engine) return;
    engine.active = true;
    void engine.start();
    const disconnect = connectReading((p, scope) => engine.record(p, scope));
    const recover = () => {
      void engine.start().then(() => engine.flush());
    };
    window.addEventListener("online", recover);
    return () => {
      disconnect();
      engine.dispose();
      window.removeEventListener("online", recover);
    };
  }, [engine]);
  return (
    <ReadingContext.Provider value={engine}>{children}</ReadingContext.Provider>
  );
}
export function useReadingWork(work: PublishedWork | null | undefined) {
  const engine = useReadingSync();
  const [loaded, setLoaded] = useState("");
  if (work) engine?.register(work);
  useEffect(() => {
    let active = true;
    if (!engine || !work) return;
    setLoaded("");
    void engine.load(work).then(() => {
      if (active) setLoaded(work.id + work.lastPublishedAt);
    });
    return () => {
      active = false;
    };
  }, [engine, work?.id, work?.lastPublishedAt, engine?.ready]);
  return {
    engine,
    loading:
      !!engine &&
      (!engine.ready || (!!work && loaded !== work.id + work.lastPublishedAt)),
  };
}
export function ReadingSession({
  work,
  chapter,
  children,
}: {
  work: PublishedWork;
  chapter: string;
  children: ReactNode;
}) {
  const { engine, loading } = useReadingWork(work);
  if (loading)
    return (
      <p role="status" className="container">
        A recuperar a tua posição privada…
      </p>
    );
  return (
    <>
      <ReadingControls work={work} chapter={chapter} />
      {children}
    </>
  );
}
export function ReadingControls({
  work,
  chapter,
}: {
  work: PublishedWork;
  chapter: string;
}) {
  const engine = useReadingSync();
  const saved = point(work.id, chapter);
  const remote = engine?.works
    .get(work.id)
    ?.entries.find((p) => p.entry_id === chapter);
  const warning = remote && !remote.current_edition;
  return (
    <aside
      className="container reading-sync-panel"
      aria-label="Continuidade privada"
    >
      <p role="status">
        {engine
          ? engine.error ||
            (engine.settings?.sync
              ? engine.pending.length
                ? "Posição neste dispositivo; sincronização pendente."
                : "Sincronização ativa."
              : "Progresso neste dispositivo; sincronização desligada.")
          : "Progresso guardado neste dispositivo."}{" "}
        {warning
          ? "Esta edição mudou. A retoma usa o início do capítulo; a conclusão anterior foi preservada."
          : ""}
      </p>
      <button
        type="button"
        disabled={!!engine && !engine.settings?.sync}
        onClick={() => {
          const value = {
            work: work.id,
            entry: chapter,
            position: saved?.position ?? 0,
            locator: saved?.locator ?? {
              kind:
                work.format === "Poesia"
                  ? ("poetry" as const)
                  : ("prose" as const),
            },
            time: new Date().toISOString(),
            completed: !saved?.completed,
            edition: work.lastPublishedAt,
          };
          putPoint(value);
          engine?.record(value, currentScope(), true);
        }}
      >
        {saved?.completed
          ? "Remover marca de concluído"
          : "Marcar capítulo como concluído"}
      </button>{" "}
      <Link to="/biblioteca">Gerir sincronização e privacidade</Link>
    </aside>
  );
}
export function ChapterReadingIndicator({
  work,
  entry,
}: {
  work: string;
  entry: string;
}) {
  useReadingSync();
  const p = point(work, entry);
  return (
    <span className="reading-indicator">
      {" "}
      · {p?.completed ? "Concluído" : p ? "Em leitura" : "Não iniciado"}
    </span>
  );
}
export function clearDeviceReading(work?: string) {
  clearPoints(work);
}
export const anonymousReadingPoints = () => points("guest");

export function ReadingWorkVisit({ work }: { work: PublishedWork }) {
  const engine = useReadingSync();
  useEffect(() => {
    engine?.visit(work.id);
  }, [engine, work.id, engine?.ready, engine?.settings?.history]);
  return null;
}
