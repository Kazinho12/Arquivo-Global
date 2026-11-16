import { personalizationSyncEnabled } from "./repository";
import {
  Gem,
  Sunset,
  Sunrise,
  Leaf,
  Waves,
  Diamond,
  Orbit,
  Flower2,
  ScrollText,
  Contrast,
  Square,
  MoonStar,
  Sun,
  Moon,
  Monitor,
  Palette,
  Check,
  Download,
  Upload,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui";
import { usePersonalization } from "./PersonalizationProvider";
import { themeVariables, type ThemeConfig } from "./themes";
export const themeIcons: Record<string, typeof Gem> = {
  gem: Gem,
  sunset: Sunset,
  sunrise: Sunrise,
  leaf: Leaf,
  waves: Waves,
  diamond: Diamond,
  orbit: Orbit,
  flower: Flower2,
  scroll: ScrollText,
  contrast: Contrast,
  square: Square,
  stars: MoonStar,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  custom: Palette,
};
export function ThemeIcon({ name }: { name: string }) {
  const Icon = themeIcons[name] ?? Palette;
  return <Icon size={22} aria-hidden="true" />;
}
export function ThemePreview({
  config,
  label = "Pré-visualização isolada",
}: {
  config: ThemeConfig;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      className="chromatic-preview"
      style={themeVariables(config) as any}
    >
      <nav>
        <span>
          <ThemeIcon name="stars" /> Arquivo Global
        </span>
        <a href="#" onClick={(e) => e.preventDefault()}>
          Navegação
        </a>
      </nav>
      <article className="chromatic-preview-card">
        <h3>Prévia de um cartão de obra</h3>
        <p>Amostra de interface, sem publicação associada.</p>
        <div className="actions">
          <button type="button" className="button primary">
            Botão principal
          </button>
          <button type="button" className="button secondary">
            Contorno
          </button>
          <a href="#" onClick={(e) => e.preventDefault()}>
            Ligação de exemplo
          </a>
        </div>
      </article>
      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          Campo de formulário
          <input placeholder="Escreve para experimentar" />
        </label>
      </form>
      <blockquote>
        A leitura encontra espaço, luz e ritmo. Amostra tipográfica sem conteúdo
        publicado.
      </blockquote>
      <span className="chromatic-preview-status">
        Estado de interface e foco de teclado
      </span>
    </section>
  );
}
export function PersonalizationStatus() {
  const p = usePersonalization();
  return (
    <aside
      className="panel personalization-status"
      aria-label="Persistência da personalização"
    >
      <p>
        {p.owner
          ? p.dirty
            ? "Alterações neste dispositivo, por sincronizar."
            : "Preferências da conta/dispositivo."
          : "Preferências locais de visitante."}
      </p>
      {p.owner && !personalizationSyncEnabled && (
        <p>
          Sincronização remota pendente de instalação e ativação. As alterações
          permanecem neste dispositivo.
        </p>
      )}
      {p.message && <p role="status">{p.message}</p>}
      {p.owner && (
        <div className="actions">
          <Button disabled={p.busy} onClick={() => void p.saveAccount()}>
            Guardar na conta
          </Button>
          <Button disabled={p.busy} onClick={() => void p.reload()}>
            Consultar versão da conta
          </Button>
          <Button
            disabled={p.busy}
            onClick={() => {
              if (
                window.confirm(
                  "Importar explicitamente as preferências anónimas deste dispositivo? Os originais serão preservados.",
                )
              )
                p.importGuest();
            }}
          >
            Importar preferências deste dispositivo
          </Button>
        </div>
      )}
      {p.remote && (
        <div>
          <p>
            Há uma versão remota para conciliar. Exporta os temas locais antes
            de descartar alterações.
          </p>
          <Button onClick={p.merge}>Conciliar preservando temas</Button>
          <Button
            onClick={() => {
              if (
                window.confirm(
                  "Aplicar os dados da conta e descartar alterações locais não guardadas?",
                )
              )
                p.useRemote();
            }}
          >
            Usar versão da conta
          </Button>
        </div>
      )}
      <Link to="/definicoes/aparencia/recuperar">Recuperar tema oficial</Link>
    </aside>
  );
}
export function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
