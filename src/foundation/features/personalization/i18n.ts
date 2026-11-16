import reference from "./catalogs/pt-PT";
const loaded = new Map<string, any>([["pt-PT", reference]]);
export type MessageKey = keyof typeof reference;
export const interfaceLocales = [
  { code: "pt-PT", name: "Português (Portugal)", available: true },
  { code: "pt-BR", name: "Português (Brasil)", available: false },
  { code: "pt-MZ", name: "Português (Moçambique)", available: false },
  { code: "en", name: "English", available: false },
  { code: "es", name: "Español", available: false },
  { code: "fr", name: "Français", available: false },
] as const;
export function resolveLocale(code: string) {
  return (
    interfaceLocales.find((l) => l.code === code && l.available)?.code ??
    "pt-PT"
  );
}
export function translate(
  key: MessageKey,
  params: Record<string, string | number> = {},
  locale = "pt-PT",
) {
  let message: string | { readonly one: string; readonly other: string } =
    (loaded.get(resolveLocale(locale)) ?? reference)[key] ?? reference[key];
  if (typeof message !== "string") {
    const category = new Intl.PluralRules(resolveLocale(locale)).select(
      Number(params.count ?? 0),
    );
    message = category === "one" ? message.one : message.other;
  }
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
    Object.hasOwn(params, key) ? String(params[key]) : `{${key}}`,
  );
}
export const localizedNumber = (value: number, locale = "pt-PT") =>
  new Intl.NumberFormat(resolveLocale(locale)).format(value);
export const localizedDate = (value: string | Date, locale = "pt-PT") =>
  new Intl.DateTimeFormat(resolveLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export function documentDirection(locale: string) {
  return ["ar", "he", "fa", "ur"].includes(locale.split("-")[0])
    ? "rtl"
    : "ltr";
}
// Separate loaders are ready for reviewed catalogs. Partial dictionaries are NOT selectable UI languages.
export const catalogLoaders = {
  "pt-PT": async () => ({ default: reference }),
  "pt-BR": () => import("./catalogs/pt-BR"),
  "pt-MZ": () => import("./catalogs/pt-MZ"),
  en: () => import("./catalogs/en"),
  es: () => import("./catalogs/es"),
  fr: () => import("./catalogs/fr"),
};

export async function loadCatalog(requested: string) {
  const locale = resolveLocale(requested);
  if (!loaded.has(locale)) {
    const data = (await catalogLoaders[locale]()).default;
    if (Object.keys(reference).some((key) => !(key in data)))
      throw Error("Catálogo incompleto.");
    loaded.set(locale, data);
  }
  return { locale, fallback: requested !== locale };
}

export const catalogReady = (locale: string) =>
  loaded.has(resolveLocale(locale));
