import data from "./data/world.json";
import { LANGUAGE_CATALOG } from "../../data/languages";
export const countries = data.countries;
export const dataSource = data.source;
export function countryName(code: string, locale = "pt-PT") {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "region" }).of(code) ??
      countries.find((c) => c.code === code)?.name ??
      code
    );
  } catch {
    return countries.find((c) => c.code === code)?.name ?? code;
  }
}
export function searchCountries(query: string, locale = "pt-PT") {
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const q = fold(query.trim());
  return countries
    .filter((c) =>
      fold(
        countryName(c.code, locale) +
          " " +
          c.name +
          " " +
          c.code +
          " " +
          c.alpha3,
      ).includes(q),
    )
    .sort((a, b) =>
      countryName(a.code, locale).localeCompare(
        countryName(b.code, locale),
        locale,
      ),
    );
}
export const readingLanguages = [
  ...new Map(
    [
      ...LANGUAGE_CATALOG.map((l) => ({ code: l.code, name: l.name })),
      ...countries.flatMap((c) =>
        c.languages.map((l) => ({ code: l.code, name: l.name })),
      ),
    ].map((l) => [l.code, l]),
  ).values(),
].sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
export const languageStatus: Record<string, string> = {
  official: "Oficial (CLDR)",
  official_regional: "Oficial regional (CLDR)",
  official_minority: "Oficial minoritária (CLDR)",
  de_facto_official: "Oficial de facto (CLDR)",
  documented: "Uso documentado (CLDR)",
};
export function nativeCountryName(code: string, language: string) {
  try {
    if (!Intl.DisplayNames.supportedLocalesOf([language]).length) return null;
    return (
      new Intl.DisplayNames([language], { type: "region" }).of(code) ?? null
    );
  } catch {
    return null;
  }
}
