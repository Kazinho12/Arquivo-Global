# Fase 5 — plano técnico inicial

Proposta de divisão para aprovação; não descreve subfases já existentes nem autoriza implementação. Depende da validação operacional da Fase 4 em [fase-4-encerramento.md](fase-4-encerramento.md).

## Reutilização obrigatória

- `profile_follows` já tem chave composta follower/followed, prevenção de auto-seguimento e RLS de escrita do próprio seguidor. `features/profile/publicData.ts` já consulta contagem exata; não criar outra relação de seguidores. A política atual permite leitura pública dos pares: rever o contrato de privacidade antes de ampliar exposição e decidir se basta uma RPC agregada.
- `features/library/store.ts`, `library/types.ts` e `reader/progress.tsx` já implementam biblioteca, favoritos, listas, estados e continuidade locais. Preservar leitura anónima local; migração para conta deve ser explícita, idempotente e nunca misturar âmbitos.
- Reutilizar IDs públicos estáveis de obras/capítulos. Mapear internamente para os objetos privados apenas em operações autorizadas; retirada de publicação deve continuar a limitar a descoberta e leitura pública.
- Preservar repositórios/controladores existentes e eventos de atualização do catálogo. Novas migrations aditivas e APIs devem ter testes SQL de autorização, revisão/concorrência e repetição antes de instalação.

## Ordem proposta

| Etapa proposta                   | Âmbito                                                                                                                                                             | Dependências e critérios                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F5.1 — relações e biblioteca     | Seguir/deixar de seguir autores; contagens de seguidos; guardar/remover obras, favoritos, em leitura/concluídas/para depois, listas/coleções e seguimento de obras | Reutilizar `profile_follows`; relações únicas e operações idempotentes; biblioteca/listas privadas por RLS; UI com ACK e rollback; conciliação local opcional                                                               |
| F5.2 — continuidade sincronizada | Histórico privado, retomar leitura e capítulos lidos                                                                                                               | F5.1; upsert por utilizador/obra/capítulo, atualização limitada em frequência; resolver capítulos substituídos/retirados sem expor conteúdo; preferências de retenção e eliminação a definir                                |
| F5.3 — curtidas                  | Curtir/descurtir obras e capítulos                                                                                                                                 | Uma relação única por ator/alvo; nunca aceitar um contador enviado pelo cliente; autorizações sobre alvo público; agregados derivados e teste de chamadas concorrentes                                                      |
| F5.4 — comentários e moderação   | Comentários em obras/capítulos/episódios, respostas, curtidas de comentários, edição/eliminação pelo comentador, denúncias e moderação                             | Conteúdo público validado; RLS por autor do comentário e papéis administrativos verificáveis; sanitização; limites por ator e alvo, rate limiting servidor e proteção contra spam; operação moderadora auditável            |
| F5.5 — eventos e notificações    | Novos seguidores, comentários/respostas, curtidas relevantes, capítulos e atualizações de autores/obras seguidos; preferências                                     | Eventos transacionais/outbox, consumidores idempotentes e unicidade de entrega; preferências e leitura só pelo destinatário; retirada não divulga conteúdo privado; definir canal inicial antes de implementar              |
| F5.6 — métricas e painel         | Visualizações únicas/totais, leituras por obra/capítulo, curtidas, comentários, seguidores e obras guardadas; estatísticas no perfil e Studio                      | Definir o que conta como leitura/visita única e janela temporal; ingestão servidor com deduplicação e limites de abuso, agregados por período e índices; contagens públicas aprovadas e dados detalhados só do proprietário |

## Regras de dados e desempenho

- Biblioteca, histórico, preferências e notificações são privados por defeito. Autores recebem agregados aprovados, não a identidade nem o histórico privado dos leitores. Listas públicas exigem decisão explícita posterior.
- Distinguir preferências pessoais de relações públicas. Não tornar favoritos ou obras guardadas públicos como efeito da implementação de contadores.
- Eventos de nova publicação devem ocorrer apenas após confirmação transacional. Distinguir primeira publicação, atualização, novo capítulo, retirada e republicação; definir quais notificam, com chave única por evento/destinatário.
- Não incrementar métricas livremente no navegador nem equiparar download automático de imagem a leitura. Contagens de visitas anónimas são estimativas sujeitas a abuso; documentar limites e decidir uma estratégia de privacidade antes de recolher identificadores. Evitar fingerprinting e guardar apenas o mínimo necessário.
- Agregados devem refletir inserção, remoção e moderação; usar unicidade, transações e reconciliação, nunca incrementos sem deduplicação. Nenhuma métrica fictícia para preencher estados vazios.
- Paginação por cursor, índices por ator/alvo/data, limites por pedido e consultas agregadas para evitar N+1. Validar exclusão de obras retiradas em feeds/notificações e impedir que joins exponham rascunhos.
- Testar conta A/B/anónimo, contas eliminadas, alvo retirado, tentativas cruzadas, duplo clique, repetição após perda de resposta e concorrência. Definir política de retenção/moderação com revisão humana antes de prometer procedimentos ao público.

## Primeira tarefa recomendada

Depois do encerramento remoto da Fase 4: implementar apenas a UI seguir/deixar de seguir sobre `profile_follows`, com contagens reais, erros visíveis e testes de isolamento/idempotência. Aprovar separadamente a persistência da biblioteca e o contrato público das relações. Não iniciar comentários, notificações ou métricas em paralelo sem estes contratos.
