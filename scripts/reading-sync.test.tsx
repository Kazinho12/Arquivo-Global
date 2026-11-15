import { webcrypto } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { ReadingSync } from "../src/foundation/features/library/syncEngine";
import {
  ReadingError,
  createReadingRepository,
  type ReadingPoint,
} from "../src/foundation/features/library/syncRepository";
import {
  putPoint,
  point,
  points,
  clearPoints,
  captureReading,
} from "../src/foundation/features/library/readingCache";
import { selectScope } from "../src/foundation/features/local/persistence";
import { importDeviceProgress } from "../src/foundation/features/library/importProgress";
import type { PublishedWork } from "../src/foundation/features/catalog/repository";
Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  },
  configurable: true,
});
const work = {
  id: "10000000-0000-4000-8000-000000000001",
  lastPublishedAt: "2026-11-15T12:00:00.000Z",
  format: "Romance",
  chapters: [{ id: "20000000-0000-4000-8000-000000000001" }],
} as PublishedWork;
const value: ReadingPoint = {
  work: work.id,
  entry: work.chapters[0].id,
  position: 0.4,
  locator: { kind: "prose", block: 2, offset: 0.3 },
  time: "2026-11-15T12:01:00Z",
};
let seq = 0;
function fixture() {
  const owner = "owner-" + ++seq;
  let offline = false,
    lost = false;
  let remote: any[] = [];
  const receipts = new Map<string, any>(),
    calls: any[] = [];
  const repo = {
    async call(action: string, data: any = {}, op?: string) {
      calls.push({ action, data: structuredClone(data), op });
      if (offline) throw new ReadingError("Offline");
      if (op && receipts.has(op)) return receipts.get(op);
      if (action === "settings")
        return { sync: true, history: true, epoch: 1, revision: 1 };
      if (action === "work")
        return {
          generation: 0,
          revision: remote.length ? 1 : 0,
          state: remote.length ? "reading" : null,
          entries: structuredClone(remote),
        };
      if (action === "progress" || action === "complete") {
        const old = remote.find((p) => p.entry_id === data.entry);
        if (data.revision !== (old?.revision ?? 0))
          throw new ReadingError("Conflito", "40001");
        const r = {
          publication_id: data.work,
          entry_id: data.entry,
          position: data.position,
          locator: data.locator,
          completed:
            action === "complete" ? data.completed : (old?.completed ?? false),
          edition: work.lastPublishedAt,
          revision: (old?.revision ?? 0) + 1,
          available: true,
          current_edition: true,
          seen_at: value.time,
        };
        remote = [r, ...remote.filter((p) => p.entry_id !== data.entry)];
        receipts.set(op!, structuredClone(r));
        if (lost) {
          lost = false;
          throw new ReadingError("Resposta perdida");
        }
        return r;
      }
      if (action === "visit") return { ok: true };
      if (action === "save_settings") return { ...data, epoch: 2, revision: 2 };
      throw Error("Unexpected " + action);
    },
  };
  const engine = new ReadingSync(owner, repo as any);
  engine.settings = { sync: true, history: true, epoch: 1, revision: 1 };
  engine.ready = true;
  engine.register(work);
  return {
    engine,
    owner,
    calls,
    repo,
    offline: (v: boolean) => (offline = v),
    lost: () => (lost = true),
    remote: () => remote,
    setRemote: (r: any[]) => (remote = r),
  };
}
test("chapter-local positions, guest isolation and sticky/manual completion", () => {
  selectScope("guest");
  clearPoints();
  captureReading({ ...value, position: 1 });
  captureReading({ ...value, position: 0.1 });
  assert.equal(point(value.work, value.entry)?.completed, true);
  putPoint({ ...value, completed: false });
  assert.equal(point(value.work, value.entry)?.completed, false);
  putPoint({ ...value, entry: "other", position: 0.8 });
  assert.equal(point(value.work, value.entry)?.position, 0.4);
  selectScope("user:A");
  assert.equal(point(value.work, value.entry), undefined);
  putPoint({ ...value, position: 0.7 });
  selectScope("user:B");
  assert.equal(point(value.work, value.entry), undefined);
  selectScope("guest");
  assert.equal(point(value.work, "other")?.position, 0.8);
});
test("owner scope and disposed engines never send another account data", async () => {
  const f = fixture();
  try {
    f.engine.record(value, "user:other");
    assert.equal(f.engine.pending.length, 0);
    f.engine.dispose();
    f.engine.record(value, "user:" + f.owner);
    await f.engine.flush();
    assert.equal(f.calls.length, 0);
  } finally {
    f.engine.dispose();
  }
});
test("offline writes coalesce and retain original revisions", async () => {
  const f = fixture();
  try {
    f.offline(true);
    f.engine.record(value, "user:" + f.owner);
    f.engine.record({ ...value, position: 0.8 }, "user:" + f.owner);
    assert.equal(f.engine.pending.length, 1);
    await f.engine.flush();
    assert.equal(f.engine.pending.length, 1);
    const operation = f.engine.pending[0].operation;
    f.offline(false);
    await f.engine.flush();
    assert.equal(f.engine.pending.length, 0);
    assert.equal(f.remote()[0].position, 0.8);
    assert.equal(
      f.calls.filter((c) => c.action === "progress").at(-1).op,
      operation,
    );
  } finally {
    f.engine.dispose();
  }
});
test("lost successful response replays original operation before newer local data", async () => {
  const f = fixture();
  try {
    f.lost();
    f.engine.record(value, "user:" + f.owner);
    await f.engine.flush();
    const op = f.engine.pending[0].operation;
    f.engine.record({ ...value, position: 0.9 }, "user:" + f.owner);
    assert.equal(f.engine.pending.length, 2);
    await f.engine.flush();
    assert.equal(f.engine.pending[0].payload.revision, 1);
    assert.equal(f.calls.filter((c) => c.action === "progress").at(-1).op, op);
    await f.engine.flush();
    assert.equal(f.remote()[0].revision, 2);
    assert.equal(f.remote()[0].position, 0.9);
  } finally {
    f.engine.dispose();
  }
});
test("two simulated devices require an explicit decision after stale revision", async () => {
  const f = fixture();
  const second = new ReadingSync(f.owner, f.repo as any);
  second.settings = f.engine.settings;
  second.register(work);
  try {
    await f.engine.load(work);
    await second.load(work);
    f.engine.record(value, "user:" + f.owner);
    await f.engine.flush();
    second.record({ ...value, position: 0.8 }, "user:" + f.owner);
    await second.flush();
    assert.equal(second.pending[0].conflict, true);
    assert.equal(f.remote()[0].position, 0.4);
    await second.resolve(second.pending[0], false);
    assert.equal(second.pending.length, 0);
    assert.equal(point(work.id, value.entry, "user:" + f.owner)?.position, 0.4);
  } finally {
    f.engine.dispose();
    second.dispose();
  }
});
test("failed conflict refresh preserves pending data", async () => {
  const f = fixture();
  try {
    f.engine.record(value, "user:" + f.owner);
    f.engine.pending[0].conflict = true;
    f.offline(true);
    await assert.rejects(() => f.engine.resolve(f.engine.pending[0], false));
    assert.equal(f.engine.pending.length, 1);
  } finally {
    f.engine.dispose();
  }
});
test("preferences separately control history and sync; no retroactive automatic import", async () => {
  const f = fixture();
  try {
    f.engine.settings = { sync: false, history: false, epoch: 1, revision: 1 };
    putPoint(value, "guest");
    f.engine.record(value, "user:" + f.owner);
    assert.equal(f.engine.pending.length, 0);
    f.engine.settings.history = true;
    f.engine.record(value, "user:" + f.owner);
    assert.equal(f.engine.pending[0].action, "visit");
    assert.equal(f.engine.pending[0].payload.position, undefined);
    await f.engine.flush();
    assert.equal(f.calls.at(-1).action, "visit");
    await f.engine.settingsChange(false, false);
    f.engine.record(value, "user:" + f.owner);
    assert.equal(f.engine.pending.length, 0);
    assert.equal(points("guest").length > 0, true);
  } finally {
    f.engine.dispose();
  }
});
test("explicit import skips duplicates and confirmed data and preserves originals", async () => {
  const f = fixture();
  try {
    putPoint(value, "guest");
    const repo = { find: async () => work };
    const result = await importDeviceProgress(f.engine, [value, value], repo);
    assert.deepEqual(result, { queued: 1, skipped: 0 });
    assert.ok(point(value.work, value.entry, "guest"));
    await f.engine.flush();
    const again = await importDeviceProgress(f.engine, [value], repo);
    assert.equal(again.queued, 0);
    assert.equal(again.skipped, 1);
    assert.ok(point(value.work, value.entry, "guest"));
  } finally {
    f.engine.dispose();
  }
});
test("explicit import refuses disabled sync and withdrawn/missing chapters", async () => {
  const f = fixture();
  try {
    f.engine.settings!.sync = false;
    await assert.rejects(() =>
      importDeviceProgress(f.engine, [value], { find: async () => work }),
    );
    f.engine.settings!.sync = true;
    assert.deepEqual(
      await importDeviceProgress(f.engine, [value], { find: async () => null }),
      { queued: 0, skipped: 1 },
    );
    assert.deepEqual(
      await importDeviceProgress(f.engine, [{ ...value, entry: "removed" }], {
        find: async () => work,
      }),
      { queued: 0, skipped: 1 },
    );
  } finally {
    f.engine.dispose();
  }
});
test("edition changes fall back safely and retain chapter completion", async () => {
  const f = fixture();
  try {
    f.setRemote([
      {
        publication_id: value.work,
        entry_id: value.entry,
        position: 0.7,
        locator: { kind: "prose", block: 200 },
        completed: true,
        edition: "old",
        revision: 4,
        seen_at: value.time,
        available: true,
        current_edition: false,
      },
    ]);
    await f.engine.load(work);
    assert.equal(
      point(value.work, value.entry, "user:" + f.owner)?.position,
      0,
    );
    assert.equal(
      point(value.work, value.entry, "user:" + f.owner)?.completed,
      true,
    );
    f.engine.register({ ...work, lastPublishedAt: "2026-11-16T12:00:00Z" });
    assert.equal(f.engine.works.has(work.id), false);
  } finally {
    f.engine.dispose();
  }
});
test("authenticated repository pins current token and rejects account switch", async () => {
  const calls: any[] = [];
  let user = "A";
  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: { user: { id: user }, access_token: "current-token" },
        },
      }),
    },
    rpc: (name: string, args: any) => ({
      setHeader: async (k: string, v: string) => {
        calls.push({ name, args, k, v });
        return { data: [], error: null };
      },
    }),
  };
  const repo = createReadingRepository("A", client as any);
  await repo.call("history");
  assert.equal(calls[0].v, "Bearer current-token");
  user = "B";
  await assert.rejects(() => repo.call("history"), /sessão mudou/);
  assert.equal(calls.length, 1);
});
test("repository reports schema errors and never impersonates another owner", async () => {
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "A" }, access_token: "token" } },
      }),
    },
    rpc: () => ({ setHeader: async () => ({ error: { code: "42883" } }) }),
  };
  await assert.rejects(
    () => createReadingRepository("A", client as any).call("settings"),
    /não está instalada/,
  );
});

