# F5.2 — Centro Administrativo, Institucional e de Comunicação

Entrega local única. Não foi criada uma nova fase social, conta administrativa, segredo, Worker ou bucket. Não houve commit, push, deploy ou SQL remoto.

## Âmbito entregue

- `/admin`: dashboard agregado, denúncias novas/antigas, suporte, campanhas, avisos, atualizações, estado manual, documentos, comunicados e auditoria.
- `/denunciar`: obras, perfis e comentários públicos, com autenticação, classificação e acompanhamento. As denúncias detalhadas de comentários reutilizam `social_reports`; o texto completo fica reservado ao centro. O serviço anterior de moderação de comentários mantém as suas permissões existentes e o resumo anterior.
- `/suporte`: pedidos privados, conversas, estados e revisão de processos; `/notificacoes`: leitura persistente, comunicados opcionais e mensagens de serviço relacionadas com pedidos/decisões.
- `/campanhas` e `/transparencia`: apenas conteúdo efetivamente publicado e dentro do período; vazio real, erros e paginação. Nenhum indicador de saúde é inferido automaticamente.
- `/termos`, `/direitos-autor` e `/contestacao`; melhoria de Regras, Privacidade e Ajuda em `Information.tsx`. Textos sem versão aprovada são **minutas explícitas**, não políticas apresentadas como aprovadas. Versões administrativas publicadas substituem a minuta apenas depois da confirmação de revisão/autorização.
- Rodapé real atualizado sem ligação a `/admin`. Novas rotas institucionais não são acrescentadas automaticamente ao sitemap como documentos aprovados.

## Acesso administrativo

A inspeção remota de leitura confirmou os perfis públicos na configuração local:

| Referência pública | UUID                                   |
| ------------------ | -------------------------------------- |
| `arquivo_global`   | `782ff4bd-e05b-4e5d-93fe-821633e6711e` |
| `prince_kaio008`   | `4637443e-fc34-40da-b236-343d8cf9d22a` |

A leitura de `social_moderators` devolveu **401**: a exclusividade dessa lista não foi confirmada. Não foi considerada uma lista administrativa exclusiva. A nova `center_administrators` tem duas posições possíveis, UUID único, nenhum membro inicial e nenhuma escrita concedida ao navegador. Um terceiro moderador ou alguém com o mesmo username não recebe acesso.

