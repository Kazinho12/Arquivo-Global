import { useEffect, useRef, useState, useId } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Undo2,
  Redo2,
  Palette,
  Code2,
  Download,
  Upload,
  RotateCcw,
} from "lucide-react";
import { Button } from "../../components/ui";
import { usePersonalization } from "./PersonalizationProvider";
import {
  colorKeys,
  contrastErrors,
  normalizeColor,
  validateTheme,
  type ThemeConfig,
  type ColorKey,
} from "./themes";
import { compileSkin, skinSource, skinHighlight } from "./skin";
import { ThemePreview, PersonalizationStatus, downloadText } from "./ThemeUI";
const colorLabels: Record<ColorKey, string> = {
  bg: "Fundo principal",
  surface: "Superfícies",
  elevated: "Superfícies elevadas",
  text: "Texto principal",
  muted: "Texto secundário",
  link: "Links",
  button: "Botões",
  buttonText: "Texto dos botões",
  border: "Bordas",
  accent: "Destaque",
  focus: "Foco",
  success: "Sucesso",
  warning: "Aviso",
  error: "Erro",
};
function ColorField({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
}) {
  const fieldId = useId();
  const [text, setText] = useState(value),
    [error, setError] = useState("");
  useEffect(() => setText(value), [value]);
  return (
    <div className="chromatic-color-field">
      <label>
        {label}
        <input
          aria-label={"Selecionar " + label}
          type="color"
          value={value}
          onChange={(e) => {
            change(e.target.value);
            setText(e.target.value);
            setError("");
          }}
        />
      </label>
      <label className="sr-only" htmlFor={fieldId}>
        Valor de {label}
      </label>
      <input
        id={fieldId}
        aria-label={"Valor de " + label}
        value={text}
        maxLength={80}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            const hex = normalizeColor(text);
            change(hex);
            setText(hex);
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
export default function ChromaticStudio() {
  const p = usePersonalization(),
    [params] = useSearchParams();
  const editing = p.data.themes.find((t) => t.id === params.get("tema"));
  const [history, setHistory] = useState<ThemeConfig[]>([
      structuredClone(editing?.config ?? p.config),
    ]),
    [index, setIndex] = useState(0),
    [error, setError] = useState(""),
    [compare, setCompare] = useState(false),
    [css, setCss] = useState(""),
    [cssOpen, setCssOpen] = useState(false);
  const before = useRef(structuredClone(editing?.config ?? p.config));
  const touched = useRef(false);
  const draft = history[index];
  useEffect(() => {
    if (!touched.current) {
      const next = structuredClone(editing?.config ?? p.config);
      before.current = next;
      setHistory([next]);
      setIndex(0);
    }
  }, [editing?.id, p.config]);
  function edit(next: ThemeConfig) {
    touched.current = true;
    const list = [...history.slice(0, index + 1), structuredClone(next)].slice(
      -50,
    );
    setHistory(list);
    setIndex(list.length - 1);
    setError("");
  }
  function update(
    group: "typography" | "components" | "effects",
    key: string,
    value: unknown,
  ) {
    edit({ ...draft, [group]: { ...draft[group], [key]: value } });
  }
  function save(existing = false) {
    try {
      const config = validateTheme(draft);
      const name = window.prompt(
        existing ? "Nome do tema" : "Nome do novo tema",
        editing?.name ?? "O meu universo",
      );
      if (!name?.trim()) return;
      const id = existing && editing ? editing.id : crypto.randomUUID();
      const theme = { id, name: name.trim(), config };
      const themes =
        existing && editing
          ? p.data.themes.map((t) => (t.id === editing.id ? theme : t))
          : [...p.data.themes, theme];
      p.change({ ...p.data, themes });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const warnings = contrastErrors(draft);
  let preview: ThemeConfig;
  try {
    preview = validateTheme(draft, false);
  } catch {
    preview = before.current;
  }
  const range = (
    group: "typography" | "components" | "effects",
    key: string,
    label: string,
    min: number,
    max: number,
    step: number,
  ) => (
    <label className="chromatic-range" key={key}>
      {label}
      <output>{String((draft[group] as any)[key])}</output>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={(draft[group] as any)[key]}
        onChange={(e) => update(group, key, Number(e.target.value))}
      />
    </label>
  );
  return (
    <section className="settings-page chromatic-page">
      <header className="settings-header">
        <span className="eyebrow">PERSONALIZAÇÃO PRIVADA</span>
        <h1>
          <Palette aria-hidden="true" /> Chromatic Studio — Cria o teu universo
        </h1>
        <p>
          Pré-visualiza sem alterar o site real. Aplicar confirma a aparência
          deste dispositivo; a gravação na conta é separada.
        </p>
      </header>
      <nav className="actions">
        <Link to="/definicoes/aparencia">Galeria de temas</Link>
        <Link to="/definicoes/aparencia/recuperar">
          Recuperar aparência oficial
        </Link>
      </nav>
      <PersonalizationStatus />
      <div className="chromatic-studio-grid">
        <section className="chromatic-editor">
          <h2>Cores</h2>
          <p>
            HEX, RGB ou HSL. Valores inválidos nunca são aplicados ao CSS da
            página.
          </p>
          {colorKeys.map((key) => (
            <ColorField
              key={key}
              label={colorLabels[key]}
              value={draft.colors[key]}
              change={(value) =>
                edit({ ...draft, colors: { ...draft.colors, [key]: value } })
              }
            />
          ))}
          <h2>Tipografia da interface</h2>
          <label>
            Família tipográfica
            <select
              value={draft.typography.font}
              onChange={(e) => update("typography", "font", e.target.value)}
            >
              <option value="sans">Sem serifa · sistema</option>
              <option value="serif">Serifa · literária</option>
              <option value="mono">Monoespaçada · sistema</option>
            </select>
          </label>
          {range("typography", "size", "Tamanho geral", 14, 22, 1)}
          {range("typography", "lineHeight", "Altura de linha", 1.4, 1.9, 0.05)}
          {range(
            "typography",
            "headingWeight",
            "Peso dos títulos",
            500,
            800,
            100,
          )}
          {range(
            "typography",
            "letterSpacing",
            "Espaçamento de letras",
            0,
            0.12,
            0.01,
          )}
          <h2>Componentes</h2>
          {range(
            "components",
            "cardRadius",
            "Arredondamento dos cartões",
            0,
            24,
            1,
          )}
          {range(
            "components",
            "buttonRadius",
            "Arredondamento dos botões",
            0,
            24,
            1,
          )}
          {range(
            "components",
            "borderWidth",
            "Espessura das bordas",
            1,
            3,
            0.5,
          )}
          {range("components", "spacing", "Espaçamento", 0.85, 1.3, 0.05)}
          <label>
            Sombras
            <select
              value={draft.components.shadow}
              onChange={(e) => update("components", "shadow", e.target.value)}
            >
              <option value="none">Sem sombra</option>
              <option value="soft">Suave</option>
              <option value="deep">Profunda</option>
            </select>
          </label>
          <label>
            Densidade
            <select
              value={draft.components.density}
              onChange={(e) => update("components", "density", e.target.value)}
            >
              <option value="compact">Compacta</option>
              <option value="normal">Normal</option>
              <option value="comfortable">Confortável</option>
            </select>
          </label>
          <h2>Efeitos RGB opcionais</h2>
          <p>
            Desligados por padrão. Só decoração; nunca texto literário, fundos
            de capítulos ou imagens.
          </p>
          <label>
            Modo RGB
            <select
              value={draft.effects.mode}
              onChange={(e) => update("effects", "mode", e.target.value)}
            >
              <option value="off">Desligado</option>
              <option value="static">Arco-íris estático</option>
              <option value="soft">RGB suave</option>
              <option value="dynamic">RGB dinâmico</option>
            </select>
          </label>
          {range("effects", "intensity", "Intensidade", 0, 0.4, 0.05)}
          {range("effects", "speed", "Duração do ciclo em segundos", 10, 90, 5)}
          {range("effects", "saturation", "Saturação", 0, 1, 0.1)}
          <fieldset>
            <legend>Elementos decorativos afetados</legend>
            {(
              [
                ["borders", "Bordas"],
                ["icons", "Ícones"],
                ["highlights", "Destaques"],
                ["decoration", "Decoração"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={draft.effects.targets.includes(key)}
                  onChange={(e) =>
                    update(
                      "effects",
                      "targets",
                      e.target.checked
                        ? [...draft.effects.targets, key]
                        : draft.effects.targets.filter((t) => t !== key),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <Button onClick={() => update("effects", "mode", "off")}>
            Desligar RGB na prévia
          </Button>
        </section>
        <section className="chromatic-preview-column">
          <div className="actions">
            <Button disabled={index === 0} onClick={() => setIndex(index - 1)}>
              <Undo2 size={16} /> Desfazer
            </Button>
            <Button
              disabled={index === history.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              <Redo2 size={16} /> Refazer
            </Button>
            <Button onClick={() => setCompare((v) => !v)}>
              {compare ? "Mostrar só depois" : "Comparar antes/depois"}
            </Button>
          </div>
          {compare && (
            <>
              <h2>Antes</h2>
              <ThemePreview
                config={before.current}
                label="Antes das alterações"
              />
            </>
          )}
          <h2>Depois · ainda não aplicado</h2>
          <ThemePreview config={preview} />
          <div className="chromatic-decor" aria-hidden="true" />
          {warnings.length > 0 && (
            <div role="alert">
              <h3>Contraste por corrigir antes de aplicar</h3>
              <ul>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="actions">
            <Button
              disabled={warnings.length > 0}
              onClick={() => {
                try {
                  p.select("custom", validateTheme(draft));
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Aplicar aparência
            </Button>
            <Button disabled={warnings.length > 0} onClick={() => save()}>
              Guardar como novo tema
            </Button>
            {editing && (
              <Button disabled={warnings.length > 0} onClick={() => save(true)}>
                Guardar alterações no tema
              </Button>
            )}
            <Button onClick={() => edit(before.current)}>
              <RotateCcw size={16} /> Restaurar valores
            </Button>
            <Button
              onClick={() => {
                p.reset();
                edit(structuredClone(before.current));
              }}
            >
              Restaurar tema oficial
            </Button>
          </div>
          <details
            open={cssOpen}
            onToggle={(e) => setCssOpen(e.currentTarget.open)}
            className="panel chromatic-css"
          >
            <summary>
              <Code2 size={18} /> Editor CSS avançado · subconjunto controlado
            </summary>
            <p>
              Usa apenas <code>:theme {"{ --bg: #0b1524; }"}</code> e as
              variáveis abaixo. O parser converte o CSS em tokens validados. O
              texto original nunca é executado nem inserido como stylesheet.
            </p>
            <Button onClick={() => setCss(skinSource(draft))}>
              Carregar variáveis da prévia
            </Button>
            <label>
              CSS pessoal
              <textarea
                spellCheck={false}
                rows={15}
                maxLength={12000}
                value={css}
                onChange={(e) => setCss(e.target.value)}
              />
            </label>
            <div className="actions">
              <Button
                onClick={() => {
                  try {
                    edit(compileSkin(css, draft));
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Validar CSS e pré-visualizar
              </Button>
              <Button onClick={() => setCss(skinSource(before.current))}>
                Restaurar CSS
              </Button>
              <Button
                onClick={() =>
                  downloadText(
                    "arquivo-global-skin.css",
                    skinSource(draft),
                    "text/css",
                  )
                }
              >
                <Download size={16} /> Exportar CSS validado
              </Button>
            </div>
            <label>
              Importar CSS
              <input
                type="file"
                accept=".css,text/css"
                onChange={async (e) => {
                  try {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 12000) throw Error("Máximo de 12 KB.");
                    const source = await f.text();
                    const config = compileSkin(source, draft);
                    setCss(source);
                    edit(config);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            </label>
            <pre aria-label="CSS analisado com realce de sintaxe">
              {skinHighlight(css).map((n, i) => (
                <span key={i}>
                  <span className="skin-property">{n.name}</span>:{" "}
                  <span className="skin-value">{n.value}</span>;{"\n"}
                </span>
              ))}
            </pre>
            <p>
              Variáveis permitidas: cores listadas, <code>--ui-font</code>{" "}
              (sans/serif/mono), <code>--ui-size</code> (px),{" "}
              <code>--ui-leading</code>, <code>--ui-weight</code>,{" "}
              <code>--ui-tracking</code> (em), <code>--card-radius</code> (px),{" "}
              <code>--button-radius</code> (px), <code>--ui-border</code> (px),{" "}
              <code>--ui-spacing</code>. Sem URLs, fontes remotas, regras @,
              seletores arbitrários ou propriedades de posicionamento/ocultação.
              Efeitos RGB só nos controlos visuais.
            </p>
          </details>
        </section>
      </div>
    </section>
  );
}
