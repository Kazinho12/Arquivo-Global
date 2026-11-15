# F4.2-B — editor visual privado

Implementação local. Não foram executados SQL, uploads ou alterações de configuração remotos nesta fase. A F4.2-A tem apenas as verificações remotas básicas reportadas pelo proprietário; o seu fluxo autenticado completo continua pendente. Manter `VITE_ENABLE_CUSTOM_COVERS=false` em produção.

## Modelo e limites

A migration `20261115000000_visual_editor_private.sql` reutiliza `work_entries` para capítulos/episódios e conserva títulos, posições e guiões existentes. `works.visual_settings` guarda formato, modo e direção. `visual_pages` associa sequências ordenadas a `editorial_assets`; estes assets têm namespace R2 `editorial/`, separado de `cover_assets`, capas e avatares. Duplicações partilham assets do mesmo proprietário com novas associações; qualquer referência impede a limpeza do ficheiro.

Limites iniciais: JPEG/PNG/WebP estático, 20 MiB/imagem, 40 milhões de pixels, largura 16 384 e altura 65 535 pixels; 1 000 páginas/capítulo e 10 000 assets/conta. Os limites são configuráveis em `editorial_media_settings`; o cliente consulta-os no Worker. Os limites de imagem não ultrapassam os tetos de segurança do parser; aumentar esses tetos exige revisão do código. A quantidade por capítulo pode aumentar via configuração. O orçamento global existente de `cover_media_settings` (inicialmente 8 GiB) passa a contabilizar capas e imagens editoriais conjuntamente, incluindo reservas pendentes. Não há novas quotas cobradas ou promessas de armazenamento ilimitado.

Envios e leituras têm concorrência máxima de dois. Miniaturas mantêm proporção original, cache local LRU de 32 Blobs; imagens completas são carregadas apenas perto da área visível e as URLs Blob são revogadas. A pré-visualização vertical mostra lotes de 20 imagens. Ficheiros por enviar e guiões ficam apenas em memória, separados pelo controlador da conta; recarregar sem guardar pode perdê-los e apresenta aviso.

`save_visual_chapter` verifica proprietário, revisão da obra e do capítulo, UUID de operação e fingerprint antes de substituir atomicamente a sequência. O upload concluído ainda não equivale a capítulo guardado. Erros preservam os buffers. Duplicar, remover e reordenar capítulos usa a RPC editorial existente. O índice editorial não é invertido quando a leitura é RTL.

## Segurança e instalação posterior

1. Rever e validar remotamente a infraestrutura F4.2-A sem ativar a sua flag. Esta migration requer a migration de capas personalizadas instalada; confirmar previamente objetos e histórico, sem presumir equivalência com o ambiente local.
2. Rever e aplicar manualmente a migration B, completa e transacional, no projeto correto, após autorização. Ela não modifica Auth/perfis nem snapshots. Revoga acessos públicos a RPCs e aplica SELECT com RLS de proprietário às novas tabelas; escritas apenas por RPCs. `reserve_cover_upload` mantém o contrato anterior, acrescentando a contabilização editorial à quota partilhada.
3. No Worker existente, adicionar as funções de `docs/cloudflare-editorial-media.js`. No início do handler `fetch`, antes do tratamento global de OPTIONS/autenticação, inserir:

   ```js
   const editorialResponse = await handleAgEditorialMedia(request, env);
   if (editorialResponse) return editorialResponse;
   ```

   Preservar todos os handlers existentes. Usar `AG_MEDIA`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e o segredo servidor `COVER_MEDIA_TOKEN` já previsto em A, correspondente ao hash configurado no banco. Nenhum segredo deve ser uma variável VITE. `MEDIA_ALLOWED_ORIGINS` permite origens adicionais explícitas; `MEDIA_MAX_EDITORIAL_BYTES` pode reduzir o teto de 20 MiB. Não criar bucket/Worker/token adicional.

4. Validar com duas contas de teste e ficheiros descartáveis: limites, upload parcial/repetição, guardar/reabrir, conflito, duplicação, remoção de associações, limpeza após carência e rejeição anónima/conta alheia. O GET privado exige Bearer e propriedade; UUID/chave não concede acesso. Os prefixos públicos/genéricos não servem estes objetos.
5. Só depois de autorização e validação remota, definir `VITE_ENABLE_VISUAL_EDITOR=true` no ambiente pretendido e construir/deployar o frontend. A flag é independente da de capas e está desligada por defeito. Desligada, o frontend mantém o editor antigo e não consulta as novas colunas/RPCs. Não ativar a flag de capas como efeito desta instalação.

