// Offline, reproducible source import. See docs/global-personalization-f61.md.
import { readFile, writeFile } from "node:fs/promises";
import { LANGUAGE_CATALOG } from "../src/foundation/data/languages";
const [isoPath, territoryPath, namesPath] = process.argv.slice(2);
if (!isoPath || !territoryPath || !namesPath)
  throw Error(
    "Pass ISO 3166-1 JSON, CLDR territoryInfo JSON and Portuguese language names JSON paths.",
  );
const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const iso = (await read(isoPath))["3166-1"];
const territories = (await read(territoryPath)).supplemental.territoryInfo;
const names = (await read(namesPath)).main.pt.localeDisplayNames.languages;
const rank: Record<string, number> = {
  official: 0,
  de_facto_official: 0,
  official_regional: 0,
  official_minority: 0,
  documented: 4,
};
const countries = iso
  .map((c: any) => ({
    code: c.alpha_2,
    alpha3: c.alpha_3,
    name: c.name,
    languages: Object.entries(territories[c.alpha_2]?.languagePopulation ?? {})
      .map(([code, raw]) => {
        const v = raw as any;
        return {
          code: code.replaceAll("_", "-"),
          name: names[code] ?? names[code.split("_")[0]] ?? code,
          status: v._officialStatus ?? "documented",
          populationPercent: Number(v._populationPercent),
        };
      })
      .sort(
        (a: any, b: any) =>
          (rank[a.status] ?? 4) - (rank[b.status] ?? 4) ||
          b.populationPercent - a.populationPercent,
      ),
  }))
  .sort((a: any, b: any) => a.code.localeCompare(b.code));
if (
  countries.length !== 249 ||
  new Set(countries.map((c: any) => c.code)).size !== 249
)
  throw Error(
    "Unexpected ISO dataset; review source version and schema before updating.",
  );
const root = "src/foundation/features/personalization/data/";
await writeFile(
  root + "world.json",
  JSON.stringify(
    {
      source: {
        iso: "iso-codes 4.16.0 (ISO 3166-1)",
        cldr: "Unicode CLDR 48.2.0",
        url: "https://github.com/unicode-org/cldr-json/tree/48.2.0",
        count: countries.length,
      },
      countries,
    },
    null,
    2,
  ) + "\n",
);
const codes = [
  ...new Set<string>([
    ...LANGUAGE_CATALOG.map((l) => l.code),
    ...countries.flatMap((c: any) => c.languages.map((l: any) => l.code)),
    "pt-PT",
    "pt-BR",
    "pt-MZ",
  ]),
].sort();
await writeFile(
  root + "iso-codes.ts",
  `export const isoCountryCodes = ${JSON.stringify(
    countries.map((c: any) => c.code),
    null,
    2,
  )} as const;\n`,
);
await writeFile(
  root + "language-codes.ts",
  `export const preferenceLanguageCodes = ${JSON.stringify(codes, null, 2)} as const;\n`,
);
console.log(
  `Generated ${countries.length} countries and ${codes.length} language codes. Review SQL allowlists separately; no migration was modified.`,
);
