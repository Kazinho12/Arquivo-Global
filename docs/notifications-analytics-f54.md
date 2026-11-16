# F5.4 — Notificações sociais e estatísticas avançadas

Entrega técnica local da última etapa da Fase 5. Não significa que as migrations, flags, contas administrativas, sincronização ou agendamentos estejam validados em produção. Nenhum SQL remoto, segredo, Worker ou deploy manual foi alterado nesta execução.

## Arquitetura e compatibilidade

A migration consolidada `20261116000000_notifications_analytics.sql` exige F5.1–F5.3. Acrescenta tabelas privadas, funções e triggers, preservando assinaturas das RPCs existentes. A caixa de entrada continua a ser **`center_notifications`**, com os avisos `official` e `service` da F5.2 e o novo tipo `social`. Não há email, push externo, sons, feed ou nova integração R2.

A flag `VITE_ENABLE_NOTIFICATIONS_ANALYTICS=false` é o padrão seguro. Enquanto desligada, `/notificacoes` e `/estudio/estatisticas` mantêm as interfaces anteriores; o cabeçalho não consulta a nova RPC. Nenhuma variável real foi modificada. O backend instala `events_enabled=false` e `delivery_enabled=false`. Os agregados diários começam na instalação (`stats_since`), não no passado.

## Eventos, entrega e proteção contra excesso

- Triggers observam inserções reais em `profile_follows`, `social_work_follows`, `social_likes`, `social_comments` e `social_comment_likes`. Não existe RPC de navegador para criar eventos. As funções internas têm EXECUTE revogado de PUBLIC/anon/authenticated.
- Publicações usam trigger adiada ao fim da transação e um manifesto dos snapshots públicos: IDs/conteúdo/títulos/ordem de entradas e sequência de assets visuais, mais metadados editoriais relevantes. O manifesto inicial é uma referência atual, sem notificações retroativas. Texto literário não é copiado para a outbox.
- Nova publicação, novas entradas e atualização editorial pública são distinguidas. Rascunhos não emitem eventos; capa/variação técnica isolada não emite atualização; retirar e republicar sem alterações não vira nova obra. Mudanças públicas reais na republicação são atualizações, não uma primeira publicação.
- Autor da obra recebe seguidores/curtidas/comentários; dono do comentário recebe respostas e marcos de curtidas (1, 5, 10, 25, 50, 100). Se autor e dono do comentário coincidirem, é entregue só o aviso de resposta. Interações próprias nunca são notificadas.
- Escritores/obras seguidos usam audiência por UUID com preferências e relações existentes na data do evento. Interesses sobrepostos são unidos por destinatário. Remover seguimento antes do processamento elimina a elegibilidade correspondente.
- Preferências sociais começam desligadas e são privadas, com revisão. Ativá-las não importa eventos antigos. Comunicados opcionais usam a preferência F5.2 existente; mensagens de serviço permanecem independentes.
- Chaves únicas impedem repetição do mesmo evento. Seguir/retirar/seguir e curtir/retirar/curtir o mesmo alvo não geram novas notificações repetitivas enquanto a chave estiver retida. Cada produtor tem limite de 60 eventos/minuto; a interação real continua válida quando um aviso excedente é suprimido.
- Outbox transacional, cursor por UUID, até 100 destinatários por chamada, até 10 eventos e `FOR UPDATE SKIP LOCKED`. A operação continua no lote seguinte. Recibos únicos destinatário/evento e locks nas preferências do destinatário serializam quota, consentimento e digest entre trabalhadores.
- Falhas revertem o lote desse evento; SQLSTATE sanitizado, backoff 1/2/4/8/16 minutos, máximo 5 tentativas e estado `failed`. Diagnóstico administrativo permite reativar um lote falhado, com auditoria e limite por administrador. Cancelamento/timeout transacional não confirma entregas parciais.
- Agrupamento por categoria/alvo/dia do evento; no máximo 20 novos grupos sociais entregues por conta/dia UTC. O contador de grupo indica **eventos agrupados**, não um novo contador público de curtidas. Um grupo ocultado não reaparece nesse dia. Avisos oficiais e de serviço não são limitados por essa quota social.
- Publicação retirada, entrada removida ou comentário ocultado são revalidados antes da entrega e ao resolver a ligação contextual. O aviso pessoal pode permanecer como referência indisponível, sem oferecer conteúdo privado.

## Processamento periódico — preparado, não instalado