Os endpoints privados incluem `/media/editorial/limits`, POST `/media/editorial/works/{work}/entries/{entry}`, GET `/media/editorial/private/{work}/{entry}/{asset}`, DELETE `/media/editorial/assets/{asset}` e POST `/media/editorial/cleanup`. Reservas têm carência de 24 horas para limpeza. Limpeza explícita processa até 50 candidatos sem referências por chamada; pode ser repetida. Não existe cron novo. Falhas entre reserva, R2 e confirmação deixam estado recuperável, contabilizado até limpeza. Eliminações interrompidas podem ser repetidas. Não eliminar manualmente objetos referenciados.

## Publicação e reversão

A edição privada não altera snapshots antigos. Uma proteção SQL bloqueia publicação/atualização pública de obras com o novo modelo visual; a interface explica a pendência e mantém retirada de publicação. Guiões antigos sem novo modelo conservam o comportamento anterior. F4.2-C (leitores públicos) e F4.2-D (integração/validação final) não estão implementadas. Antes dessas fases, será necessário definir snapshots de imagens e pinagem das referências públicas, autorização de leitura e retirada; não expor o prefixo `editorial/` nem ativar acesso público ao bucket.

Para recuar operacionalmente, desligar a flag B e manter esquema/assets. Não apagar dados, tabelas ou objetos R2. O editor antigo não apresenta as sequências, mas não as elimina. A proteção de publicação continua ativa. Reversão SQL exige uma revisão específica; não executar DROP ou restaurar funções antigas que ignoram quotas/referências editoriais.

## Validação local

- `scripts/visual-editor.test.tsx`: Worker com Supabase/R2 isolados, validação, autenticação, limites, concorrência, falhas parciais, contratos e publicação bloqueada.
- `scripts/validate-visual-editor.mjs`: PostgreSQL local PGlite, migrations reais, permissões hostis por defeito, revisões, idempotência, duplicação, quotas e referências.
- `scripts/visual-editor.browser.html`: editor real com transporte isolado de teste, uploads, recuperação, ordenação por botão, conflitos e layouts/temas.

Estes testes não comprovam o funcionamento no Supabase/R2 de produção. A ativação e os ensaios remotos continuam sujeitos a autorização.

Resultado desta execução: 346 testes automatizados aprovados (incluindo 11 novos), nove cenários de navegador aprovados e validação SQL PGlite aprovada. A verificação global de formatação assinalou apenas `scripts/stabilization-b.test.tsx`, preexistente e não alterado nesta fase; os novos ficheiros passaram na verificação direcionada.

## Entrega e estado remoto — 15/11/2026

O proprietário autorizou a aplicação de B e a integração no Worker e confirmou os pré-requisitos de A: migration aplicada, tabelas e RPCs existentes, RLS/permissões restritas, configuração de media com hash presente, capas até 5 MiB e orçamento partilhado de 8 GiB. Estas confirmações não equivalem a uma inspeção automática das definições remotas.

Nesta entrega não existe conector administrativo Supabase/Cloudflare, CLI ligada, credencial administrativa no ambiente ou painel autenticado disponível. Por isso, a migration B, a publicação do trecho no Worker e os testes autenticados reais permanecem bloqueados por falta de acesso. Não se tentou reaplicar A nem executar SQL remoto. Antes de aplicar B, confirmar automaticamente o histórico, a ausência dos objetos B, as estruturas A, assinaturas/definições das funções substituídas, RLS, privilégios e linhas de configuração; se houver divergência, interromper. Rever a versão completa atualmente publicada do Worker e as rotas genéricas antes de integrar o trecho.

O proprietário confirmou nesta entrega que `VITE_ENABLE_CUSTOM_COVERS=false` e `VITE_ENABLE_VISUAL_EDITOR=false` estão guardadas na Vercel Production. Esta configuração não foi inspecionada diretamente pelo agente. Nenhuma flag foi ativada e nenhum deploy manual do frontend foi solicitado. Um push pode desencadear o fluxo automático de deploy configurado pelo proprietário.

A integração real ainda requer os ensaios descritos acima, incluindo duas contas, concorrência entre sessões, falhas de rede/reserva/R2, referências partilhadas, quotas e regressões de avatares/capas. Não declarar F4.2-A ou B integralmente validadas em produção. F4.2-C e F4.2-D permanecem fora desta entrega.
