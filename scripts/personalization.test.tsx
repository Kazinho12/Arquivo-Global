import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import {
  officialThemes,
  baseConfig,
  contrastErrors,
  normalizeColor,
  themeVariables,
  validateTheme,
} from "../src/foundation/features/personalization/themes";
import {
  compileSkin,
  parseSkin,
  skinSource,
} from "../src/foundation/features/personalization/skin";
import {
  countries,
  readingLanguages,
  searchCountries,
} from "../src/foundation/features/personalization/world";
import {
  interfaceLocales,
  resolveLocale,
  translate,
  localizedDate,
  localizedNumber,
  documentDirection,
} from "../src/foundation/features/personalization/i18n";
import {
  defaults,
  validateSnapshot,
  mergeSnapshots,
  importThemeJSON,
  exportThemeJSON,
} from "../src/foundation/features/personalization/model";
import { createPersonalizationRepository } from "../src/foundation/features/personalization/repository";
Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});
test("all 15 official choices have related icon identities, RGB off and valid contrast", () => {
  assert.equal(officialThemes.length, 15);
  for (const t of officialThemes) {
    assert.ok(t.icon);
    assert.equal(t.config.effects.mode, "off");
    assert.deepEqual(contrastErrors(t.config), [], t.id);
    assert.doesNotThrow(() => validateTheme(t.config));
  }
});
test("HEX RGB HSL normalize without accepting resources/transparency or invalid bounds", () => {
  assert.equal(normalizeColor("#abc"), "#aabbcc");
  assert.equal(normalizeColor("rgb(255, 0, 0)"), "#ff0000");
  assert.equal(normalizeColor("hsl(240,100%,50%)"), "#0000ff");
  assert.equal(normalizeColor("rgb(100% 100% 100%)"), "#ffffff");
  for (const s of [
    "rgba(0,0,0,.1)",
    "url(https://x)",
    "rgb(300,0,0)",
    "hsl(10,110%,30%)",
    "javascript:alert(1)",
  ])
    assert.throws(() => normalizeColor(s));
});
test("bad contrast or unsafe numeric/enum tokens cannot be applied", () => {
  const c = structuredClone(baseConfig);
  c.colors.text = c.colors.bg;
  assert.throws(() => validateTheme(c), /contraste/);
  assert.doesNotThrow(() => validateTheme(c, false));
  for (const mutate of [
    (c: any) => (c.typography.font = "url(https://x)"),
    (c: any) => (c.typography.size = 0),
    (c: any) => (c.components.borderWidth = -2),
    (c: any) => (c.effects.speed = 0.01),
    (c: any) => (c.effects.targets = ["text"]),
  ]) {
    const c = structuredClone(baseConfig);
    mutate(c);
    assert.throws(() => validateTheme(c));
  }
});
test("structural CSS grammar compiles allowed tokens and round-trips canonical styles", () => {
  assert.equal(parseSkin(":theme { --ui-size: 18px; }")[0].type, "declaration");
  assert.equal(
    compileSkin(":theme { --ui-size: 18px; }", baseConfig).typography.size,
    18,
  );
  assert.deepEqual(compileSkin(skinSource(baseConfig), baseConfig), baseConfig);
});
test("CSS rejects imports, remote resources, arbitrary selectors, hiding, escapes and malformed syntax", () => {
  for (const css of [
    '@import "https://evil";',
    "body {display:none}",
    ":root {--bg:#000}",
    ":theme {--bg:url(https://x)}",
    ":theme {position:fixed}",
    ":theme {--unknown:red}",
    ":theme {--ui-size:0px}",
    ":theme {--ui-font:evil}",
    ":theme {--bg:expression(alert(1))}",
    ":theme {--bg:#000;",
    "/*not closed",
    ":theme {--b\\67:#000}",
    ":theme {--bg:#fff;--bg:#000}",
    ":theme {--ui-size:calc(1px + 1px)}",
  ])
    assert.throws(() => compileSkin(css, baseConfig), css);
  assert.throws(() => parseSkin(" ".repeat(12001)));
});
test("theme JSON validates format, size, fields and executable-looking values", () => {
  const parsed = importThemeJSON(exportThemeJSON("O meu tema", baseConfig));
  assert.equal(parsed.name, "O meu tema");
  assert.deepEqual(parsed.config, baseConfig);
  assert.throws(() =>
    importThemeJSON(
      JSON.stringify({
        format: "arquivo-global-theme",
        version: 1,
        name: "x",
        config: baseConfig,
        script: "alert(1)",
      }),
    ),
  );
  assert.throws(() => importThemeJSON(" ".repeat(16001)));
});
test("ISO catalog is global, unique and excludes non-ISO macros", () => {
  assert.equal(countries.length, 249);
  assert.equal(new Set(countries.map((c) => c.code)).size, 249);
  for (const code of [
    "MZ",
    "BR",
    "ZA",
    "JP",
    "US",
    "AQ",
    "AX",
    "RE",
    "HK",
    "PR",
    "NZ",
    "NC",
  ])
    assert.ok(countries.some((c) => c.code === code));
  assert.ok(!countries.some((c) => c.code === "EU" || c.code === "XK"));
  assert.ok(searchCountries("mocambique").some((c) => c.code === "MZ"));
  assert.ok(searchCountries("JPN").some((c) => c.code === "JP"));
});
test("CLDR recommendations preserve documented status instead of inventing official languages", () => {
  const mz = countries.find((c) => c.code === "MZ")!;
  assert.equal(mz.languages.find((l) => l.code === "pt")?.status, "official");
  assert.equal(
    mz.languages.find((l) => l.code === "vmw")?.status,
    "documented",
  );
  assert.ok(
    countries
      .find((c) => c.code === "ZA")!
      .languages.some((l) => l.code === "zu"),
  );
  assert.ok(
    countries
      .find((c) => c.code === "BR")!
      .languages.some((l) => l.code === "pt"),
  );
  assert.ok(readingLanguages.some((l) => l.code === "fr"));
});
test("country never restricts reading languages or approved interface choice", () => {
  const v = defaults();
  v.settings.region = "JP";
  v.settings.readingLanguages = ["fr"];
  assert.doesNotThrow(() => validateSnapshot(v));
  v.settings.region = "XX";
  assert.throws(() => validateSnapshot(v));
  v.settings.region = "MZ";
  v.settings.locale = "en";
  assert.throws(() => validateSnapshot(v), /indisponível/);
});
test("translation availability is honest and fallback/plurals/Intl/RTL are explicit", () => {
  assert.deepEqual(
    interfaceLocales.filter((l) => l.available).map((l) => l.code),
    ["pt-PT"],
  );
  assert.equal(resolveLocale("fr"), "pt-PT");
  assert.equal(translate("themeCount", { count: 1 }), "1 tema pessoal");
  assert.equal(translate("themeCount", { count: 2 }), "2 temas pessoais");
  assert.match(localizedDate("2026-11-16T12:00:00Z"), /2026/);
  assert.ok(localizedNumber(1234.5).includes(",5"));
  assert.equal(documentDirection("ar"), "rtl");
  assert.equal(documentDirection("pt-PT"), "ltr");
  assert.ok(
    !renderToStaticMarkup(
      <p>{translate("themeCount", { count: "<img src=x>" })}</p>,
    ).includes("<img"),
  );
});
test("concurrent snapshots preserve both theme edits, without importing ownership", () => {
  const remote = defaults(),
    local = defaults(),
    id = crypto.randomUUID();
  remote.revision = 2;
  remote.themes = [
    { id, name: "Na conta", config: structuredClone(baseConfig) },
  ];
  local.themes = [
    { id, name: "Neste dispositivo", config: structuredClone(baseConfig) },
  ];
  local.settings.theme = id;
  const merged = mergeSnapshots(remote, local);
  assert.equal(merged.themes.length, 2);
  assert.equal(merged.revision, 2);
  assert.notEqual(merged.settings.theme, id);
  assert.equal(local.themes.length, 1);
});
test("personal snapshot enforces quotas, active ownership and exact fields", () => {
  const v = defaults();
  v.settings.theme = crypto.randomUUID();
  assert.throws(() => validateSnapshot(v));
  assert.throws(() => validateSnapshot({ ...defaults(), extra: "no" }));
  const many = defaults();
  many.themes = Array.from({ length: 21 }, (_, i) => ({
    id: crypto.randomUUID(),
    name: "Tema " + i,
    config: structuredClone(baseConfig),
  }));
  assert.throws(() => validateSnapshot(many));
});
test("repository pins session owner, refuses account changes and preserves operation IDs after network failure", async () => {
  let owner = "A",
    lost = true;
  const calls: any[] = [];
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: owner }, access_token: "current" } },
      }),
    },
    rpc: (name: string, args: any) => ({
      setHeader: async (k: string, v: string) => {
        calls.push({ name, args, k, v });
        if (lost) {
          lost = false;
          throw Error("network");
        }
        return { data: { ...defaults(), revision: 1 }, error: null };
      },
    }),
  };
  const repo = createPersonalizationRepository("A", client as any);
  await assert.rejects(() => repo.call("save", defaults()));
  await repo.call("save", defaults());
  assert.equal(calls[0].args.p_operation, calls[1].args.p_operation);
  assert.equal(calls[1].v, "Bearer current");
  owner = "B";
  await assert.rejects(() => repo.call("read"), /conta mudou/);
  assert.equal(calls.length, 2);
});
test("generated styles contain only normalized local values", () => {
  const vars = themeVariables(baseConfig);
  assert.equal(vars["--bg"], "#0b1524");
  assert.ok(
    !Object.values(vars).some((v) => /url\(|https?:|javascript:/i.test(v)),
  );
});
