# F5.1 — métricas, favoritos e tendências

## Diagnóstico confirmado

Inspeção local e pedidos controlados em 15/11/2026, sem criar leituras:

- A produção respondeu **400 / «Alvo inválido»** a um POST com alvo inválido. No handler publicado, essa resposta ocorre depois das verificações de origem, configuração pública, presença/tamanho do segredo e endereço Vercel. Esses pré-requisitos passaram nesse pedido; não se pode concluir o mesmo para todas as origens/dispositivos.
- Um UUID aleatório foi confirmado inexistente por `read_public_work` (consulta pública, resposta null). A tentativa da API para esse alvo respondeu **503 / «Não foi possível registar a leitura»**. O código antigo colapsa erros da RPC nesse texto e transforma também a recusa esperada de conteúdo inexistente em indisponibilidade.
- Chamadas diretas com prova deliberadamente inválida devolveram **401 / 42501**, tanto com a chave pública no apikey como com Bearer anon. Confirmam que a RPC existe e rejeita o pedido; não demonstram o valor do segredo em Vercel nem a sua correspondência com o hash remoto.
- Portanto, a causa específica do aviso na obra real **não foi confirmada remotamente**. Não houve inspeção de secrets, logs administrativos, hashes privados ou uma leitura válida em produção. Nenhum contador foi alterado nos diagnósticos.

Problemas de código corrigidos: falhas de conteúdo/prova/permissão/esquema/rede eram indistinguíveis; HTTP 401 de PostgREST com SQLSTATE 42501 era tratado genericamente; faltava o Bearer público no caminho de compatibilidade com JWT anon legado (a fonte de sitemap já o tratava). Não foi acrescentado fallback para cabeçalhos de IP não verificados nem removida qualquer prova/RLS/deduplicação.

A API agora devolve códigos seguros `METRICS_PROOF_REJECTED`, `METRICS_PERMISSION_DENIED`, `METRICS_SCHEMA_UNAVAILABLE`, `METRICS_CONTENT_UNAVAILABLE`, `METRICS_RPC_FAILED` e `METRICS_NETWORK_ERROR`. O leitor apresenta mensagens apropriadas sem mostrar detalhes do fornecedor. Visitantes não são desligados da sessão por estas falhas.

Após instalação da migration nova e publicação autorizada do código, `GET /api/social-metrics` com o cabeçalho Origin correto verifica a prova e a permissão anon de executar a RPC. **Não cria cookie, visitas ou hashes de leitor.** Exemplo de diagnóstico sem segredos:

```sh
curl -i https://arquivoglobal.vercel.app/api/social-metrics \
  -H 'Origin: https://arquivoglobal.vercel.app'
```

- `200 {"ready":true}`: prova/hash e permissão de execução conferem; ainda é necessário validar uma leitura real autorizada.
- `METRICS_PROOF_REJECTED`: rever no painel a correspondência do segredo/hash; nunca colar os valores em chat/logs.
- `METRICS_PERMISSION_DENIED`: rever EXECUTE da função e papel anon, sem abrir tabelas pessoais.
- `METRICS_SCHEMA_UNAVAILABLE`: rever migration, assinatura e cache de esquema PostgREST.
- `METRICS_RPC_FAILED` / `METRICS_NETWORK_ERROR`: correlacionar com logs administrativos, sem registar o corpo que contém a prova. A indisponibilidade anterior ao diagnóstico permanece 503 sem valores de configuração.

