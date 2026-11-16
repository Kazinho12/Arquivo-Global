import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui";
import { officialThemes, themeVariables } from "./themes";
import { usePersonalization, useI18n } from "./PersonalizationProvider";
import { ThemeIcon, PersonalizationStatus, downloadText } from "./ThemeUI";
import { exportThemeJSON, importThemeJSON } from "./model";
export default function AppearancePage() {
  const p = usePersonalization(),
    { t } = useI18n();
  const [error, setError] = useState("");
  return (
    <section className="settings-page chromatic-page">
      <header className="settings-header">
        <span className="eyebrow">DEFINIÇÕES</span>
        <h1>Aparência da interface</h1>
        <p>
          Uma coleção oficial com ícones próprios, cores validadas e preferência
          privada.
        </p>
      </header>
      <div className="actions">
        <Link className="button primary" to="/definicoes/aparencia/estudio">
          Chromatic Studio — Cria o teu universo
        </Link>
        <Button onClick={p.reset}>{t("reset")}</Button>
        <Button
          onClick={() => {
            const c = structuredClone(p.config);
            c.effects.mode = "off";
            p.select("custom", c);
          }}
        >
          Desligar efeitos RGB
        </Button>
      </div>
      <PersonalizationStatus />
      <div className="chromatic-gallery">
        {officialThemes.map((theme) => (
          <button
            type="button"
            key={theme.id}
            className="chromatic-theme-card"
            style={themeVariables(theme.config) as any}
            aria-pressed={p.data.settings.theme === theme.id}
            onClick={() => p.select(theme.id)}
          >
            <span className="theme-title-row">
              <ThemeIcon name={theme.icon} />
              <strong>{theme.name}</strong>
              {p.data.settings.theme === theme.id && (
                <span className="sr-only">Selecionado</span>
              )}
            </span>
            <span className="chromatic-mini-lines">
              <i />
              <i />
              <i />
            </span>
            <span>{theme.description}</span>
            <span className="chromatic-palette" aria-label="Paleta de cores">
              {["bg", "surface", "text", "button"].map((k) => (
                <i
                  key={k}
                  style={{
                    background:
                      theme.config.colors[
                        k as keyof typeof theme.config.colors
                      ],
                  }}
                />
              ))}
            </span>
            <span className="sr-only">
              {theme.id === "dark"
                ? "Tema Escuro"
                : theme.id === "light"
                  ? "Tema Claro"
                  : ""}
            </span>
          </button>
        ))}
      </div>
      <h2>{t("themeCount", { count: p.data.themes.length })}</h2>
      <p>
        Até 20 temas pessoais. Os temas dos perfis visitados não alteram a tua
        aparência.
      </p>
      {error && <p role="alert">{error}</p>}
      <label className="field">
        Importar tema JSON validado
        <input
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            try {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 16000) throw Error("Máximo de 16 KB.");
              const imported = importThemeJSON(await f.text());
              p.change({
                ...p.data,
                themes: [
                  ...p.data.themes,
                  { ...imported, id: crypto.randomUUID() },
                ],
              });
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      </label>
      <ul className="chromatic-personal-list">
        {p.data.themes.map((theme) => (
          <li className="panel" key={theme.id}>
            <ThemeIcon name="custom" />
            <h3>{theme.name}</h3>
            <div className="actions">
              <Button onClick={() => p.select(theme.id)}>Aplicar tema</Button>
              <Link
                className="button secondary"
                to={"/definicoes/aparencia/estudio?tema=" + theme.id}
              >
                Editar
              </Link>
              <Button
                onClick={() => {
                  const name = window.prompt(
                    "Nome da cópia",
                    theme.name + " — cópia",
                  );
                  if (name?.trim())
                    p.change({
                      ...p.data,
                      themes: [
                        ...p.data.themes,
                        {
                          ...theme,
                          id: crypto.randomUUID(),
                          name: name.trim(),
                        },
                      ],
                    });
                }}
              >
                Duplicar
              </Button>
              <Button
                onClick={() => {
                  const name = window.prompt("Novo nome", theme.name);
                  if (name?.trim())
                    p.change({
                      ...p.data,
                      themes: p.data.themes.map((t) =>
                        t.id === theme.id ? { ...t, name: name.trim() } : t,
                      ),
                    });
                }}
              >
                Renomear
              </Button>
              <Button
                onClick={() =>
                  downloadText(
                    "arquivo-global-tema.json",
                    exportThemeJSON(theme.name, theme.config),
                    "application/json",
                  )
                }
              >
                Exportar JSON
              </Button>
              <Button
                onClick={() => {
                  if (!window.confirm("Eliminar apenas este tema pessoal?"))
                    return;
                  const next = {
                    ...p.data,
                    themes: p.data.themes.filter((t) => t.id !== theme.id),
                  };
                  if (next.settings.theme === theme.id)
                    next.settings = {
                      ...next.settings,
                      theme: "night",
                      config: structuredClone(officialThemes[0].config),
                    };
                  p.change(next);
                }}
              >
                Excluir tema próprio
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
