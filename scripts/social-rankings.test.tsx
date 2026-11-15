import test from "node:test";
import assert from "node:assert/strict";
import { createRankingsRepository } from "../src/foundation/features/social/rankings";
import { metricFailureMessage } from "../src/foundation/features/social/metrics";
const id = "10000000-0000-4000-8000-000000000001";
const row = {
  id,
  title: "Obra",
  slug: "obra",
  description: "Sinopse",
  type: "Poesia",
  tags: [],
  content_warnings: [],
  first_published_at: "2026-11-15",
  last_published_at: "2026-11-15",
  social_views: 10,
  social_likes: 2,
  social_favorites: 3,
  social_comments: 1,
  social_followers: 1,
  social_score: 12,
};
test("rankings: one paginated public RPC supplies all counts without fetching personal libraries", async () => {
  const repo = createRankingsRepository({
    rpc: async (name: string, args: any) => {
      assert.equal(name, "read_social_rankings");
      assert.deepEqual(args, {
        p_mode: "favorites",
        p_format: "Poesia",
        p_sensitive: false,
        p_page: 2,
        p_size: 12,
      });
      return {
        data: {
          items: [row],
          page: 2,
          size: 12,
          total: 13,
          period: "accumulated",
        },
        error: null,
      };
    },
  } as any);
  const page = await repo.list("favorites", "Poesia", false, 2);
  assert.equal(page.items[0].favorites, 3);
  assert.equal(page.items[0].work.id, id);
  assert.equal(page.items[0].work.origin, "user-publication");
  assert.equal(page.total, 13);
});
test("rankings: empty is real, missing schema and network failures remain visible", async () => {
  const empty = createRankingsRepository({
    rpc: async () => ({
      data: { items: [], total: 0, page: 1, size: 12, period: "accumulated" },
      error: null,
    }),
  } as any);
  assert.deepEqual((await empty.list("views")).items, []);
  await assert.rejects(
    createRankingsRepository({
      rpc: async () => ({ data: null, error: { code: "PGRST202" } }),
    } as any).list("views"),
    /atualização/,
  );
  await assert.rejects(
    createRankingsRepository({
      rpc: async () => {
        throw Error("offline");
      },
    } as any).list("likes"),
    /carregar/,
  );
  await assert.rejects(
    createRankingsRepository({
      rpc: async () => ({
        data: {
          items: [{ ...row, social_favorites: -1 }],
          total: 1,
          page: 1,
          size: 12,
          period: "accumulated",
        },
        error: null,
      }),
    } as any).list("featured"),
    /inválidas/,
  );
});
test("metric errors guide configuration review without treating failures as invalid sessions", () => {
  assert.match(
    metricFailureMessage("METRICS_PROOF_REJECTED"),
    /prova recusada/,
  );
  assert.match(
    metricFailureMessage("METRICS_CONTENT_UNAVAILABLE"),
    /publicação/,
  );
  assert.match(
    metricFailureMessage("unknown-private-response"),
    /temporariamente indisponível/,
  );
});
