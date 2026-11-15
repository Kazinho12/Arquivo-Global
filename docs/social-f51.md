# F5.1 — Sistema social integrado (instalação local)

## Implementação

- Curtidas de obras, capítulos/episódios e comentários; contagens derivadas de relações únicas e estados do utilizador. Seguir obras e escritores reutiliza `profile_follows` de F4.1; auto-seguimento de escritor é proibido.
- Comentários/respostas (um nível), edição e remoção pelo comentador, paginação por cursor `(created_at,id)`, denúncias e ocultação/restauro por moderadores. Textos são apresentados como texto, sem HTML executável. A remoção mantém respostas e apaga o corpo; ocultação mantém o corpo apenas para revisão administrativa.
- Biblioteca da conta: guardar, favoritar e ler depois são estados **independentes**, privados; obras seguidas também podem ser geridas ali. Remover referências pessoais ou deixar de seguir continua possível após retirada. Publicações indisponíveis não devolvem títulos/conteúdo através da biblioteca.
- A biblioteca e progresso locais existentes são preservados em separado. Não há importação automática nem sincronização do histórico/progresso, notificações ou funcionalidades de F5.2/F5.3.
- `SocialPanel` integra os detalhes, leitores textuais/poesia e leitor visual; `AuthorFollow` integra perfis; `SocialLibrary` integra `/biblioteca`. UI respeita os tokens de tema existentes, bloqueia pedidos em curso e recupera de falhas. Confirmação de escrita não é anulada por uma falha posterior ao atualizar contagens.

## Modelo e segurança

Migration completa: `supabase/migrations/20261115020000_social_integrated.sql`. Requer F4.1 e F4.2-C instaladas. Não substitui Auth, publicação, snapshots, regras de media, RLS anterior ou a relação de seguidores.

Novas tabelas: `social_likes`, `social_work_follows`, `social_library`, `social_comments`, `social_comment_likes`, `social_reports`, `social_moderators`, `social_moderation_log`, `social_operations`, `social_statistics`, `social_metric_settings`, `social_metric_visitors` e `social_metric_networks`.

Todas têm RLS e privilégios diretos revogados de PUBLIC/anon/authenticated, incluindo sob defaults permissivos. Políticas de leitura por proprietário existem nas relações pessoais como defesa adicional; o transporte permanece RPC. As funções `SECURITY DEFINER` têm `search_path=''`, nomes qualificados e concessões explícitas. Funções auxiliares e limpeza não têm EXECUTE público.

- `read_social_state`, `read_social_comments`, `read_author_follow`: agregados e projeções públicas; estado individual apenas de `auth.uid()`.
- `mutate_social`: exige autenticação, verifica alvo publicado e capítulo da obra, serializa por ator e usa UUID/fingerprint de operação. Curtidas/seguimento usam **estado pretendido**, nunca incremento fornecido pelo cliente.
- `read_social_library`, `remove_social_library`, `set_author_follow`: operações pessoais autenticadas, sem parâmetro de proprietário controlável pelo cliente.
- `read_social_reports`: apenas membros de `social_moderators`; a inserção nessa tabela é administrativa, sem mecanismo de autoatribuição. Moderação deixa registo em `social_moderation_log`.
- Máximo de 120 operações por minuto/conta; comentários: 4 000 caracteres, intervalo mínimo de 10 segundos e 30/hora; edições: 5 segundos; denúncias: 10/hora e 500 caracteres. Repetir um UUID confirmado não consome outra operação. Não substitui mecanismos especializados de deteção de abuso.

Os UUIDs de capítulo são referências públicas históricas, **sem FK com eliminação em cascata para `published_work_entries`**: a F4 recria essas linhas ao atualizar snapshots. Curtidas, comentários e métricas sobrevivem a atualizações/republicações com o mesmo ID. Cada leitura/escrita pública confirma que o capítulo ainda existe na obra pública atual; capítulos removidos ficam inacessíveis. Eliminar definitivamente uma publicação elimina as relações associadas. Retirar publicação preserva-as e bloqueia novas leituras/interações públicas (a remoção de dados próprios continua possível).

## Métricas e privacidade