`api/notification-jobs.ts` aceita somente POST com Bearer do **`SOCIAL_METRICS_SECRET` existente**, exclusivamente no servidor. Usa o URL e a chave pública Supabase existentes e a prova já validada por `social_metric_settings.token_hash`. Não requer service_role nem um segredo novo. O endpoint devolve apenas enabled/processed/delivered; falhas não devolvem a prova nem mensagens SQL. Não executar o script sem autorização de operação remota.

O mecanismo de invocação é `scripts/process-notifications.mjs`. Num executor de confiança já autorizado, disponibilizar `AG_SITE_URL=https://arquivoglobal.vercel.app` e o segredo existente pelo gestor de ambiente desse executor, nunca em argumentos ou ficheiros do repositório. Executar:

```sh
node /caminho/do/checkout/scripts/process-notifications.mjs
```

Configurar esse comando, com variáveis herdadas e monitorização de exit code, para correr por exemplo a cada cinco minutos (`*/5 * * * *`). **Nenhum scheduler foi instalado ou declarado ativo**; `vercel.json` só adiciona a função, sem crons. A configuração externa depende de acesso autorizado ao executor. Uma chamada processa no máximo 100 entregas; uma fila grande exige chamadas sucessivas/maior frequência conservadora, acompanhadas pelo diagnóstico. Não usar um browser nem colocar a prova no frontend para drenar a fila.

Retenção: o trabalhador elimina em lotes até 100 eventos `done` com mais de 90 dias e respetivos recibos, e até 100 recibos de comandos pessoais com mais de 90 dias. Eventos falhados não são apagados automaticamente. Depois da retenção, uma nova interação futura pode voltar a gerar um evento para o mesmo par. A caixa de entrada pessoal não é purgada pelo trabalhador: ocultar é uma ação pessoal, não uma promessa de eliminação física. Agregados diários persistem enquanto a publicação/conta existir; qualquer política adicional de retenção requer decisão própria, sem inventar aprovação jurídica.

## Estatísticas e privacidade

- Totais acumulados vêm das tabelas F5.1: visualizações qualificadas de obras, leituras qualificadas de entradas, curtidas de obras/entradas separadas, comentários visíveis de obra/entradas, favoritos e seguidores de obras e escritor. Os painéis públicos existentes continuam a ser a mesma fonte; não foram acrescentados contadores públicos concorrentes.
- `/estudio/estatisticas` compara as publicações do próprio autor, incluindo retiradas identificadas. Filtra uma obra, pagina obras/entradas e apresenta entradas ordenadas por leituras, gráfico SVG e tabela acessível.
- Agregados por dia UTC capturam apenas deltas reais posteriores à instalação. Totais antigos não são distribuídos artificialmente por datas. Períodos 7/30/90 dias são identificados como parciais quando necessário; não se inventam percentagens. Crescimento de seguidores significa variação líquida observada, não uma série histórica pré-existente.
- Não se lê `reading_progress`, `reading_history`, listas, posições ou identidades pseudónimas. Não se associam os JWTs de leitores aos hashes de métricas. Os leitores anónimos e a opção privada F5.3 continuam independentes das métricas consentidas F5.1.
- Novas tabelas e vista analítica não têm leitura direta para anon/authenticated/PUBLIC. RLS ativo nas tabelas; RPCs SECURITY DEFINER com search_path vazio, nomes qualificados e owner derivado de auth.uid(). Autor não pode escolher outro proprietário nem pedir métricas privadas de outra publicação.
- `/admin` preserva as duas contas/validação F5.2. O novo diagnóstico mostra volumes, idade da fila, tentativas e códigos técnicos, sem texto de avisos, atores, destinatários ou inboxes.
- Central com filtros, paginação, ler/ler todas/ocultar, preferências sincronizadas e atualização discreta a cada 45 segundos enquanto visível. O contador do cabeçalho usa contagem indexada de não lidas, não descarrega o histórico. A troca de conta limpa o estado anterior.

## Instalação posterior e validação real

1. Confirmar projeto `dlwsjfqijrsmwejsmuts`, migrations anteriores e estado atual, exclusivamente por leitura:

   ```sql
   SELECT to_regclass('public.center_notifications'),to_regclass('public.social_statistics'),
          to_regclass('public.reading_settings'),to_regclass('public.profile_follows'),
          to_regprocedure('public.center_is_admin()'),
          to_regprocedure('public.notification_member(text,jsonb,uuid)');
   SELECT conname FROM pg_constraint WHERE conrelid='public.center_notifications'::regclass;
   ```

   Se os objetos anteriores faltarem, instalar/validar as fases anteriores primeiro. Se a nova RPC já existir, comparar histórico/versão antes de qualquer reaplicação. A migration espera a constraint original `center_notifications_kind_check` e verifica dependências; execução é transacional.

