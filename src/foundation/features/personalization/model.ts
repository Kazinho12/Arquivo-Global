import { preferenceLanguageCodes } from "./data/language-codes";
import { isoCountryCodes } from "./data/iso-codes";
import {
  baseConfig,
  themeById,
  validateTheme,
  type ThemeConfig,
} from "./themes";
import { resolveLocale } from "./i18n";
export interface PersonalTheme {
  id: string;
  name: string;
  config: ThemeConfig;
}
export interface PersonalSettings {
  theme: string;
  config: ThemeConfig;
  region: string | null;
  locale: string;
  readingLanguages: string[];
}
export interface PersonalSnapshot {
  settings: PersonalSettings;
  themes: PersonalTheme[];
  revision: number;
}
export const defaults = (): PersonalSnapshot => ({
  settings: {
    theme: "night",
    config: structuredClone(baseConfig),
    region: null,
    locale: "pt-PT",
    readingLanguages: [],
  },
  themes: [],
  revision: 0,
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fields(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== [...keys].sort().join("|")
  )
    throw Error("Formato de preferências incompatível.");
}
export function validateSnapshot(input: unknown): PersonalSnapshot {
  const v = structuredClone(input) as PersonalSnapshot;
  if (
    !v ||
    typeof v !== "object" ||
    !v.settings ||
    !Array.isArray(v.themes) ||
    v.themes.length > 20 ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0
  )
    throw Error("Preferências inválidas.");
  fields(v, ["settings", "themes", "revision"]);
  fields(v.settings, [
    "theme",
    "config",
    "region",
    "locale",
    "readingLanguages",
  ]);
  const s = v.settings;
  s.config = validateTheme(s.config);
  if (!themeById(s.theme) && s.theme !== "custom" && !uuid.test(s.theme))
    throw Error("Tema ativo inválido.");
  if (s.region !== null && !isoCountryCodes.includes(s.region as any))
    throw Error("Região inválida.");
  if (s.locale !== resolveLocale(s.locale))
    throw Error("Tradução da interface indisponível.");
  if (
    !Array.isArray(s.readingLanguages) ||
    s.readingLanguages.length > 20 ||
    new Set(s.readingLanguages).size !== s.readingLanguages.length ||
    s.readingLanguages.some(
      (l) =>
        typeof l !== "string" || !preferenceLanguageCodes.includes(l as any),
    )
  )
    throw Error("Idiomas de leitura inválidos.");
  const ids = new Set<string>();
  for (const t of v.themes) {
    fields(t, ["id", "name", "config"]);
    if (
      !t ||
      !uuid.test(t.id) ||
      ids.has(t.id) ||
      typeof t.name !== "string" ||
      t.name.trim().length < 1 ||
      t.name.length > 80
    )
      throw Error("Tema pessoal inválido.");
    ids.add(t.id);
    t.name = t.name.trim();
    t.config = validateTheme(t.config);
  }
  if (uuid.test(s.theme) && !ids.has(s.theme))
    throw Error("Tema pessoal ativo não encontrado.");
  return v;
}
export function mergeSnapshots(
  remote: PersonalSnapshot,
  local: PersonalSnapshot,
): PersonalSnapshot {
  const merged = structuredClone(remote);
  for (const t of local.themes) {
    const existing = merged.themes.find((r) => r.id === t.id);
    if (!existing) merged.themes.push(t);
    else if (JSON.stringify(existing) !== JSON.stringify(t)) {
      const duplicate = {
        ...t,
        id: crypto.randomUUID(),
        name: (t.name + " (deste dispositivo)").slice(0, 80),
      };
      merged.themes.push(duplicate);
      if (local.settings.theme === t.id)
        local = {
          ...local,
          settings: { ...local.settings, theme: duplicate.id },
        };
    }
  }
  merged.settings = structuredClone(local.settings);
  return validateSnapshot(merged);
}
export function importThemeJSON(source: string): {
  name: string;
  config: ThemeConfig;
} {
  if (new TextEncoder().encode(source).length > 16000)
    throw Error("O ficheiro excede 16 KB.");
  const v = JSON.parse(source);
  if (
    !v ||
    v.format !== "arquivo-global-theme" ||
    v.version !== 1 ||
    typeof v.name !== "string" ||
    !v.name.trim() ||
    v.name.length > 80 ||
    Object.keys(v).some(
      (k) => !["format", "version", "name", "config"].includes(k),
    )
  )
    throw Error("Formato de tema incompatível.");
  return { name: v.name.trim(), config: validateTheme(v.config) };
}
export function exportThemeJSON(name: string, config: ThemeConfig) {
  return JSON.stringify(
    {
      format: "arquivo-global-theme",
      version: 1,
      name,
      config: validateTheme(config),
    },
    null,
    2,
  );
}