`api/social-metrics.ts` usa `server/social-metrics.ts`, não o Worker/R2. O endpoint aceita apenas pedidos da mesma origem e só confia no endereço fornecido pela infraestrutura Vercel. Referência do cabeçalho: [documentação Vercel](https://vercel.com/docs/headers/request-headers). Instalações com proxies adicionais exigem verificar esse contrato; o endpoint recusa ambientes sem origem de rede validável.

- Contagem **opcional**, desligada até o leitor permitir no controlo local. Um cookie assinado `__Host-ag_reader`, Secure/HttpOnly/SameSite=Lax, dura 30 dias; desativar interrompe envios e pede a sua remoção. Preferência fica local e não é associada à conta.
- A publicação só envia um evento após interação real e 8 segundos visíveis; capítulos exigem 20 segundos. Conteúdo pré-carregado, eventos sintéticos e tempo em segundo plano não iniciam contagens. Não é prova de conclusão da leitura.
- Servidor deriva HMACs, diferentes por alvo, sem guardar IP, token de sessão ou cookie em claro no PostgreSQL. A referência de rede roda diariamente. Agregados públicos não devolvem identidades, hashes ou histórico individual.
- `record_social_view` exige prova servidor e verifica novamente o alvo público. Chave pública Supabase usada apenas como anon; a prova não é variável VITE nem chega ao navegador. Nenhuma escrita direta em contadores é permitida.
- Um identificador/alvo conta no máximo uma vez por 24 horas. `views` representa visitas qualificadas deduplicadas por janela, não cada atualização; `visitors` estima identificadores distintos, **não pessoas únicas**. Expiração/limpeza de cookies, redes partilhadas e bloqueadores podem afetar resultados.
- Limite padrão de 240 eventos qualificados por rede/dia. Há limites no corpo e timeout; não existe promessa de resistência total a bots/VPNs nem de métricas auditadas. Rever limites/firewall na operação real. Falhas não incrementam artificialmente a UI.
- `prune_social_metric_identifiers()` é exclusivamente administrativo: elimina identificadores sem atividade há 45 dias e limites de rede com mais de sete dias, mantendo agregados. Agendar somente após autorização; não há cron instalado. Recibos idempotentes e logs de moderação permanecem até manutenção/política de retenção definida pelo responsável ou eliminação da conta/publicação, conforme FKs.

## Instalação manual posterior — requer autorização

1. Confirmar projeto `dlwsjfqijrsmwejsmuts`, histórico e objetos de F4.1/F4.2-C. Manter `VITE_ENABLE_SOCIAL=false`; não alterar flags de capas/editor/leitor visual.
2. Rever e executar **uma única vez**, como transação completa, `20261115020000_social_integrated.sql` no SQL Editor. Se falhar, executar ROLLBACK e investigar; não reaplicar migrations anteriores nem usar reset.
3. Validar RLS, ACL e funções. Consultas administrativas somente de leitura:

   ```sql
   SELECT tablename, rowsecurity FROM pg_tables
   WHERE schemaname='public' AND tablename LIKE 'social_%';
   SELECT routine_name, grantee, privilege_type FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND (routine_name LIKE '%social%' OR routine_name IN ('read_author_follow','set_author_follow'));
   SELECT id, token_hash IS NOT NULL AS metrics_configured, network_daily_limit
   FROM public.social_metric_settings;
   ```

4. Gerar um segredo aleatório de pelo menos 32 bytes num gestor seguro. Configurar **apenas em Vercel server** como `SOCIAL_METRICS_SECRET`. No Supabase, como administrador, guardar apenas o SHA-256 hexadecimal (não o segredo):

   ```sql
   UPDATE public.social_metric_settings
   SET token_hash = '<SHA256_HEXADECIMAL_REVISTO>' WHERE id=true;
   ```

   O servidor reutiliza `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` existentes ou `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`. Não usar service_role. Se as métricas não forem configuradas, as outras interações continuam disponíveis; a contagem apresenta indisponibilidade quando solicitada.

5. Designar manualmente uma conta de moderação já existente, com UUID revisto e autorização do responsável (não criar contas automaticamente):

   ```sql
   INSERT INTO public.social_moderators(user_id)
   VALUES ('<UUID_DA_CONTA_AUTORIZADA>') ON CONFLICT DO NOTHING;
   ```

   A fila «Denúncias pendentes» aparece nos painéis sociais apenas para essa conta. Não existe sanção automática, email de denúncias ou procedimento de recurso novo.

O `npm run dev` de Vite não executa as funções de `api/`: as métricas exigem um runtime local Vercel devidamente configurado ou um ambiente de teste autorizado. Os testes fornecidos usam o handler servidor diretamente e transportes simulados, sem instalar ferramentas.

6. Em ambiente de teste autorizado, construir com `VITE_ENABLE_SOCIAL=true` e testar duas contas/anónimo, todos os formatos, biblioteca privada, denúncia/moderação, concorrência, retirada e republicação. Validar POST/DELETE `/api/social-metrics`, cookie, deduplicação, quotas e prova inválida; não usar obras reais para ensaios destrutivos.
7. Ativação/deploy de produção requer autorização separada. Reversão de UI: desligar apenas `VITE_ENABLE_SOCIAL`, preservando dados. Para suspender métricas, limpar administrativamente `token_hash` após autorização; não apagar tabelas, snapshots ou dados de utilizadores.

## Testes e pendências

- `scripts/social.test.tsx`: contratos, ausência de sessão, conta trocada, repetição após perda de resposta, erros, feature flag, cookie assinado, prova servidor, identificadores separados por alvo, origens, limites e falhas de rede.
- `scripts/validate-social.mjs`: PostgreSQL local/PGlite com defaults permissivos, RLS/ACL, contas A/B/anónimo/moderador, unicidade e idempotência, biblioteca privada, comentários/respostas/moderação, paginação, métricas/deduplicação/limites e retirada/republicação, formatos e snapshots anteriores.
- `scripts/social.browser.html`: interações reais de componentes com transporte simulado; otimismo/rollback, duplo clique, comentários, cancelamento/eliminação, confirmação perdida apenas na atualização, seguidores, biblioteca, XSS, métricas sem pré-carga e layouts/temas.

Nenhuma migration, segredo, flag, conta, Worker ou dado remoto foi alterado. SQL local não reproduz um PostgreSQL remoto com sessões simultâneas independentes; concorrência real, configuração Vercel, integração Supabase, revisão de retenção/privacidade e ensaios de produção permanecem pendentes. F5.2/F5.3 não foram iniciadas.

## Resultado local desta entrega

- `npm test`: **363 testes aprovados**, sem falhas; após os últimos reforços, os sete testes direcionados sociais também passaram.
- Navegador social: **15/15 cenários aprovados**, com transportes simulados, incluindo interação de teclado real para o teste de métricas e layouts de 360/1280 px nos dois temas.
- SQL local: `validate-social.mjs` e regressão `validate-public-visual.mjs` aprovados. O ensaio social inclui manga RTL, atualização para webtoon vertical e preservação de comentários/curtidas ao recriar snapshots.
- Typecheck, build de produção, formatação dos ficheiros desta tarefa e `git diff --check` aprovados. Não houve instalação de dependências, commit, push, deploy nem execução remota.
