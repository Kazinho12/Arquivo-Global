import type { PublicWorksRepository } from "../catalog/repository";
import { putPoint } from "./readingCache";
import type { ReadingPoint } from "./syncRepository";
import type { ReadingSync } from "./syncEngine";
// Called only after the explicit device-import confirmation; never from login effects.
export async function importDeviceProgress(
  engine: ReadingSync,
  candidates: ReadingPoint[],
  repo: Pick<PublicWorksRepository, "find">,
) {
  if (!engine.settings?.sync)
    throw Error("Ativa a sincronização antes de importar.");
  let queued = 0,
    skipped = 0;
  for (const p of new Map(
    candidates.map((p) => [p.work + ":" + p.entry, p]),
  ).values()) {
    if (!engine.active || !engine.settings.sync) break;
    const work = await repo.find(p.work);
    if (
      !work ||
      !work.chapters.some((c) => c.id === p.entry) ||
      !(await engine.load(work, true))
    ) {
      skipped++;
      continue;
    }
    if (
      engine.works.get(p.work)?.entries.some((r) => r.entry_id === p.entry) ||
      engine.pending.some(
        (q) => q.point.work === p.work && q.point.entry === p.entry,
      )
    ) {
      skipped++;
      continue;
    }
    putPoint(p, "user:" + engine.owner);
    engine.record(p, "user:" + engine.owner, !!p.completed);
    queued++;
  }
  return { queued, skipped };
}
