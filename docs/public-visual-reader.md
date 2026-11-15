# F4.2-C — leitor visual público

Implementação local; não foram executadas migrations remotas, deploys, alterações de flags, commits ou pushes. O ficheiro local `worker-integrado.js` pertence ao proprietário e não foi modificado.

## Contratos e segurança

A migration `20261115010000_public_visual_reader.sql` requer B. Acrescenta `published_works.visual_settings`, `published_visual_pages` e a chave administrativa `editorial_media_settings.public_reading_enabled`, instalada como `false`. Não modifica as migrations anteriores nem apaga obras existentes.

A RPC existente `publish_private_work` conserva propriedade, bloqueio da obra, revisões, recibos/idempotência, metadados, autoria pública, capas e datas. Quando há configuração visual, publica somente capítulos com imagens guardadas; copia a sequência para snapshots com novos identificadores públicos de página. Guiões/notas não são copiados. Obras visuais antigas sem o novo modelo mantêm publicação textual; prosa e poesia conservam o contrato anterior. A retirada usa a operação existente da obra; retirar um capítulo da edição pública exige removê-lo/esvaziá-lo no rascunho e confirmar uma atualização. Para retirar o último capítulo, retirar a obra inteira de publicação.

A leitura da obra devolve configurações e contagens, não todos os ficheiros/metadados de todos os capítulos. `read_public_visual_pages(uuid,uuid,integer,integer)` retorna metadados por capítulo (20/pedido no cliente, máximo 40 no servidor). A tabela pública permite SELECT apenas das colunas públicas sob RLS; `asset_id` não é concedido. Entradas privadas, recibos, IDs de propriedade e chaves R2 não entram no contrato do leitor.

`resolve_public_visual_asset(uuid,uuid,uuid,text)` exige a prova privada do Worker existente e verifica a associação do identificador público de página à publicação ainda pública, ao capítulo e ao asset pronto. Embora possa receber pedidos com o papel anónimo do Worker, não resolve chaves para chamadas sem essa prova. O seu retorno técnico é consumido exclusivamente no servidor. Todos os helpers privilegiados têm `search_path` vazio e permissões explícitas.

`begin_delete_editorial` e `list_unused_editorial_assets` passam a proteger referências públicas e privadas. Snapshots retirados continuam a proteger os ficheiros até uma nova publicação ou eliminação da obra substituir/remover as referências. Edições privadas não alteram a versão pública. A republicação mantém IDs da obra/capítulo e gera novos IDs das páginas; URLs das páginas da edição anterior deixam de resolver. O orçamento A/B não é duplicado por snapshots, pois não se copia o ficheiro R2.

## Worker existente

Adicionar as funções de `docs/cloudflare-public-visual-media.js` ao Worker atual. Antes do dispatch editorial privado, de capas e do tratamento global de OPTIONS/Auth:

```js
const publicVisual = await handleAgPublicVisualMedia(request, env);
if (publicVisual) return publicVisual;
// Manter depois os handlers privados, de capas e de avatares existentes.
```

GET `/media/editorial-public/{publicWorkId}/{publicChapterId}/{publicPageId}` é uma rota nova e separada. Não reutiliza o GET privado, não aceita chaves R2, ignora tokens de utilizador recebidos e resolve sempre o snapshot público no Supabase antes de consultar R2. Utiliza os mesmos `AG_MEDIA`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `COVER_MEDIA_TOKEN`, sem criar credenciais ou buckets. A resposta não expõe chaves e usa `no-store` no navegador/CDN; não existe cache pública de autorização. Uma falha no Supabase não provoca fallback para R2. Validar também que as rotas genéricas do Worker completo não aceitam o namespace `editorial/`.

Origens adicionais de Preview devem constar explicitamente em `MEDIA_ALLOWED_ORIGINS`; os handlers antigos podem usar `ALLOWED_ORIGINS`. Nenhum segredo deve ser colocado em variáveis VITE. A rota pública aceita apenas GET/OPTIONS e os três identificadores públicos exatos; query strings são rejeitadas.

Retirar a publicação bloqueia novos pedidos, inclusive por URLs conhecidos. Não é tecnicamente possível apagar imagens já descarregadas, capturas ou respostas cuja autorização ocorreu antes da retirada; imagens visíveis são removidas quando a revalidação existente da obra deteta a retirada (até 30 segundos em separador visível). O servidor verifica novamente cada novo GET.

## Interface e desempenho

