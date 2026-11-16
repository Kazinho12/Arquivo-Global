import { useEffect, useRef, useMemo, useState } from "react";
import { Globe2, Languages, Check } from "lucide-react";
import { Button } from "../../components/ui";
import { usePersonalization, useI18n } from "./PersonalizationProvider";
import { interfaceLocales } from "./i18n";
import {
  countries,
  searchCountries,
  countryName,
  readingLanguages,
  languageStatus,
  nativeCountryName,
  dataSource,
} from "./world";
import { PersonalizationStatus } from "./ThemeUI";
export default function LanguagePage() {
  const p = usePersonalization(),
    { locale } = useI18n();
  const [region, setRegion] = useState(p.data.settings.region ?? ""),
    [language, setLanguage] = useState(p.data.settings.locale),
    [preferred, setPreferred] = useState(p.data.settings.readingLanguages),
    [query, setQuery] = useState(""),
    [all, setAll] = useState(false),
    [search, setSearch] = useState(""),
    [limit, setLimit] = useState(50);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) {
      setRegion(p.data.settings.region ?? "");
      setLanguage(p.data.settings.locale);
      setPreferred(p.data.settings.readingLanguages);
    }
  }, [
    p.data.settings.region,
    p.data.settings.locale,
    p.data.settings.readingLanguages,
  ]);
  const results = useMemo(
    () => searchCountries(query, locale),
    [query, locale],
  );
  const country = countries.find((c) => c.code === region);
  const selected =
    country && !results.some((c) => c.code === region)
      ? [country, ...results]
      : results;
  const languages = all ? readingLanguages : (country?.languages ?? []);
  const matches = languages.filter((l) =>
    (l.name + " " + l.code)
      .toLocaleLowerCase(locale)
      .includes(search.toLocaleLowerCase(locale)),
  );
  const native = country?.languages[0]
    ? nativeCountryName(region, country.languages[0].code)
    : null;
  return (
    <section className="settings-page chromatic-page">
      <header className="settings-header">
        <span className="eyebrow">DEFINIÇÕES</span>
        <h1>
          <Languages aria-hidden="true" /> Idioma e Região
        </h1>
        <p>
          Escolhe o teu país, idioma da interface e preferências linguísticas de
          leitura.
        </p>
      </header>
      <PersonalizationStatus />
      <form
        className="panel language-region-form"
        onSubmit={(e) => {
          e.preventDefault();
          p.change({
            ...p.data,
            settings: {
              ...p.data.settings,
              region: region || null,
              locale: language,
              readingLanguages: preferred,
            },
          });
        }}
      >
        <h2>
          <Globe2 aria-hidden="true" /> País ou região
        </h2>
        <label>
          Pesquisar país, território ou código ISO
          <input
            type="search"
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <p>
          {results.length} de {countries.length} países e territórios ISO
          3166-1.
        </p>
        <label>
          País ou território
          <select
            size={7}
            value={region}
            onChange={(e) => {
              touched.current = true;
              setRegion(e.target.value);
              setSearch("");
              setLimit(50);
            }}
          >
            <option value="">Sem região definida</option>
            {selected.map((c) => (
              <option value={c.code} key={c.code}>
                {countryName(c.code, locale)} · {c.code} / {c.alpha3}
              </option>
            ))}
          </select>
        </label>
        {country && (
          <p>
            Designação na fonte ISO: {country.name}.{" "}
            {native && native !== countryName(region, locale)
              ? `Nome em ${country.languages[0].name}: ${native}.`
              : ""}
          </p>
        )}
        <fieldset>
          <legend>Idioma da interface</legend>
          <p>
            O país não limita o idioma. A interface de referência disponível
            nesta entrega é Português (Portugal). As outras variantes e
            traduções ainda não estão completas/revistas e não podem ser
            aplicadas.
          </p>
          {interfaceLocales.map((l) => (
            <label className="locale-choice" key={l.code}>
              <input
                type="radio"
                name="interface-locale"
                value={l.code}
                disabled={!l.available}
                checked={language === l.code}
                onChange={() => {
                  touched.current = true;
                  setLanguage(l.code);
                }}
              />
              <span>
                {l.name} · {l.code}
                {!l.available
                  ? " — indisponível (tradução global por concluir)"
                  : " — referência disponível"}
              </span>
            </label>
          ))}
        </fieldset>
        <section>
          <h2>Idiomas preferidos das obras</h2>
          <p>
            Não traduzem textos literários nem alteram os filtros de conteúdo.
            Guarda até 20 preferências, independentemente do país.
          </p>
          <h3>
            {all
              ? "Todos os idiomas catalogados"
              : country
                ? "Idiomas documentados para " + countryName(region, locale)
                : "Seleciona uma região ou consulta todos os idiomas"}
          </h3>
          <Button
            onClick={() => {
              setAll((v) => !v);
              setSearch("");
              setLimit(50);
            }}
          >
            <Globe2 size={18} />
            {all ? "Ver recomendações da região" : "Ver todos os idiomas"}
          </Button>
          <label>
            Pesquisar idioma
            <input
              type="search"
              value={search}
              maxLength={100}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(50);
              }}
            />
          </label>
          <ul className="language-recommendations">
            {matches.slice(0, limit).map((l) => (
              <li key={l.code}>
                <label>
                  <input
                    type="checkbox"
                    checked={preferred.includes(l.code)}
                    disabled={
                      !preferred.includes(l.code) && preferred.length >= 20
                    }
                    onChange={(e) => {
                      touched.current = true;
                      setPreferred(
                        e.target.checked
                          ? [...preferred, l.code]
                          : preferred.filter((c) => c !== l.code),
                      );
                    }}
                  />
                  {l.name} · {l.code}
                </label>
                {"status" in l && (
                  <small>
                    {languageStatus[String(l.status)] ??
                      "Uso documentado (CLDR)"}
                  </small>
                )}
              </li>
            ))}
          </ul>
          {!matches.length && (
            <p>
              Sem associações correspondentes nesta fonte. Não são inventadas
              recomendações.
            </p>
          )}
          {matches.length > limit && (
            <Button onClick={() => setLimit(limit + 50)}>
              Mostrar mais idiomas
            </Button>
          )}
          <p>
            Preferências selecionadas:{" "}
            {preferred
              .map(
                (code) =>
                  readingLanguages.find((l) => l.code === code)?.name ?? code,
              )
              .join(", ") || "nenhuma"}
            .
          </p>
        </section>
        <Button type="submit">Guardar preferência neste dispositivo</Button>
        <p>
          Para sincronizar, usa depois «Guardar na conta». Mudar idioma não
          recarrega a página nem altera a direção de leitura de mangá.
        </p>
      </form>
      <p className="muted">
        Fontes: {dataSource.iso}; {dataSource.cldr}. Estatutos linguísticos
        reproduzem o CLDR e não equivalem a uma revisão jurídica de legislação
        nacional. As coberturas da fonte e das traduções de interface são
        distintas.
      </p>
    </section>
  );
}
