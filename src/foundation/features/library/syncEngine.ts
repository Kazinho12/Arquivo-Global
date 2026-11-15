import type { PublishedWork } from "../catalog/repository";
import { point, putPoint, notifyReading } from "./readingCache";
import {
  ReadingError,
  type ReadingPoint,
  type ReadingSettings,
  type ReadingWork,
  type ReadingRepository,
} from "./syncRepository";
export interface QueuedReading {
  operation: string;
  action: "progress" | "complete" | "visit";
  point: ReadingPoint;
  payload: Record<string, unknown>;
  conflict?: boolean;
  attempted?: boolean;
}
export class ReadingSync {
  settings: ReadingSettings | null = null;
  error = "";
  ready = false;
  active = true;
  storageWarning = "";
  pending: QueuedReading[] = [];
  works = new Map<string, ReadingWork>();
  metadata = new Map<string, PublishedWork>();
  private loading = new Map<string, Promise<boolean>>();
  private busy = false;
  private queueInvalid = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextSend = 0;
  constructor(
    public owner: string,
    public repo: ReadingRepository,
    private clock = Date.now,
  ) {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key()) ?? "[]");
      if (
        Array.isArray(raw) &&
        raw.length <= 1000 &&
        raw.every(
          (x) =>
            typeof x.operation === "string" &&
            ["progress", "complete", "visit"].includes(x.action) &&
            x.point?.work &&
            x.point?.entry &&
            typeof x.payload === "object",
        )
      )
        this.pending = raw;
      else {
        this.queueInvalid = true;
        this.storageWarning = "Fila local inválida: o original foi preservado.";
      }
    } catch {
      this.queueInvalid = true;
      this.storageWarning =
        "Fila local ilegível ou armazenamento indisponível. O original foi preservado.";
    }
  }
  key() {
    return "ag:reading:queue:v1:" + this.owner;
  }
  emit() {
    if (this.active) notifyReading();
  }
  persist() {
    try {
      if (!this.queueInvalid)
        localStorage.setItem(this.key(), JSON.stringify(this.pending));
    } catch {
      this.storageWarning =
        "A fila não pôde ser guardada neste dispositivo. Mantém esta página aberta.";
    }
    this.emit();
  }
  async start() {
    try {
      const settings = await this.repo.call<ReadingSettings>("settings");
      if (this.active) {
        if (!this.settings || settings.revision >= this.settings.revision)
          this.settings = settings;
        this.error = "";
        this.ready = true;
        this.emit();
        this.schedule();
      }
    } catch (e) {
      if (this.active) {
        this.error = (e as Error).message;
        this.ready = true;
        this.emit();
      }
    }
  }
  register(work: PublishedWork) {
    const previous = this.metadata.get(work.id);
    if (previous && previous.lastPublishedAt !== work.lastPublishedAt)
      this.works.delete(work.id);
    this.metadata.set(work.id, work);
  }
  async load(work: PublishedWork, force = false) {
    this.register(work);
    if (this.works.has(work.id) && !force) return true;
    if (this.loading.has(work.id)) return this.loading.get(work.id);
    const task = (async () => {
      try {
        const value = await this.repo.call<ReadingWork>("work", {
          work: work.id,
        });
        if (!this.active) return false;
        this.works.set(work.id, value);
        for (const p of value.entries) {
          if (
            !p.available ||
            this.pending.some(
              (q) => q.point.work === work.id && q.point.entry === p.entry_id,
            )
          )
            continue;
          const local = point(work.id, p.entry_id, "user:" + this.owner);
          // Disabled sync preserves existing device positions and never silently imports them.
          if (!this.settings?.sync && local) continue;
          putPoint(
            {
              work: work.id,
              entry: p.entry_id,
              position: p.current_edition ? p.position : 0,
              locator: p.current_edition
                ? p.locator
                : { kind: work.format === "Poesia" ? "poetry" : "prose" },
              completed: p.completed,
              edition: p.edition,
              time: p.updated_at ?? p.seen_at ?? new Date().toISOString(),
            },
            "user:" + this.owner,
          );
        }
        this.emit();
        return true;
      } catch (e) {
        if (this.active) {
          this.error = (e as Error).message;
          this.emit();
        }
        return false;
      } finally {
        this.loading.delete(work.id);
      }
    })();
    this.loading.set(work.id, task);
    return task;
  }
  record(p: ReadingPoint, scope: string, manual = false) {
    if (!this.active || scope !== "user:" + this.owner || !this.settings)
      return;
    if (!this.settings.sync) {
      if (this.settings.history && !manual) this.visit(p.work, p.entry);
      return;
    }
    const meta = this.metadata.get(p.work);
    if (!meta || !meta.chapters.some((c) => c.id === p.entry)) return;
    const remote = this.works.get(p.work),
      old = remote?.entries.find((r) => r.entry_id === p.entry);
    // Keep original base revisions when coalescing unsent offline progress.
    const same = (q: QueuedReading) =>
      q.action !== "visit" &&
      q.point.work === p.work &&
      q.point.entry === p.entry;
    if (this.pending.some((q) => same(q) && q.conflict)) {
      this.error = "Existe um conflito nesta leitura. Resolve-o na biblioteca.";
      this.emit();
      return;
    }
    const existing = this.pending.find((q) => same(q) && !q.attempted);
    if (!existing && this.pending.length >= 1000) {
      this.storageWarning =
        "A fila local atingiu o limite. Exporta ou sincroniza os dados; a posição continua neste dispositivo.";
      this.emit();
      return;
    }
    const payload = {
      work: p.work,
      entry: p.entry,
      position: p.position,
      locator: p.locator,
      edition: meta.lastPublishedAt,
      revision: old?.revision ?? 0,
      generation: remote?.generation ?? 0,
      epoch: this.settings.epoch,
      ...(manual ? { completed: !!p.completed } : {}),
    };
    const item: QueuedReading = {
      operation: crypto.randomUUID(),
      action: manual ? "complete" : "progress",
      point: p,
      payload,
    };
    if (existing) {
      item.payload = {
        ...payload,
        revision: existing.payload.revision,
        generation: existing.payload.generation,
        epoch: existing.payload.epoch,
      };
      if (existing.action === "complete" && !manual) {
        item.action = "complete";
        item.payload.completed = existing.payload.completed;
      }
      this.pending.splice(this.pending.indexOf(existing), 1, item);
    } else this.pending.push(item);
    this.persist();
    this.schedule();
  }
  visit(work: string, entry?: string) {
    if (!this.active || !this.settings?.history) return;
    if (this.pending.length >= 1000) {
      this.storageWarning = "Fila local no limite. A visita não foi enviada.";
      this.emit();
      return;
    }
    const entryId = entry ?? "00000000-0000-0000-0000-000000000000";
    if (
      this.pending.some(
        (q) =>
          q.action === "visit" &&
          q.point.work === work &&
          q.point.entry === entryId,
      )
    )
      return;
    this.pending.push({
      operation: crypto.randomUUID(),
      action: "visit",
      point: {
        work,
        entry: entryId,
        position: 0,
        locator: { kind: "prose" },
        time: new Date().toISOString(),
      },
      payload: { work, entry: entry ?? null, epoch: this.settings.epoch },
    });
    this.persist();
    this.schedule();
  }
  schedule() {
    if (
      !this.active ||
      !(this.settings?.sync || this.settings?.history) ||
      this.timer
    )
      return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.flush();
      },
      Math.max(0, this.nextSend - this.clock()),
    );
  }
  async flush() {
    if (
      !this.active ||
      this.busy ||
      !(this.settings?.sync || this.settings?.history)
    )
      return;
    const q = this.pending.find(
      (q) =>
        !q.conflict &&
        (q.action === "visit" ? this.settings?.history : this.settings?.sync),
    );
    if (!q) return;
    this.busy = true;
    q.attempted = true;
    this.persist();
    try {
      const result = await this.repo.call<any>(
        q.action,
        q.payload,
        q.operation,
      );
      if (!this.active) return;
      if (q.action !== "visit") {
        const remote = this.works.get(q.point.work) ?? {
          generation: Number(q.payload.generation),
          revision: 1,
          state: "reading",
          entries: [],
        };
        remote.entries = [
          { ...result, available: true, current_edition: true },
          ...remote.entries.filter((r) => r.entry_id !== q.point.entry),
        ];
        this.works.set(q.point.work, remote);
      }
      this.pending = this.pending.filter((i) => i.operation !== q.operation);
      for (const next of this.pending)
        if (
          next.point.work === q.point.work &&
          next.point.entry === q.point.entry &&
          next.payload.revision === q.payload.revision
        )
          if (q.action !== "visit") next.payload.revision = result.revision;
      this.error = "";
    } catch (e) {
      if (this.active) {
        this.error = (e as Error).message;
        if (
          e instanceof ReadingError &&
          ["40001", "42501", "22023"].includes(e.code)
        )
          q.conflict = true;
      }
    } finally {
      this.busy = false;
      this.nextSend = this.clock() + 15000;
      if (this.active) {
        this.persist();
        if (this.pending.some((p) => !p.conflict)) this.schedule();
      }
    }
  }
  async settingsChange(sync: boolean, history: boolean) {
    if (!this.settings) throw Error("Carrega as definições antes de alterar.");
    const previous = this.settings;
    if (!sync) this.settings = { ...previous, sync: false }; // Prevent new local sends immediately.
    this.emit();
    try {
      const s = await this.repo.call<ReadingSettings>(
        "save_settings",
        { sync, history, revision: previous.revision },
        crypto.randomUUID(),
      );
      if (this.active) {
        this.settings = s;
        this.pending.forEach((p) => (p.conflict = true));
        this.persist();
        this.error = "";
        this.emit();
      }
    } catch (e) {
      this.error = (e as Error).message;
      this.emit();
      throw e;
    }
  }
  async resolve(q: QueuedReading, keepLocal: boolean) {
    const work = this.metadata.get(q.point.work);
    if (!work)
      throw Error(
        "Abre primeiro a obra pública atual para rever esta posição.",
      );
    await this.start();
    if (this.error) throw Error(this.error);
    if (!(await this.load(work, true)))
      throw Error(
        "Falha ao recuperar a posição. A fila pendente foi preservada.",
      );
    if (!this.active) return;
    if (
      keepLocal &&
      !(q.action === "visit" ? this.settings?.history : this.settings?.sync)
    )
      throw Error("Ativa a preferência correspondente antes de reenviar.");
    this.pending = this.pending.filter(
      (p) => p.point.work !== q.point.work || p.point.entry !== q.point.entry,
    );
    this.persist();
    if (keepLocal) {
      if (q.action === "visit")
        this.visit(
          q.point.work,
          q.point.entry === "00000000-0000-0000-0000-000000000000"
            ? undefined
            : q.point.entry,
        );
      else this.record(q.point, "user:" + this.owner, q.action === "complete");
    } else {
      const p = this.works
        .get(work.id)
        ?.entries.find((p) => p.entry_id === q.point.entry);
      if (p)
        putPoint(
          {
            work: work.id,
            entry: p.entry_id,
            position: p.current_edition ? p.position : 0,
            locator: p.locator,
            completed: p.completed,
            time: new Date().toISOString(),
            edition: p.edition,
          },
          "user:" + this.owner,
        );
    }
  }
  resetQueue() {
    this.pending = [];
    this.queueInvalid = false;
    this.storageWarning = "";
    this.persist();
  }
  discard(q: QueuedReading) {
    this.pending = this.pending.filter((p) => p.operation !== q.operation);
    this.persist();
  }
  dispose() {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
