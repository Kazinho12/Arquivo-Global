import { currentScope } from "../local/persistence";
import type { ReadingPoint } from "./syncRepository";
const blocked = new Set<string>();
const memory = new Map<string, ReadingPoint[]>();
const listeners = new Set<() => void>();
let version = 0;
export const subscribeReading = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const readingVersion = () => version;
export function notifyReading() {
  version++;
  listeners.forEach((f) => f());
}
const key = (scope: string) => "ag:reading:v1:" + encodeURIComponent(scope);
export function points(scope = currentScope()): ReadingPoint[] {
  if (memory.has(scope)) return memory.get(scope)!;
  let value: ReadingPoint[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(key(scope)) ?? "[]");
    if (
      !Array.isArray(raw) ||
      raw.length > 10000 ||
      raw.some(
        (x) =>
          !x ||
          typeof x.work !== "string" ||
          typeof x.entry !== "string" ||
          !Number.isFinite(x.position) ||
          x.position < 0 ||
          x.position > 1 ||
          !x.locator ||
          typeof x.time !== "string",
      )
    )
      throw Error("invalid");
    value = raw;
  } catch {
    blocked.add(scope);
    cacheWarning =
      "Dados locais ilegíveis preservados. Exporta o original antes de os limpar.";
  }
  memory.set(scope, value);
  return value;
}
export function point(work: string, entry: string, scope = currentScope()) {
  return points(scope).find((p) => p.work === work && p.entry === entry);
}
export let cacheWarning = "";
export function putPoint(value: ReadingPoint, scope = currentScope()) {
  const old = point(value.work, value.entry, scope);
  const next = {
    ...value,
    completed:
      value.completed ?? ((old?.completed ?? false) || value.position === 1),
  };
  const rows = [
    next,
    ...points(scope).filter(
      (p) => p.work !== value.work || p.entry !== value.entry,
    ),
  ].slice(0, 10000);
  memory.set(scope, rows);
  try {
    if (!blocked.has(scope))
      localStorage.setItem(key(scope), JSON.stringify(rows));
  } catch {
    cacheWarning =
      "Armazenamento local indisponível. Exporta os dados antes de sair.";
  }
  notifyReading();
  return next;
}
export function clearPoints(work?: string, scope = currentScope()) {
  blocked.delete(scope);
  const rows = work ? points(scope).filter((p) => p.work !== work) : [];
  memory.set(scope, rows);
  try {
    localStorage.setItem(key(scope), JSON.stringify(rows));
  } catch {
    cacheWarning = "Não foi possível atualizar o armazenamento local.";
  }
  notifyReading();
}
type Sink = (p: ReadingPoint, scope: string) => void;
let sink: Sink | undefined;
export function connectReading(next: Sink) {
  sink = next;
  return () => {
    if (sink === next) sink = undefined;
  };
}
export function captureReading(p: ReadingPoint) {
  const scope = currentScope();
  const next = putPoint(p, scope);
  sink?.(next, scope);
}