test("offline coalescing stays bounded and preserves explicit completion changes", async () => {
  const f = fixture();
  try {
    f.offline(true);
    f.engine.record({ ...value, completed: false }, "user:" + f.owner, true);
    await f.engine.flush();
    for (let i = 0; i < 100; i++)
      f.engine.record({ ...value, position: i / 100 }, "user:" + f.owner);
    assert.equal(f.engine.pending.length, 2);
    f.offline(false);
    await f.engine.flush();
    await f.engine.flush();
    assert.equal(f.remote()[0].completed, false);
    assert.equal(f.remote()[0].position, 0.99);
  } finally {
    f.engine.dispose();
  }
});
test("unsent manual completion cannot be lost to an automatic scroll sample", async () => {
  const f = fixture();
  try {
    f.engine.record({ ...value, completed: true }, "user:" + f.owner, true);
    f.engine.record({ ...value, position: 0.6 }, "user:" + f.owner);
    assert.equal(f.engine.pending.length, 1);
    assert.equal(f.engine.pending[0].action, "complete");
    await f.engine.flush();
    assert.equal(f.remote()[0].completed, true);
  } finally {
    f.engine.dispose();
  }
});
test("persisted offline queue is scoped to one account and replayable after reload", async () => {
  const f = fixture();
  let restored: ReadingSync | undefined;
  try {
    f.engine.record(value, "user:" + f.owner);
    f.engine.dispose();
    restored = new ReadingSync(f.owner, f.repo as any);
    restored.settings = { sync: true, history: true, epoch: 1, revision: 1 };
    assert.equal(restored.pending.length, 1);
    const stranger = new ReadingSync(f.owner + "-other", f.repo as any);
    assert.equal(stranger.pending.length, 0);
    stranger.dispose();
    await restored.flush();
    assert.equal(f.remote()[0].position, 0.4);
    assert.equal(restored.pending.length, 0);
  } finally {
    f.engine.dispose();
    restored?.dispose();
  }
});

