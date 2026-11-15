# F5.3 — Biblioteca e continuidade avançadas

Implementação local; nenhuma migration remota, alteração de segredo ou deploy manual foi executado. F5.4 não foi iniciada.

## Entrega e compatibilidade

- A biblioteca autenticada integra os relacionamentos reais F5.1 (`social_library` e `social_work_follows`), sem converter favoritos em estados pessoais nem duplicar essas tabelas. Mantém remoção de favoritos, guardados, ler depois e seguimentos.
- `/biblioteca`, favoritos, histórico e listas possuem consultas privadas, filtros, ordenação e paginação. Estados pessoais: a ler, concluída e quero ler. Cada lista tem revisão, nome, descrição, datas e até 200 referências únicas ordenadas; uma obra pode pertencer a várias listas. Limite de 100 listas por conta. Listas nunca são públicas.
- Os leitores reais de prosa, poesia e publicação visual reutilizam o registo existente, agora com posições separadas por capítulo. Há marcação manual de conclusão, preservada ao reabrir. A página da obra mostra indicadores e permite adicionar a listas.
- Prosa/poesia: bloco semântico e deslocamento relativo, com posição proporcional como alternativa. HQ/mangá: página/identificador público e direção; webtoon: página e deslocamento vertical aproximado. Uma nova edição invalida a posição exata e oferece o início do capítulo, preservando a conclusão. Entradas retiradas levam à obra ou a indisponível, nunca a conteúdo privado.
- As preferências tipográficas existentes continuam locais. A direção visual acompanha a posição sincronizada; não foi introduzido um novo sistema global de temas ou preferências.

### Ativação conservadora

`VITE_ENABLE_READING_SYNC=false` por defeito, também em `.env.example`. Enquanto desligada, o provider não cria um cliente/fluxo remoto de leitura e as cinco páginas preservam a biblioteca anterior, incluindo F5.1. O cache por capítulo continua a melhorar a continuidade local. Os ensaios locais exercitam diretamente o motor/componentes e o provider com ativação explícita de teste.

Isto permite fazer push sem depender de colunas/RPCs ainda não instaladas no projeto remoto. Não foi alterada nenhuma variável real da Vercel. O push pode desencadear o pipeline Git já existente; não equivale a validação remota nem a ativação da funcionalidade.

## Privacidade e segurança

Migration consolidada: `supabase/migrations/20261115050000_reading_library.sql`.

- Tabelas: `reading_settings`, `reading_works`, `reading_progress`, `reading_history`, `reading_lists`, `reading_list_items` e `reading_operations`.
- Todas têm RLS; acesso direto é revogado de PUBLIC/anon/authenticated. A única entrada concedida é `reading_library(text,jsonb,uuid)` para `authenticated`. A função usa `auth.uid()`, `SECURITY DEFINER`, search_path vazio, nomes qualificados, projeções explícitas e bloqueio por conta. Nenhum proprietário é escolhido por payload. Não existem grants administrativos nem consulta individual adicionada ao dashboard F5.2. O proprietário técnico do banco continua a ter os privilégios inerentes de administração da infraestrutura.
- Histórico e sincronização começam desligados e são independentes. Histórico pode registar visitas sem posições; sincronização pode guardar posições sem criar histórico. Leituras reais montadas disparam registo, não fetches de catálogo/prefetch de media.
- Preferências desligadas impedem novas gravações correspondentes no servidor. Alterações de consentimento incrementam uma época; filas antigas são recusadas. Não apagam dados anteriores silenciosamente.
- Limites: corpo 32 KB, localizador 2 KB sem texto literário, 60 operações por minuto/conta e 20 de progresso. Fila normal envia no máximo uma operação a cada 15 segundos e coalesce amostras ainda não enviadas. Operações já tentadas conservam UUID/payload para replay, mesmo após resposta perdida.
- Cada capítulo tem revisão CAS; clocks de dispositivos não decidem quem vence. Conflitos ficam visíveis na biblioteca: recuperar a posição da conta, confirmar reenvio da posição local ou descartar apenas o envio pendente. Limpeza de obra incrementa geração; limpeza global/histórico incrementa época. Pedidos offline antigos não recriam dados eliminados.
- Histórico e progresso não são enviados ao endpoint de métricas, não partilham identificadores de sessão com métricas e não são expostos a autores, perfis públicos ou rankings. As opções de métricas F5.1 permanecem independentes.
- RPCs só projetam metadados atuais de snapshots públicos. Referências indisponíveis permanecem opacas/privadas. O histórico não guarda texto de capítulos, imagens, URLs R2 nem autoria privada. Não há nova integração Worker/R2.

## Dados locais, importação e rede

