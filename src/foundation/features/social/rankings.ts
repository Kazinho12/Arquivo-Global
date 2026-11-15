import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPublicClient,
  mapPublishedWork,
  type PublishedWork,
} from "../catalog/repository";
export const rankingModes = [
  "featured",
  "views",
  "likes",
  "favorites",
  "comments",
] as const;
export type RankingMode = (typeof rankingModes)[number];
export interface RankingItem {
  work: PublishedWork;
  views: number;
  likes: number;
  favorites: number;
  comments: number;
  followers: number;
  score: number;
}
export interface RankingPage {
  items: RankingItem[];
  total: number;
  page: number;
  size: number;
}
export function createRankingsRepository(client?: SupabaseClient | null) {
  return {
    async list(
      mode: RankingMode,
      format = "",
      sensitive = false,
      page = 1,
    ): Promise<RankingPage> {
      const db = client === undefined ? getPublicClient() : client;
      if (!db)
        throw Error("As tendências não estão configuradas neste ambiente.");
      let response;
      try {
        response = await db.rpc("read_social_rankings", {
          p_mode: mode,
          p_format: format,
          p_sensitive: sensitive,
          p_page: page,
          p_size: 12,
        });
      } catch {
        throw Error(
          "Não foi possível carregar as tendências. Tenta novamente.",
        );
      }
      if (response.error)
        throw Error(
          ["PGRST202", "42883"].includes(response.error.code)
            ? "A classificação de tendências aguarda atualização do serviço."
            : "Não foi possível carregar as tendências. Tenta novamente.",
        );
      const data = response.data;
      if (
        !data ||
        !Array.isArray(data.items) ||
        !Number.isSafeInteger(data.total) ||
        data.total < 0 ||
        data.period !== "accumulated" ||
        !Number.isSafeInteger(data.page) ||
        !Number.isSafeInteger(data.size)
      )
        throw Error("Resposta inválida das tendências.");
      return {
        total: data.total,
        page: data.page,
        size: data.size,
        items: data.items.map((row: Record<string, any>) => {
          for (const k of [
            "social_views",
            "social_likes",
            "social_favorites",
            "social_comments",
            "social_followers",
          ])
            if (!Number.isSafeInteger(row[k]) || row[k] < 0)
              throw Error("Contagens de tendências inválidas.");
          if (
            typeof row.social_score !== "number" ||
            !Number.isFinite(row.social_score) ||
            row.social_score < 0
          )
            throw Error("Pontuação de tendências inválida.");
          return {
            work: mapPublishedWork(row),
            views: row.social_views,
            likes: row.social_likes,
            favorites: row.social_favorites,
            comments: row.social_comments,
            followers: row.social_followers,
            score: row.social_score,
          };
        }),
      };
    },
  };
}
export type RankingsRepository = ReturnType<typeof createRankingsRepository>;
