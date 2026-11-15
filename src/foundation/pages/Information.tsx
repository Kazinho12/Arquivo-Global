import {
  createCenterRepository,
  type CenterItem,
} from "../features/center/repository";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Mail, PenLine, Shield } from "lucide-react";
import { SearchField } from "../components/ui";
import { filterText } from "../features/completion/data";
import { CompletionPage } from "../features/completion/ui";

export const institutionalEmail = "arquivoglobal.org@gmail.com";
export function contactHref(subject: string) {
  return `mailto:${institutionalEmail}?subject=${encodeURIComponent(subject)}`;
}
const related = [
  ["/ajuda", "Central de Ajuda"],
  ["/regras", "Regras da Comunidade"],
  ["/privacidade", "Política de Privacidade"],
  ["/contacto", "Contacto Institucional"],
  ["/suporte", "Suporte"],
  ["/termos", "Termos de Utilização"],
  ["/direitos-autor", "Direitos de Autor"],
  ["/contestacao", "Contestação de moderação"],
  ["/transparencia", "Transparência"],
];
function InstitutionalNav() {
  return (
    <nav className="institutional-links" aria-label="Páginas institucionais">
      {related.map(([to, label]) => (
        <Link key={to} to={to}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
type Section = { title: string; paragraphs: string[] };
function DocumentPage({
  title,
  description,
  sections,
  note,
  policySlug,
}: {
  title: string;
  description: string;
  sections: Section[];
  note?: string;
  policySlug?: string;
}) {
  const repo = useMemo(() => createCenterRepository(), []);
  const [policy, setPolicy] = useState<CenterItem | null>(null),
    [policyError, setPolicyError] = useState("");
  useEffect(() => {
    if (!policySlug) return;
    let active = true;
    repo.publicItems("policy", policySlug).then(
      (items) => {
        if (active) setPolicy(items[0] ?? null);
      },
      (e) => {
        if (active) setPolicyError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [repo, policySlug]);
  return (
    <CompletionPage
      eyebrow="ARQUIVO GLOBAL · UM ESPAÇO PARA CRIAR"
      title={title}
      description={description}
    >
      <InstitutionalNav />
      {policySlug && !policy && (
        <aside className="notice" role="note">
          Minuta para revisão jurídica e institucional. Não é apresentada como
          política aprovada. A autorização de publicação de uma versão revista é
          necessária.
        </aside>
      )}
      {policyError && (
        <p role="status">
          {policyError} O texto abaixo permanece identificado como minuta.
        </p>
      )}
      <div className="completion-document institutional-document">
        <nav aria-label={`Índice: ${title}`} hidden={!!policy}>
          <h2>Nesta página</h2>
          {sections.map((s, i) => (
            <a href={`#section-${i}`} key={s.title}>
              {s.title}
            </a>
          ))}
        </nav>
        <article>
          {policy ? (
            <section>
              <h2>Versão publicada pela administração</h2>
              <p className="center-text">{policy.body}</p>
              <time dateTime={policy.updated_at}>
                {new Date(policy.updated_at).toLocaleString("pt-PT")}
              </time>
            </section>
          ) : (
            sections.map((s, i) => (
              <section id={`section-${i}`} key={s.title}>
                <h2>{s.title}</h2>
                {s.paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </section>
            ))
          )}
          <section>
            <h2>Estamos à escuta</h2>
            <p>
              Para dúvidas, sugestões ou pedidos, escreve para{" "}
              <a className="text-link" href={contactHref(title)}>
                {institutionalEmail}
              </a>
              . Inclui apenas os dados necessários para compreender o assunto.
            </p>
          </section>
          {note && (
            <aside className="notice" role="note">
              {note}
            </aside>
          )}
        </article>
      </div>
    </CompletionPage>
  );
}
export function RulesPage() {
  return (
    <DocumentPage
      policySlug="regras"
      title="Regras da Comunidade"
      description="Liberdade para imaginar. Respeito para partilhar. Um compromisso que construímos contigo."
      sections={[
        {
          title: "Respeito e convivência",
          paragraphs: [
            "Respeita as pessoas, mesmo quando discordas das suas ideias. Não publiques ameaças, assédio, exposição de dados pessoais de terceiros ou incentivos à violência contra pessoas.",
          ],
        },
        {
          title: "Autoria e propriedade intelectual",
          paragraphs: [
            "Publica apenas textos e imagens para os quais tens os direitos ou autorizações necessários. Identifica a autoria com rigor e não te faças passar por outra pessoa. Os autores mantêm os direitos sobre as suas obras; poder ler uma obra não significa ter autorização para a reutilizar.",
            "Ao publicar, permites o alojamento e a apresentação do conteúdo necessários à sua disponibilização na plataforma. Isso não transfere a tua autoria. Obras de fãs também podem envolver direitos de terceiros: identifica o contexto e verifica as autorizações necessárias.",
          ],
        },
        {
          title: "Liberdade criativa e responsabilidade",
          paragraphs: [
            "Há lugar para diferentes vozes, géneros e experiências literárias. A publicação não depende de aprovação editorial prévia. Essa liberdade acompanha a responsabilidade pelo conteúdo que escolhes tornar público. A plataforma é gratuita na sua versão atual.",
          ],
        },
        {
          title: "Classificação etária e avisos",
          paragraphs: [
            "Preenche a classificação etária e os avisos de conteúdo com cuidado. Ajuda quem lê a fazer escolhas informadas, sem disfarçar temas sensíveis. Os filtros não substituem essa responsabilidade nem garantem uma verificação independente de cada obra.",
          ],
        },
        {
          title: "Publicação e retirada de obras",
          paragraphs: [
            "Guardar um rascunho não o publica. A publicação e a atualização da versão pública exigem confirmação no Estúdio. Podes continuar a trabalhar em privado sem mudar a versão que os leitores veem.",
            "Podes retirar uma publicação sem eliminar o rascunho. Isso impede novas consultas públicas pela aplicação, mas não elimina cópias anteriormente obtidas por terceiros.",
          ],
        },
        {
          title: "Denúncias e proteção da comunidade",
          paragraphs: [
            "Comunica problemas pelo email institucional. Indica a ligação do conteúdo e explica o motivo, evitando reproduzir dados sensíveis. O formulário de denúncia disponível na aplicação não envia pedidos; usa o email até existir um sistema de envio.",
          ],
        },
        {
          title: "Consequências de violações",
          paragraphs: [
            "Uma violação destas regras pode exigir análise e uma resposta adequada ao caso. As decisões são analisadas por administradores autorizados e podem ser comunicadas às partes. É possível solicitar revisão no suporte, indicando o processo relacionado. Não prometemos sanções automáticas nem prazos de resolução.",
          ],
        },
        {
          title: "Compromisso comunitário",
          paragraphs: [
            "Ajuda-nos a manter um espaço onde a diversidade literária e o cuidado com as pessoas possam coexistir. Classifica com honestidade, respeita a autoria e comunica problemas com clareza.",
          ],
        },
      ]}
    />
  );
}
export function PrivacyPage() {
  return (
    <DocumentPage
      policySlug="privacidade"
      title="Política de Privacidade"
      description="Queremos que compreendas o que partilhas, o que permanece privado e quais os controlos ao teu alcance."
      note="Estamos a aperfeiçoar as informações sobre o tratamento e a conservação de dados pessoais. Para esclarecimentos ou pedidos relacionados com a tua privacidade, contacta-nos através de arquivoglobal.org@gmail.com."
      sections={[
        {
          title: "A tua conta e o teu perfil",
          paragraphs: [
            "Os dados de conta permitem iniciar sessão e associar-te às tuas obras. O nome de utilizador, nome apresentado, biografia e fotografia fazem parte do perfil público. Não incluas informação confidencial nesses campos.",
          ],
        },
        {
          title: "Rascunhos e publicações",
          paragraphs: [
            "As obras e entradas guardadas no Estúdio ficam associadas à tua conta. Os rascunhos privados destinam-se ao proprietário; só a versão cuja publicação confirmas fica disponível aos leitores. Editar em privado não altera automaticamente a versão publicada.",
            "Retirar uma publicação remove o acesso público pela aplicação. Não podemos garantir a eliminação de cópias já obtidas por terceiros.",
          ],
        },
        {
          title: "Interações e biblioteca",
          paragraphs: [
            "Quando as interações estão ativas, comentários e respostas em publicações são públicos, com o nome do perfil. As contagens de curtidas e seguidores são públicas; favoritos, obras guardadas e ler depois são privados. Os itens já guardados apenas no navegador não são importados automaticamente para a conta.",
            "A contagem de leitura é opcional no respetivo controlo. Se a permitires, usa um identificador pseudónimo por até 30 dias para limitar repetições; não é associado à conta. O servidor deriva também uma referência de rede com chave e rotação diária para limitar abuso, sem guardar o endereço IP em claro na base de métricas. Os autores e visitantes veem agregados, não estes identificadores. Desativar o controlo interrompe novos envios e solicita a remoção do identificador deste navegador; não apaga contagens já agregadas.",
            "Comentários podem ser editados ou removidos pelo seu autor. Uma denúncia pode ser analisada por moderadores autorizados; não existe promessa de resposta ou sanção automática. Remover um comentário preserva o lugar das respostas, sem apresentar o seu texto original.",
          ],
        },
        {
          title: "Serviços que tornam isto possível",
          paragraphs: [
            "O Supabase processa autenticação, perfis e conteúdos guardados. Se escolheres iniciar sessão com Google, esse fornecedor também participa na autenticação. O serviço de fotografias utiliza Cloudflare Workers e R2 para receber e alojar imagens de perfil.",
            "A fotografia atual do perfil pode ser vista por visitantes. Substituir ou remover essa fotografia no perfil não significa que o ficheiro anterior seja imediatamente eliminado do armazenamento.",
          ],
        },
        {
          title: "Suporte, denúncias e comunicações",
          paragraphs: [
            "Pedidos de suporte e respetivas respostas ficam associados à conta e são acessíveis ao titular e às contas administrativas designadas. Inclui apenas os dados necessários; não envies passwords, tokens ou documentos pessoais desnecessários. Denúncias de comentários continuam também integradas nos serviços de moderação autorizados existentes.",
            "Comunicados oficiais opcionais dependem da tua preferência nas notificações. Respostas a pedidos e decisões sobre processos relacionados contigo são mensagens de serviço. As operações administrativas produzem registos de auditoria; as contagens do painel são agregadas e não apresentam emails, passwords ou textos de rascunhos.",
          ],
        },
        {
          title: "O que fica no navegador",
          paragraphs: [
            "A sessão, preferências e dados de leitura podem permanecer neste navegador. A leitura anónima mantém continuidade local. Quando a biblioteca avançada estiver disponível, cada conta pode ativar separadamente a sincronização privada do progresso e o histórico, inicialmente desligados. A importação do progresso anónimo exige confirmação. Desligar a sincronização não elimina dados anteriores; os controlos de remoção local e da conta são separados. As preferências tipográficas continuam locais. Dados antigos e cópias de recuperação também podem permanecer no dispositivo.",
            "Limpar o armazenamento pode eliminar esses dados. Terminar sessão não os apaga todos. Protege o acesso ao dispositivo e guarda com cuidado exportações que contenham textos privados.",
          ],
        },
        {
          title: "Segurança e controlos disponíveis",
          paragraphs: [
            "A aplicação distingue o acesso a dados privados e a conteúdos publicados, mas nenhum serviço pode prometer segurança absoluta. Podes editar o perfil, substituir ou remover a fotografia, gerir rascunhos e retirar publicações nos controlos disponíveis.",
            "Estas ações não equivalem a eliminar a conta nem todos os registos dos fornecedores. Não existe um mecanismo completo de eliminação de conta nesta interface.",
          ],
        },
        {
          title: "Pedidos sobre os teus dados",
          paragraphs: [
            "Envia pedidos de esclarecimento, acesso, correção ou eliminação para o contacto institucional, indicando o pedido e a conta a que se refere. Não envies passwords ou códigos de acesso. Pode ser necessário esclarecer a identidade e o âmbito do pedido antes de qualquer ação; este contacto não promete eliminação automática ou prazos não definidos.",
          ],
        },
      ]}
    />
  );
}
const questions = [
  {
    category: "Conta e perfil",
    title: "Como criar uma conta?",
    answer:
      "Abre Criar conta e preenche os dados pedidos. Segue as instruções apresentadas para concluir o registo e, quando solicitado, confirmar o email.",
    to: "/registar",
  },
  {
    category: "Conta e perfil",
    title: "Como iniciar sessão com Google?",
    answer:
      "Na página de entrada, escolhe Google e conclui a autorização no fornecedor. Se a operação falhar, verifica a mensagem apresentada e comunica o problema sem enviar credenciais.",
    to: "/entrar",
  },
  {
    category: "Conta e perfil",
    title: "Como atualizar o perfil?",
    answer:
      "Nas definições do perfil podes alterar o nome apresentado, a biografia e a fotografia. O perfil e a fotografia atual são públicos; evita informação confidencial.",
    to: "/perfil/editar",
  },
  {
    category: "Escrita e publicação",
    title: "Como publicar uma obra?",
    answer:
      "Cria a obra no Estúdio, preenche os metadados e guarda pelo menos uma entrada com conteúdo válido. Escolhe Publicar e confirma. A obra precisa de título, sinopse, formato, idioma e classificação etária válidos.",
    to: "/estudio",
  },
  {
    category: "Escrita e publicação",
    title: "Qual é a diferença entre rascunho e publicação?",
    answer:
      "O rascunho guardado é privado. Publicar cria uma versão para os leitores; alterações posteriores no rascunho só ficam públicas quando confirmas a atualização da publicação.",
    to: "/estudio",
  },
  {
    category: "Escrita e publicação",
    title: "Como editar ou retirar uma publicação?",
    answer:
      "Edita e guarda no Estúdio. Para mostrar as mudanças aos leitores, confirma a atualização pública. Para deixar de disponibilizar a obra, retira a publicação; o rascunho mantém-se e pode ser republicado.",
    to: "/estudio",
  },
  {
    category: "Leitura e comunidade",
    title: "Como funcionam as classificações?",
    answer:
      "A classificação etária e os avisos são indicados pelo autor e ajudam a escolher leituras. Os destaques gerais excluem conteúdo adulto e certas sinalizações; não são uma certificação de cada obra.",
    to: "/regras",
  },
  {
    category: "Leitura e comunidade",
    title: "Como retomar uma leitura?",
    answer:
      "Sem conta, a continuidade fica neste navegador. Quando a biblioteca avançada estiver disponível, podes ativar a sincronização privada nas definições da biblioteca para retomar noutro dispositivo. O progresso antigo deste dispositivo só é importado por confirmação explícita. Em conflitos, escolhe a posição da conta ou confirma o reenvio da posição local. Limpar armazenamento pode eliminar posições ainda não sincronizadas; exporta uma cópia antes.",
    to: "/catalogo",
  },
  {
    category: "Contacto",
    title: "Como comunicar um problema técnico ou de conteúdo?",
    answer:
      "Escreve para o email institucional com a ligação da página, uma descrição e, para erros técnicos, os passos que levaram ao problema. Não envies passwords. O formulário de denúncia não transmite pedidos.",
    to: "/contacto",
  },
  {
    category: "Contacto",
    title: "Como contactar a plataforma ou fazer um pedido de privacidade?",
    answer:
      "Escolhe o assunto na página de contacto ou escreve para arquivoglobal.org@gmail.com. Inclui apenas a informação necessária para compreender o pedido.",
    to: "/contacto",
  },
];
export function HelpPage() {
  const [query, setQuery] = useState("");
  const items = questions.filter((q) =>
    filterText(`${q.category} ${q.title} ${q.answer}`, query),
  );
  return (
    <CompletionPage
      eyebrow="ESTAMOS AQUI PARA AJUDAR"
      title="Central de Ajuda"
      description="Respostas simples para começares a ler, criar e partilhar."
    >
      <p>
        <Link to="/suporte">Enviar e acompanhar um pedido de suporte</Link> ·{" "}
        <Link to="/denunciar">Denunciar conteúdo</Link> ·{" "}
        <Link to="/transparencia">Consultar avisos publicados</Link>
      </p>
      <InstitutionalNav />
      <div className="completion-quick-links">
        {[
          [BookOpen, "Ler e descobrir", "/catalogo"],
          [PenLine, "Criar e publicar", "/estudio"],
          [Shield, "Dados e privacidade", "/privacidade"],
        ].map(([Icon, title, to]) => {
          const Symbol = Icon as typeof BookOpen;
          return (
            <Link className="completion-card" key={String(to)} to={String(to)}>
              <Symbol size={24} aria-hidden="true" />
              <h2>{String(title)}</h2>
              <span>Explorar →</span>
            </Link>
          );
        })}
      </div>
      <SearchField
        label="Pesquisar na ajuda"
        placeholder="Conta, publicação, privacidade…"
        value={query}
        onChange={setQuery}
      />
      <p role="status" className="completion-footnote">
        {items.length} perguntas encontradas
      </p>
      {[...new Set(items.map((q) => q.category))].map((category) => (
        <section className="institutional-faq-group" key={category}>
          <h2>{category}</h2>
          <div className="completion-faq">
            {items
              .filter((q) => q.category === category)
              .map((q) => (
                <details key={q.title}>
                  <summary>{q.title}</summary>
                  <p>{q.answer}</p>
                  <Link className="text-link" to={q.to}>
                    Saber mais →
                  </Link>
                </details>
              ))}
          </div>
        </section>
      ))}
      {!items.length && (
        <div className="empty">
          <h2>Nenhuma resposta encontrada</h2>
          <p>Experimenta outro termo ou visita a página de contacto.</p>
          <Link to="/contacto">Contactar →</Link>
        </div>
      )}
    </CompletionPage>
  );
}
export function ContactPage() {
  const subjects = [
    "Dúvidas e sugestões",
    "Problemas técnicos",
    "Privacidade e dados pessoais",
    "Direitos de autor",
    "Denúncias de conteúdo",
    "Outros assuntos institucionais",
  ];
  return (
    <CompletionPage
      eyebrow="VAMOS CONVERSAR"
      title="Contacto Institucional"
      description="Uma dúvida, uma ideia ou algo que precisa da nossa atenção? Escreve-nos."
    >
      <InstitutionalNav />
      <div className="notice">
        <Mail aria-hidden="true" size={22} />
        <p>
          O nosso endereço oficial é{" "}
          <a className="text-link" href={contactHref("Contacto institucional")}>
            {institutionalEmail}
          </a>
          . Escolhe um assunto para abrir a tua aplicação de email.
        </p>
      </div>
      <div className="completion-quick-links">
        {subjects.map((subject) => (
          <a
            className="completion-card"
            key={subject}
            href={contactHref(subject)}
          >
            <h2>{subject}</h2>
            <span>Escrever email →</span>
          </a>
        ))}
      </div>
      <aside className="notice">
        <p>
          Para problemas técnicos, indica a página e os passos para reproduzir o
          erro. Para denúncias e direitos de autor, inclui a ligação do conteúdo
          e explica a situação. Não envies passwords, códigos de acesso ou dados
          sensíveis desnecessários. O formulário de denúncia da aplicação não
          envia pedidos; utiliza este email.
        </p>
      </aside>
    </CompletionPage>
  );
}

export function TermsPage() {
  return (
    <DocumentPage
      policySlug="termos"
      title="Termos de Utilização"
      description="Proposta de condições de utilização, sujeita a revisão e aprovação expressas."
      sections={[
        {
          title: "Âmbito da proposta",
          paragraphs: [
            "Esta minuta descreve a utilização da plataforma para criar, guardar e publicar obras e participar nas áreas públicas. A identificação jurídica do responsável, a elegibilidade, a jurisdição e outras condições aplicáveis precisam de revisão humana antes de aprovação. Não se presume um regime legal específico.",
          ],
        },
        {
          title: "Conta, conteúdos e interações",
          paragraphs: [
            "Protege o acesso à conta e utiliza os controlos do Estúdio para decidir o que publicar. Rascunhos e listas pessoais não se tornam públicos por uma interação social. Respeita a autoria e as regras comunitárias; esta minuta não concede uma licença adicional sobre obras de terceiros.",
          ],
        },
        {
          title: "Publicação, disponibilidade e revisão",
          paragraphs: [
            "A versão pública é a edição confirmada pelo autor, sujeita às decisões de moderação registadas. É possível retirar publicações e pedir suporte ou revisão de uma decisão. Não se promete disponibilidade ininterrupta, resultado de análise ou prazo de resposta. As informações definitivas dependem de autorização institucional e revisão jurídica.",
          ],
        },
      ]}
    />
  );
}
export function CopyrightPage() {
  return (
    <DocumentPage
      policySlug="direitos-autor"
      title="Direitos de Autor"
      description="Comunicar alegações de autoria e pedidos relacionados com conteúdos."
      sections={[
        {
          title: "Como apresentar um pedido",
          paragraphs: [
            "Usa o suporte na categoria Direitos de Autor ou a denúncia do conteúdo público. Identifica a ligação da obra, perfil ou comentário e descreve o material e a tua relação com a alegação. Fornece apenas os elementos necessários; não envies dados confidenciais indiscriminadamente.",
          ],
        },
        {
          title: "Análise administrativa",
          paragraphs: [
            "Os responsáveis podem analisar o conteúdo e os esclarecimentos fornecidos, classificar o pedido e registar uma decisão. As respostas ficam no processo privado e nas notificações das partes autorizadas. Este fluxo não é apresentado como um procedimento legal específico nem promete remoção automática ou um prazo.",
          ],
        },
        {
          title: "Contestação e limites",
          paragraphs: [
            "Uma pessoa afetada pode pedir revisão pelo suporte, associando o processo recebido. Esta minuta exige revisão jurídica, incluindo quais informações são adequadas e quais obrigações realmente se aplicam. Até essa revisão, não se anunciam requisitos legais, garantias ou prazos inventados.",
          ],
        },
      ]}
    />
  );
}
export function AppealsPage() {
  return (
    <DocumentPage
      policySlug="contestacao"
      title="Contestação de moderação"
      description="Pedir revisão de uma decisão administrativa através de um processo acompanhado."
      sections={[
        {
          title: "Apresentar uma contestação",
          paragraphs: [
            "Abre o suporte na categoria Contestação de moderação. Se recebeste uma decisão, utiliza a ligação da notificação para associar o processo. Explica os fundamentos da discordância e os esclarecimentos relevantes, sem incluir credenciais ou dados pessoais desnecessários.",
          ],
        },
        {
          title: "Acompanhamento e decisão",
          paragraphs: [
            "O suporte mostra o estado e permite trocar mensagens com a administração. A associação a um processo só é aceite para as partes autorizadas. Decisões de restrição e restauro são registadas; uma restrição administrativa de publicação não pode ser contornada por uma nova publicação do autor.",
          ],
        },
        {
          title: "Revisão humana necessária",
          paragraphs: [
            "Este é um procedimento operacional proposto, não a declaração de um direito, garantia de resultado ou prazo legal específico. A política definitiva de contestação precisa de aprovação institucional e revisão jurídica antes de ser apresentada como aprovada.",
          ],
        },
      ]}
    />
  );
}
