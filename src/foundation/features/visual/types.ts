import type { StudioWork } from "../studio/types";
export const visualEditorEnabled =
  import.meta.env?.VITE_ENABLE_VISUAL_EDITOR === "true";
export interface VisualLimits {
  bytes: number;
  pixels: number;
  width: number;
  height: number;
  pages: number;
  concurrent: number;
}
export const VISUAL_LIMITS: VisualLimits = {
  bytes: 20 * 1024 * 1024,
  pixels: 40_000_000,
  width: 16384,
  height: 65535,
  pages: 1000,
  concurrent: 2,
};
export interface VisualSettings {
  format: "hq" | "manga" | "webtoon" | "webcomic";
  mode: "paged" | "vertical";
  direction: "ltr" | "rtl";
}
export interface VisualAsset {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
}
export interface VisualPage {
  id: string;
  asset: VisualAsset;
  position: number;
}
export interface UploadItem {
  id: string;
  asset?: VisualAsset;
  file?: File;
  thumbnail?: Blob;
  status: "local" | "uploading" | "uploaded" | "saved" | "error";
  error?: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
}
export interface VisualBuffer {
  base: StudioWork;
  title: string;
  script: string;
  settings: VisualSettings;
  items: UploadItem[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function defaultVisualSettings(format: string): VisualSettings {
  return {
    format: format === "Mangá" ? "manga" : "hq",
    mode: "paged",
    direction: format === "Mangá" ? "rtl" : "ltr",
  };
}
export function readVisualSettings(value: unknown): VisualSettings | undefined {
  if (value == null) return undefined;
  const v = value as VisualSettings;
  if (
    !["hq", "manga", "webtoon", "webcomic"].includes(v.format) ||
    !["paged", "vertical"].includes(v.mode) ||
    !["ltr", "rtl"].includes(v.direction) ||
    (v.format === "webtoon" && v.mode !== "vertical")
  )
    throw Error("Configuração visual inválida.");
  return { format: v.format, mode: v.mode, direction: v.direction };
}
export function readVisualAsset(value: any): VisualAsset {
  if (
    !value ||
    !uuid.test(value.id) ||
    typeof value.filename !== "string" ||
    !["image/jpeg", "image/png", "image/webp"].includes(value.mime) ||
    ![value.bytes, value.width, value.height].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    value.bytes > VISUAL_LIMITS.bytes ||
    value.width > VISUAL_LIMITS.width ||
    value.height > VISUAL_LIMITS.height ||
    value.width * value.height > VISUAL_LIMITS.pixels
  )
    throw Error("Resposta inválida do serviço de imagens.");
  return {
    id: value.id,
    filename: value.filename,
    mime: value.mime,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
  };
}
export function readVisualPages(value: any): VisualPage[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw Error("Sequência visual inválida.");
  const pages = value.map((p, i) => {
    if (!uuid.test(p.id) || p.position !== i + 1)
      throw Error("Ordem visual inválida.");
    return {
      id: p.id,
      position: p.position,
      asset: readVisualAsset({
        id: p.asset_id,
        filename: p.filename,
        mime: p.mime,
        bytes: p.bytes,
        width: p.width,
        height: p.height,
      }),
    };
  });
  if (new Set(pages.map((p) => p.id)).size !== pages.length)
    throw Error("Páginas duplicadas.");
  return pages;
}
export const savedItems = (pages: VisualPage[]): UploadItem[] =>
  pages.map((p) => ({
    id: p.id,
    asset: p.asset,
    name: p.asset.filename,
    width: p.asset.width,
    height: p.asset.height,
    bytes: p.asset.bytes,
    status: "saved",
  }));
export const pagePayload = (items: UploadItem[]) =>
  items.map((p) => {
    if (!p.asset || !["uploaded", "saved"].includes(p.status))
      throw Error("Envia ou remove as imagens pendentes antes de guardar.");
    return { id: p.id, assetId: p.asset.id };
  });
export function moveItem<T>(items: T[], index: number, target: number) {
  if (
    target < 0 ||
    target >= items.length ||
    index < 0 ||
    index >= items.length
  )
    return items;
  const next = [...items];
  next.splice(target, 0, next.splice(index, 1)[0]);
  return next;
}
export const naturalOrder = (items: UploadItem[]) =>
  [...items].sort((a, b) =>
    a.name.localeCompare(b.name, "pt", { numeric: true, sensitivity: "base" }),
  );

export interface VisualSaveInput {
  title: string;
  script: string;
  settings: VisualSettings;
  pages: { id: string; assetId: string }[];
}