2. Após autorização, aplicar **uma vez** o SQL completo. Confirmar RLS, grants, helpers sem EXECUTE público e ausência de membros/segredos alterados:

   ```sql
   SELECT tablename,policyname,roles FROM pg_policies WHERE schemaname='public'
     AND tablename IN ('notification_preferences','notification_outbox','notification_receipts');
   SELECT has_table_privilege('anon','public.notification_outbox','SELECT') AS public_outbox,
          has_table_privilege('authenticated','public.center_notifications','SELECT') AS direct_inbox,
          has_function_privilege('anon','public.queue_social_event(text,text,uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE') AS invented_events;
   SELECT events_enabled,delivery_enabled,stats_since FROM public.notification_settings;
   ```

   Esperado: três privilégios false; flags backend false; stats_since real. Testar sessões por JWT no cliente, não simular permissões usando apenas o proprietário no SQL Editor.

3. Confirmar no ambiente de servidor que os nomes Supabase e o segredo de métricas existentes estão disponíveis e que o hash existente corresponde. Não apresentar valores em logs. Instalar o scheduler autorizado e testar primeiro uma chamada com entrega desligada (enabled=false).
4. Após autorização específica de ativação, executar:

   ```sql
   UPDATE public.notification_settings SET events_enabled=true,delivery_enabled=true WHERE id=true;
   ```

   Ativar `VITE_ENABLE_NOTIFICATIONS_ANALYTICS=true` num ambiente autorizado e reconstruir aí (flag Vite é de build). Não modificar flags F5.1/F5.3 nem preferências pessoais automaticamente. Contas de teste optam explicitamente nas categorias.

5. Validar duas contas reais e visitante: follow/unfollow, curtida/retirada, comentário/resposta, publicação nova, capítulo novo, alteração privada, atualização pública, retirada e republicação inalterada. Conferir uma entrega quando segue autor e obra; ausência de avisos próprios; limites, falhas/retry, preferências e contador/leitura/ocultação. Usar dados descartáveis e verificar isolamento; não remover obras reais de terceiros.
6. Conferir estatísticas com contadores F5.1, períodos parciais e ausência de dados pessoais; testar os leitores textuais/visuais, F5.2 e F5.3. Só depois considerar concluído o encerramento operacional remoto da Fase 5.

Reversão conservadora: desligar events_enabled/delivery_enabled e a flag frontend no pipeline autorizado; preservar outbox, inbox, agregados e migrations. Não apagar dados nem enfraquecer RLS para contornar erros. A captura agregada continua desde a instalação e não depende da entrega de notificações.

## Testes e limites da entrega

Scripts novos: `notifications-analytics.test.tsx`, `notifications-analytics.browser.html/.tsx`, `validate-notifications.mjs`. A suite SQL usa PostgreSQL local/PGlite, defaults hostis, fluxo real de publicação, contadores pré-existentes, 123 destinatários e falhas de entrega. O navegador usa componentes reais e transporte simulado, não contas Supabase remotas. Não é uma certificação completa de acessibilidade nem uma prova de scheduler/produção ativos.

Pendentes remotos: instalação, ativação, executor periódico, testes com contas reais, capacidade/latência sob audiência real e revisão das decisões de retenção. Não existe envio externo configurado ou monitorização operacional externa instalada por esta tarefa.

Validação desta entrega: **412/412 testes automatizados**, **17/17 cenários de navegador** e suites SQL F5.4, F5.3 e F5.2 aprovados; typecheck, build, formatação dos ficheiros afetados e `git diff --check` aprovados. O build emite um aviso não bloqueante para o chunk principal acima de 500 kB (cerca de 508 kB minificados); o limite não foi aumentado para ocultar o aviso. Medição com tráfego real e otimização adicional de chunks permanecem acompanhamento de desempenho, sem alterar o âmbito desta entrega.

Encerramento: implementação técnica local F5.1–F5.4 entregue. O encerramento operacional em produção exige completar os pré-requisitos e a validação real das fases anteriores e desta página; não foi presumida a instalação remota de nenhuma migration pendente.