test("explicit import preserves a completed chapter even at an earlier resume position", async () => {
  const f = fixture();
  try {
    await importDeviceProgress(
      f.engine,
      [{ ...value, completed: true, position: 0.2 }],
      { find: async () => work },
    );
    assert.equal(f.engine.pending[0].action, "complete");
    await f.engine.flush();
    assert.equal(f.remote()[0].completed, true);
    assert.equal(f.remote()[0].position, 0.2);
  } finally {
    f.engine.dispose();
  }
});

test("resume chapter uses server update order even with history disabled", async () => {
  const f = fixture();
  try {
    f.engine.settings!.history = false;
    f.setRemote([
      {
        publication_id: value.work,
        entry_id: value.entry,
        position: 0.3,
        locator: { kind: "prose" },
        completed: false,
        edition: work.lastPublishedAt,
        revision: 2,
        seen_at: null,
        updated_at: "2026-11-15T14:00:00Z",
        available: true,
        current_edition: true,
      },
      {
        publication_id: value.work,
        entry_id: "older-chapter",
        position: 0.9,
        locator: { kind: "prose" },
        completed: false,
        edition: work.lastPublishedAt,
        revision: 1,
        seen_at: null,
        updated_at: "2026-11-15T13:00:00Z",
        available: true,
        current_edition: true,
      },
    ]);
    await f.engine.load(work);
    const recent = points("user:" + f.owner)
      .filter((p) => p.work === work.id)
      .sort((a, b) => b.time.localeCompare(a.time))[0];
    assert.equal(recent.entry, value.entry);
  } finally {
    f.engine.dispose();
  }
});