O endpoint continua a exigir origem igual e cabeçalhos da infraestrutura Vercel, conforme a [documentação de cabeçalhos Vercel](https://vercel.com/docs/headers/request-headers). No Vite puro as funções `/api` não são executadas. Mantêm-se consentimento opcional, interação real, 8 segundos na obra/20 no capítulo, cookie pseudónimo, deduplicação de 24 horas, limite de rede e armazenamento privado.

## Migration aditiva e compatibilidade

`supabase/migrations/20261115030000_social_rankings.sql`:

1. Índice parcial de `social_library(publication_id) WHERE favorite`.
2. `read_social_state(uuid,uuid)` mantém assinatura, verificações, campos e concessões e acrescenta apenas `favorites` agregado.
3. `social_metrics_status(text)` verifica prova/hash e EXECUTE anon; é readonly e mantém o hash inacessível. Disponível apenas a anon com prova servidor.
4. `read_social_rankings(text,text,boolean,integer,integer)` devolve uma página de projeções públicas com contagens agregadas, sem recibos, proprietário, identificadores de leitor ou bibliotecas.

Nenhuma migration anterior foi editada. Nenhum dado/contador foi recalculado ou removido. Funções novas têm `search_path=''` e EXECUTE público revogado antes das concessões específicas. Escrita nas relações/contadores e regras de publicação anteriores permanecem intactas. O cliente aceita a resposta anterior sem `favorites`, apresentando indisponibilidade em vez de um zero inventado; rankings ainda não instalados apresentam erro explícito.

## Contagens e fórmula

- Favoritos: COUNT real de registos `favorite=true`, sem identidades. Distinto de guardar/ler depois. Unicidade existente por conta/obra impede duplicações; a UI atualiza e reverte em erro.
- Mais vistas: estatística deduplicada da **página da obra**. Leituras de capítulos são uma métrica separada e não se somam como se fossem visitas à obra.
- Mais curtidas: curtidas atuais da obra, sem somar curtidas de capítulos/comentários.
- Mais favoritadas: favoritos atuais da obra.
- Mais comentadas: comentários/respostas visíveis da obra e dos capítulos que continuam na edição pública; removidos/ocultados e capítulos retirados não contam.
- Em destaque: `ln(1+vistas) + 3*ln(1+curtidas) + 4*ln(1+favoritos) + 2*ln(1+seguidores) + ln(1+comentários)`, arredondado a quatro casas. O logaritmo limita o domínio de volumes muito grandes; não constitui um sistema completo contra manipulação.

Não existe janela recente reconstruível para todas as métricas. São relações atuais e visualizações acumuladas, identificadas na interface; retirar curtida/favorito reduz a classificação. Empates: primeira publicação descendente e UUID público ascendente. Só aparecem valores positivos para o critério escolhido. Zero interações produz vazio verdadeiro.

Uma RPC faz as agregações e paginação (12 por página, máximo 24); não há uma consulta a biblioteca por cartão. Índices existentes e o índice parcial suportam os agregados. Rankings globais ainda têm custo proporcional às relações/publicações elegíveis: medir o plano de execução e volumes reais antes de introduzir materialização/cache; não existe promessa de desempenho ilimitado.

Privadas, retiradas e arquivadas são excluídas por snapshot e estado privado correspondente. +18/avisos exigem inclusão explícita; classificações desconhecidas ficam excluídas. Formatos e capas reutilizam os componentes existentes, incluindo publicações visuais e poesia. Favoritos individuais permanecem privados.

## Validação e instalação pendente

- Testes de contrato/API: códigos de erro, readiness sem escrita, JWT anon público legado, falhas e favoritismo retrocompatível.
- SQL PGlite local: favoritos únicos/removidos, isolamento, fórmulas/ordenações/paginação, projeções, retirada/arquivo/privacidade, opt-in de conteúdo e prontidão protegida por prova.
- Navegador: contador após adicionar/remover favorito, carregamento, cinco classificações, filtros/URL/paginação, vazio/erro, mobile e recusa de consentimento; regressões sociais anteriores preservadas.

Instalação posterior, somente após autorização:

1. Rever e aplicar **apenas** `20261115030000_social_rankings.sql` no projeto `dlwsjfqijrsmwejsmuts`, uma transação completa, sem reaplicar F5.1 ou alterar os secrets configurados.
2. Publicar o código mediante autorização separada; não ativar flags automaticamente.
3. Executar o GET readonly acima. Conforme o código, rever configuração/permissões com acesso administrativo. Só depois testar, com consentimento, uma obra descartável: contar, recarregar sem incremento, retirar publicação e negar novos pedidos.
4. Comparar favoritos/rankings com interações autorizadas de duas contas e verificar bibliotecas privadas. Concluir validação em produção apenas com resultados reais.

Esta entrega local não executa SQL remoto, não altera secrets/flags, não faz deploy nem push. O commit foi autorizado separadamente pelo proprietário; não implica aprovação da instalação ou publicação.

## Resultados locais

370 testes automatizados aprovados; 19 cenários de navegador aprovados; suites SQL locais de rankings/favoritos e regressão social aprovadas; typecheck, build, formatação direcionada e verificação do diff aprovados. As verificações de produção foram apenas os pedidos recusados/readonly descritos acima, não a validação de uma leitura real.