As rotas existentes `/obras/:id` e `/obras/:id/capitulos/:capituloId` apresentam o leitor novo apenas para snapshots visuais e com `VITE_ENABLE_PUBLIC_VISUAL_READER=true`. A flag está desligada em `.env.example`; o frontend anterior às migrations continua compatível e o novo leitor apresenta indisponibilidade em vez de tratar um snapshot visual como guião vazio quando desligado.

O leitor respeita modo/direção publicados e permite mudar paginado/vertical, LTR/RTL, zoom 50–250%, ajuste à largura/altura e tema de leitura local. Inclui teclado (setas e Escape), gesto horizontal de um dedo sem zoom, índice, anterior/próximo capítulo, progresso e modo imersivo com gestão de foco. Não implementa comentários, métricas ou recomendações.

A ordem editorial nunca é invertida para RTL. O modo paginado apresenta uma página e pré-carrega no máximo a seguinte quando os seus metadados já existem, evitando pré-carga em ligações 2G/economia de dados. O modo vertical carrega lotes progressivos de 20, com botão alternativo à observação de interseção. As imagens só recebem `src` perto da área visível e preservam proporção/dimensões reservadas; não há download de capítulos completos antecipadamente nem Blob URLs mantidas por este leitor. Posição/progresso ficam apenas no armazenamento local existente, sem enviar histórico ao Supabase.

## Instalação posterior, sujeita a autorização

1. Confirmar o projeto remoto, histórico e contratos reais de A/B, incluindo o funcionamento privado e as rotas existentes do Worker. Não presumir que B já está aplicada.
2. Rever/aplicar C uma única vez, transacionalmente. Confirmar RLS, SELECT por coluna, funções, referências e `public_reading_enabled=false`.
3. Rever o Worker atualmente publicado, acrescentar o handler C sem substituir handlers, instalar em ambiente de teste autorizado e verificar CORS, rejeição de chaves privadas, falhas de RPC e regressões A/B/avatares.
4. Num ambiente de teste autorizado, habilitar a configuração administrativa C e a flag de frontend; publicar uma obra descartável com duas contas, validar os cenários abaixo e rever o resultado antes de ativar produção. A alteração administrativa necessária, apenas após autorização, é:

   ```sql
   UPDATE public.editorial_media_settings
   SET public_reading_enabled = true WHERE id = true;
   ```

5. A configuração de build C é `VITE_ENABLE_PUBLIC_VISUAL_READER=true`. É independente de `VITE_ENABLE_CUSTOM_COVERS` e `VITE_ENABLE_VISUAL_EDITOR`; esta tarefa não alterou nenhuma configuração remota. Não ativar flags por efeito colateral. O editor B requer a sua própria ativação autorizada para criar novas sequências.

Para interromper novas publicações e a entrega de imagens C, colocar `public_reading_enabled=false`; não apagar tabelas/assets. Desligar a flag frontend apenas oculta o leitor, não revoga imagens de snapshots ainda públicos. Para revogar uma obra, usar a operação de retirada. Reversão SQL exige revisão; não restaurar funções B que ignoram referências públicas enquanto existirem snapshots C.

## Verificações

- `scripts/validate-public-visual.mjs`: PostgreSQL local/PGlite, A/B/C, permissões hostis por defeito, metadados anónimos, prova do Worker, isolamento, snapshots/ordem, scripts privados, proteção de referências, revisões/repetições, retirada de capítulo/obra e republicação.
- `scripts/public-visual.test.tsx`: contratos/limites, Worker e R2 isolados, CORS, autorização por snapshot, indisponibilidade, cliente anónimo e publicação de capítulos sem texto.
- `scripts/public-visual.browser.html`: leitor real com transporte isolado, HQ/mangá/webtoon, teclado/toque, lotes, temas, mobile/desktop, falhas e navegação.

Ensaios reais de duas contas, publicação, upload/R2, concorrência, retirada e republicação continuam pendentes e não são comprovados pelos testes locais. A auditoria automatizada não constitui certificação completa de acessibilidade. F4.2-D não foi iniciada.

Resultado local desta execução: 354 testes automatizados aprovados (oito novos), 12 cenários de navegador aprovados, SQL PGlite aprovado, typecheck e build de produção aprovados. O trecho novo do Worker passou também em `tsc --allowJs --checkJs`. Capturas de 360/1280 px nos temas claro/escuro foram inspecionadas. A verificação global de formatação acusa apenas `scripts/stabilization-b.test.tsx`, preexistente e não alterado; `git diff --check` passou. Nenhum destes resultados comprova o funcionamento no Supabase/R2 de produção.