Cada autorização exige: UUID em posição ativa, duas posições configuradas, associação atual a `social_moderators` e `session_id` do JWT correspondente a uma sessão desse utilizador em `auth.sessions`. Usernames só servem para conferência humana, nunca para autorização. As funções leem Auth; não alteram utilizadores, sessões, OAuth ou privilégios de Auth. A verificação adicional de sessão segue a [orientação Supabase para ações sensíveis](https://supabase.com/docs/guides/auth/sessions).

- `read_admin_bootstrap()` e `admin_console()` voltam a validar a autorização no PostgreSQL, mesmo quando chamados diretamente.
- `server/admin.ts` confirma a identidade em `/auth/v1/user`, compara o UUID com a autorização e protege `/api/admin`. Anónimos/não autorizados recebem **404**, inclusive quando não é possível confirmar autorização por falha do fornecedor.
- Na Vercel, `/admin` passa primeiro pela função; a SPA não é o controlo de segurança. O shell HTML só é servido depois da autorização. `dist/index.html` é incluído na função através de `includeFiles`, conforme a [configuração Vercel](https://vercel.com/docs/project-configuration/vercel-json).
- `AdminSessionBridge` estabelece, apenas para administradores aprovados, um cookie HttpOnly/Secure/SameSite=Strict com o access token existente, limitado a cinco minutos e à validade do JWT. Não cria credenciais nem copia refresh tokens. A API de operações exige Bearer; o cookie só abre o shell.
- Para acesso direto depois de o cookie expirar/primeira utilização, visitar uma página pública com sessão iniciada permite restabelecer a sessão administrativa; uma página administrativa aberta renova o cookie periodicamente enquanto visível. Cookies bloqueados ou configuração incompleta mantêm acesso fechado.
- POST/DELETE exigem Origin igual, corpo limitado, ausência de cache e erros sanitizados. Não é usado `service_role`. Revogação de sessão/lista/membership bloqueia os pedidos seguintes; não existe cache de autorização entre pedidos.

## Dados, integridade e limites

Migration consolidada: `supabase/migrations/20261115040000_administrative_center.sql`. Novas tabelas `center_*`, uma vista privada de denúncias e colunas adicionais em `social_reports`; nenhuma migration anterior foi modificada. Há verificações de pré-requisitos e privilégios de leitura do instalador antes da criação dos objetos. Aplicação transacional, sem apagar dados existentes.

Todas as novas tabelas têm RLS e privilégios diretos revogados de PUBLIC/anon/authenticated, mesmo com defaults permissivos. A vista também é privada. Helpers e triggers não têm EXECUTE público. RPCs `SECURITY DEFINER` usam `search_path=''`, nomes qualificados, projeções e autorização por ator. As operações recebem UUID/fingerprint com namespace de membro/administrador e retornam o resultado original ao repetir; chaves reutilizadas com outro payload são recusadas.

- Dashboard: utilizadores e cadastros, obras/publicações, visualizações consentidas, leituras, interações e processos. Apenas agregados; não há emails, passwords, sessões, identidades de leitores ou textos de rascunhos no dashboard.
- Suporte: proprietário/administração apenas; cinco novos pedidos por conta/24 horas, respostas limitadas por frequência, mensagens até 8 000 caracteres e paginação por cursor.
- Denúncias: uma por utilizador/alvo para obras/perfis e a unicidade existente por comentário; duplicados reutilizam o processo. Descrição até 4 000 caracteres; limites de frequência de membros e os limites anteriores de comentários permanecem ativos.
- Decisões: motivo obrigatório, controlo de revisão/estado, bloqueio de linha e auditoria. Restrição de obra desativa o snapshot público e uma trigger impede republicar para contornar a decisão. Restauro só disponibiliza o snapshot anterior se a obra continuar publicada e não arquivada; nunca copia edições privadas. Perfis não são eliminados nem contas Auth sancionadas nesta entrega: decisões possíveis incluem advertência/sem ação e acompanhamento.
- As partes autorizadas recebem motivo/ação e podem abrir suporte de contestação associado ao processo; outras contas não leem esses dados. Pedidos não exigem promessa de prazo ou resultado jurídico.
- Comunicados: preparação e confirmação separadas, apenas contas com preferência ativa, destinatários selecionados ou optantes anteriores à criação. Entrega em lotes de 100, chave única por comunicado/destinatário e bloqueio de reenvio concluído. Preferência de comunicados é desligada por defeito; respostas de suporte e decisões são mensagens de serviço solicitadas pelo contexto. Não há email, push móvel, fanout social ou notificações de F5.4 implementados.
- Limites gerais: 60 operações de membro/minuto; 120 de administrador/minuto; até dez novos comunicados/hora por administrador. Registos, destinatários e mensagens são paginados. Os limites não equivalem a proteção completa contra contas falsas/bots.
- Campanhas/documentos: revisões otimistas, versões preservadas, retirada e agendamento. Avisos/estados/atualizações exigem confirmação de informação verificada. Políticas exigem confirmação explícita de revisão jurídica/autorização para a versão publicada; nada é semeado como aprovado.
- Imagem opcional reutiliza uma capa **atualmente pública**, com UUID da publicação/asset e declaração de autorização de reutilização. Usa o endpoint público existente de capas e oculta a imagem se a referência deixar de ser pública. Não existe upload institucional independente, cópia de ficheiros ou alargamento do acesso ao R2.
- Texto é apresentado escapado, sem HTML arbitrário. Anexos privados de suporte não são implementados. Preferências/progresso sociais antigos, Auth, editor, capas e publicação continuam nos serviços existentes.

## Instalação posterior — só com autorização

1. Confirmar projeto Supabase `dlwsjfqijrsmwejsmuts`, migrations F5.1 instaladas, presença de `auth.sessions`/`auth.jwt()` e acesso de leitura do instalador a Auth. Não reaplicar migrations anteriores. Conferência administrativa exclusivamente de leitura:

   ```sql
   SELECT count(*) AS membros FROM public.social_moderators;
   SELECT m.user_id, p.username FROM public.social_moderators m
   LEFT JOIN public.profiles p ON p.id=m.user_id ORDER BY m.user_id;
   SELECT has_table_privilege(current_user,'auth.users','SELECT') AS users_read,
          has_table_privilege(current_user,'auth.sessions','SELECT') AS sessions_read;
   ```

2. Rever e aplicar a migration completa uma vez. Se houver erro, executar ROLLBACK antes de investigar; não usar reset, DROP ou reparações automáticas. A lista administrativa ficará vazia e `/admin` fechado.
3. Após confirmar os dois UUIDs com o proprietário e a sua presença em `social_moderators`, configurar a lista dedicada **se estiver vazia**. Se houver configuração parcial/diferente, parar e rever, sem a sobrescrever:

   ```sql
   BEGIN;
   DO $$ BEGIN
     IF (SELECT count(*) FROM public.social_moderators WHERE user_id IN (
       '782ff4bd-e05b-4e5d-93fe-821633e6711e'::uuid,
       '4637443e-fc34-40da-b236-343d8cf9d22a'::uuid)) <> 2
     THEN RAISE EXCEPTION 'Rever os UUIDs e as permissões existentes'; END IF;
     IF EXISTS (SELECT 1 FROM public.center_administrators)
     THEN RAISE EXCEPTION 'Lista já configurada: rever sem sobrescrever'; END IF;
   END $$;
   INSERT INTO public.center_administrators(slot,user_id) VALUES
     (1,'782ff4bd-e05b-4e5d-93fe-821633e6711e'),
     (2,'4637443e-fc34-40da-b236-343d8cf9d22a');
   COMMIT;
   ```

   Não se escolhem membros por username nem se concede acesso a todos os moderadores. A gestão posterior de membros é exclusivamente do proprietário no banco, com revisão e auditoria.

4. Validar RLS/ACL, ausência de EXECUTE PUBLIC nos helpers, proteção de publicações e leitura de sessão. Não conceder leitura pública a tabelas pessoais para contornar erros. As funções administrativas de leitura também precisam de JWT de utilizador e sessão ativa.
5. Quando autorizado a publicar, usar as variáveis públicas Supabase existentes na Vercel; não há segredo novo. Verificar os rewrites e `includeFiles` de `api/admin.ts`. Não alterar flags de capas, editor, leitor ou sistema social. O Vite puro não executa funções `api/`: os testes locais usam o handler diretamente e transporte isolado; HTTP 404 real depende do runtime administrativo configurado.
6. Validar os dois administradores e uma terceira conta/anónimo em `/admin` e `/api/admin`; login, refresh e logout; sessões revogadas; suporte entre contas; denúncia/revisão; comunicado por lote; privacidade da inbox; campanha futura/expirada/imagem retirada; política em rascunho e aprovação manual. Não usar obras reais para ensaios destrutivos.

Revogação operacional: desativar a posição administrativa após autorização, sem apagar histórico. Não remover a trigger de restrição enquanto existirem restrições ativas, nem apagar tabelas/ficheiros como reversão. Rever separadamente qualquer rollback de deployment.

## Validação e limitações reais

- `scripts/center.test.tsx`: servidor HTTP, origem/cookie/limite de corpo, identidade/grant, erro 404 antes de autorização, navegação sem link público, minutas, transporte e idempotência.
- `scripts/validate-center.mjs`: SQL/PGlite local, defaults hostis, duas posições por UUID/sessão, terceiro moderador com username correspondente recusado, suporte privado, decisões/revisões, restrições, snapshots, denúncias detalhadas, comunicados com mais de 100 destinatários e replay, RLS/privilégios/auditoria, agendamento e aprovação explícita.
- `scripts/center.browser.html`: fluxos reais de componentes com transportes simulados, erros/preservação, confirmação de decisões, pré-visualização sem gravar, notificações, XSS e layouts claro/escuro a 360/1280 px. Não é certificação completa de acessibilidade.
- Não houve teste administrativo autenticado remoto nem inspeção da lista privada. Os UUIDs de perfil e a recusa 401 foram as únicas verificações remotas desta tarefa.
- Instalação, provisionamento dos UUIDs, empacotamento/HTTP Vercel e ensaios com contas reais continuam pendentes de autorização. Textos jurídicos, responsável legal/jurisdição, retenção e procedimentos definitivos exigem revisão humana. Não há prazo legal, sanção automática, garantia de uptime ou política automaticamente aprovada.
- Audiências grandes são enviadas por lotes; existem índices para acesso e contagens, mas o desempenho dos agregados e a retenção de auditoria/pedidos precisam de acompanhamento em volumes reais. Nenhum cron de eliminação ou monitorização externa foi instalado.

Resultados desta entrega: `npm test` **387/387 aprovados**; suite SQL local **aprovada**; **14/14 cenários de navegador aprovados** com transporte simulado; `npm run typecheck`, `npm run build` e `git diff --check` aprovados. Estes resultados não comprovam a instalação nem o comportamento remoto.