- O armazenamento novo é separado por `guest` e `user:<UUID>`; a fila persistente é separada por UUID. A troca de conta desmonta o motor, cancela timers e mantém o token do proprietário fixado em cada pedido já iniciado.
- A ligação **Dados deste dispositivo** (`?local=1`) mantém acessíveis as listas e o progresso da vista anterior, sem importação automática.
- A importação existe apenas no botão **Importar o meu progresso deste dispositivo**, após confirmação. Reutiliza o progresso anónimo atual e referências antigas do store local. Deduplica por obra/capítulo, valida a publicação atual e preserva entradas já confirmadas na conta. Nunca elimina originais locais, mesmo após sucesso; informa quantos foram preparados/ignorados, sem declarar sucesso remoto antes de ACK.
- A fila fica no dispositivo em falhas de rede e recupera no evento online ou por tentativa manual. Limpar armazenamento do navegador pode perder dados ainda não enviados: existe exportação JSON privada de pontos e fila. Não existe cache offline completo das obras nem service worker; uma página já carregada pode continuar a registar posições sem rede, mas um arranque offline não garante o carregamento do texto/media público.
- Há controlos separados para histórico remoto, progresso remoto de uma obra/todas, marcas de conclusão, progresso local da conta e progresso anónimo. Apagar só dados locais não apaga a fila nem dados remotos; o diálogo explica essa separação.
- Filas/posições de outras contas nunca são importadas como dados anónimos. Posições que só existem noutro navegador anónimo não podem ser recuperadas sem transferência explícita.

## Instalação autorizada posterior

1. No projeto correto `dlwsjfqijrsmwejsmuts`, confirmar sem modificar:

   ```sql
   SELECT to_regclass('public.social_library'),
          to_regclass('public.social_work_follows'),
          to_regclass('public.published_works'),
          to_regclass('public.published_work_entries'),
          to_regclass('public.published_visual_pages'),
          to_regprocedure('auth.uid()'),
          to_regprocedure('public.reading_library(text,jsonb,uuid)');
   ```

   Os cinco objetos base e `auth.uid()` devem existir. Se `reading_library` já existir, comparar esquema/histórico antes de reaplicar. Não executar reset ou substituir migrations anteriores.

2. Após autorização, executar **uma vez** a migration completa, incluindo BEGIN/COMMIT. Não requer novos segredos, Worker, bucket, moderadores ou alteração das políticas existentes.
3. Validar ACL/RLS:

   ```sql
   SELECT tablename, policyname, roles, qual
   FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'reading_%';
   SELECT c.relname,c.relrowsecurity,
     has_table_privilege('anon',c.oid,'SELECT') AS anon_read,
     has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS direct_access
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN
    ('reading_settings','reading_works','reading_progress','reading_history',
     'reading_lists','reading_list_items','reading_operations');
   SELECT has_function_privilege('anon','public.reading_library(text,jsonb,uuid)','EXECUTE') AS anon_rpc,
          has_function_privilege('authenticated','public.reading_library(text,jsonb,uuid)','EXECUTE') AS member_rpc;
   ```

   Esperado: RLS true; acesso direto false; RPC anon false/member true. Testar as RPCs com JWTs reais no navegador, não usando SQL Editor como se fosse uma conta comum. Não copiar tokens para documentação ou logs.

4. Numa implantação autorizada de validação, definir `VITE_ENABLE_READING_SYNC=true` e reconstruir o frontend nesse ambiente; em Vite esta variável é de build. Nenhuma flag existente precisa de ser alterada. Só ativar Production depois da verificação abaixo.
5. Duas contas e dois dispositivos: ativar preferências explicitamente; confirmar isolamento; ler capítulo no A, aguardar ACK e retomar no B; gerar conflito com B antigo; testar perda de rede/reconexão, replay, importação e troca de conta. Validar todos os formatos, listas/reordenação, retiradas/republicações e limpezas. Não usar obras de terceiros para operações destrutivas.

Reversão conservadora: desligar a flag e reconstruir pelo pipeline autorizado. Preservar tabelas e dados; não apagar migrations, histórico ou filas para contornar erros. Definir preferências como desligadas continua a ser uma decisão da conta. Não há tarefa automática de retenção/eliminação de recibos nesta entrega.

## Validação

- `scripts/reading-sync.test.tsx`: cache anónimo/contas/capítulos, conclusão, importação explícita, dois dispositivos simulados, falhas/replay/offline, fila persistente, conta trocada, edição publicada e transporte autenticado.
- `scripts/validate-reading.mjs`: PostgreSQL local/PGlite com todas as migrations e grants padrão hostis; RLS/ACL, CAS/idempotência, preferências independentes, isolamento, listas, histórico, tombstones, retirada/republicação e preservação social.
- `scripts/reading-sync.browser.html`: componentes e provider em navegador real, com transporte simulado, formulários/erros, listas, filtros, prosa/poesia/mangá, isolamento, temas e responsividade. Não certifica acessibilidade completa nem prova sincronização remota entre dispositivos reais.
- Suite SQL F5.2 e testes de regressão gerais preservados. A instalação, desempenho sob volume real e os ensaios com Supabase/contas/dispositivos reais permanecem pendentes. Nenhum resultado remoto foi presumido.

Limites de interpretação: para relações sociais antigas, a ordenação por adição usa o timestamp de alteração que a F5.1 efetivamente guardava; não é reconstruída uma data original inexistente. Estados pessoais de obra são escolhas independentes das marcas por capítulo, por isso um capítulo novo não altera automaticamente uma escolha manual de obra concluída.

Resultados da entrega local: **404/404 testes automatizados**, **17/17 cenários de navegador**, suites SQL F5.3 e F5.2 aprovadas, typecheck/build de produção aprovados, formatação dos ficheiros afetados e `git diff --check` sem erros. A sincronização com Supabase e dispositivos reais ainda não foi validada remotamente.
