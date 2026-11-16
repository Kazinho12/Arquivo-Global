import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { Button } from "../../components/ui";
import { usePersonalization } from "./PersonalizationProvider";
export default function RecoveryPage() {
  const p = usePersonalization();
  return (
    <section className="container recovery-page">
      <h1>
        <RotateCcw aria-hidden="true" /> Recuperar aparência oficial
      </h1>
      <p>
        Esta página usa sempre o tema oficial, sem CSS pessoal ou RGB. Restaura
        apenas a aparência; temas guardados, idioma, obras e dados de leitura
        são preservados.
      </p>
      <Button onClick={p.reset}>Restaurar Noite Estrelada</Button>
      {p.message && <p role="status">{p.message}</p>}
      <p>
        Rota direta: <code>/definicoes/aparencia/recuperar</code>. Não depende
        de ficheiros de estilos importados.
      </p>
      <Link className="button secondary" to="/definicoes/aparencia">
        Voltar à galeria
      </Link>
    </section>
  );
}
