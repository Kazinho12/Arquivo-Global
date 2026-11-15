# Fase 4 — estabilização e condições de encerramento

Revisão F4.2-D de 15/11/2026. Base: `44bf9d4c4b06e6b52ed1d1dbe379f1879ecc8aa3`, branch `main`.

**Decisão: baseline local validada; encerramento operacional condicionado à validação remota abaixo.** Não confundir código e testes locais com certificação da infraestrutura de produção. Os documentos anteriores de A/B/C registam o estado das respetivas entregas; referências históricas a fases ainda não implementadas não representam este estado atual.

## Funcionalidades e evidências

| Área                        | Implementação verificada                                                                                                                      | Validação nesta revisão                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Auth e sessões              | Cliente partilhado por projeto, inicialização em efeito, PKCE e coordenação Web Locks preservados                                             | Testes de Auth, login/logout, recuperação, OAuth e regressões de erros/permissões; sem login real novo |
| Perfis e avatares           | `avatar_url` guarda referência; upload privado e leitura pública do avatar atual; fallback de iniciais e substituição sem eliminar o anterior | Testes de perfil, API de avatar e Worker isolado; não houve upload real                                |
| Obras do autor e seguidores | RPC por proprietário estável devolve apenas snapshots públicos; contagem exata em `profile_follows`                                           | Testes de frontend e SQL F4.1, incluindo privacidade, unicidade, auto-seguimento proibido e permissões |
| Obras e publicação textual  | RPCs com proprietário, revisão e operação idempotente; publicar/atualizar/retirar/republicar; arquivo separado                                | Testes automatizados e SQL com as migrations A/B/C; compatibilidade textual e de capas                 |
| Capas personalizadas        | Upload privado, quota, referência no rascunho e snapshot copiado apenas por publicação explícita                                              | Testes de capas e Worker isolado; regressão SQL de capas após C                                        |
| Editor visual               | Páginas ordenadas, substituição, remoção, recuperação, guiões privados e buffers por conta                                                    | SQL B e nove cenários reais de navegador com transporte simulado                                       |
| Leitor visual               | LTR/RTL, vertical, lotes, zoom, temas, progresso local e retirada                                                                             | SQL C e 12 cenários reais de navegador com transporte simulado                                         |

## Segurança e integridade

- SQL B valida RLS/proprietário, privilégios efetivos sob concessões padrão hostis, prova do Worker, revisões, repetição, rollback, quotas partilhadas e referências de assets.
- SQL C valida acesso anónimo apenas a snapshots públicos, projeções sem colunas técnicas, prova servidor para resolução R2, ordem imutável, guiões privados, retirada/republicação e proteção de assets ainda referenciados, incluindo snapshots retirados.
- Uploads: JPEG/PNG/WebP estático; capas até 5 MiB; páginas até 20 MiB, 40 MP, largura 16 384 e altura 65 535 px. Os limites remotos podem ser inferiores. Reservas contam para a quota; limpeza de órfãos exige carência e ausência de referências.
- Novos pedidos de imagens retiradas são recusados. Imagens/texto já descarregados não podem ser recuperados do dispositivo do leitor. A revalidação do leitor não apaga cópias existentes.
- Nenhum teste usou credenciais ou dados reais, executou SQL remoto, modificou Auth/RLS remoto ou publicou Worker/frontend.

## Problema encontrado e correção

A primeira execução geral terminou com 355 testes aprovados e uma falha em `scripts/visual-editor.test.tsx`: a expectativa ainda exigia o aviso antigo «F4.2-C/D». O componente já tinha sido corrigido em `44bf9d4`. O teste passou a fixar explicitamente a flag pública em `false` e verificar o aviso de ativação, o bloqueio e a preservação de guiões privados. Não foi necessário alterar o comportamento da aplicação.

## Resultados finais

- Testes automatizados: **356/356 aprovados**, após correção e repetição completa da bateria `npm test`.
- Navegador: **21/21**, editor 9/9 e leitor público 12/12, com transporte isolado, sem Supabase/R2 reais.
- SQL PGlite: **três suites aprovadas** — `validate-profile-f41.mjs`, `validate-visual-editor.mjs`, `validate-public-visual.mjs`. São bases descartáveis locais; as suites B/C incluem aplicação das migrations e compatibilidade anterior.
- `npm run typecheck`, `npm run build` e `git diff --check`: aprovados. Formatação verificada nos ficheiros desta entrega.
- Os cenários de navegador podem emitir avisos React de atualização fora de `act`; asserções passaram. Não representam certificação completa de acessibilidade.

## Estado remoto e condições para encerrar

O proprietário informou nesta conversa que aplicou `public_reading_enabled=true`. Houve também confirmações anteriores de funcionamento de Auth, avatares públicos e operações editoriais. São evidências reportadas pelo proprietário, não inspeções remotas desta revisão.

Não existe nesta sessão conector administrativo Supabase/Cloudflare/Vercel nem sessão de teste autorizada disponível. Não se presume que migrations, Worker e flags de produção sejam iguais ao repositório. Nenhuma flag foi alterada nesta tarefa.

Para encerrar operacionalmente, registar num ambiente autorizado, com duas contas e obras descartáveis:

1. Confirmar projeto Supabase `dlwsjfqijrsmwejsmuts`, migrations F4.1/A/B/C, RLS/permissões e quota efetivas. Consultar `SELECT id, public_reading_enabled FROM public.editorial_media_settings;`, sem repetir migrations instaladas.
2. Confirmar a versão do Worker e handlers de avatares, capas e editorial privado/público; verificar CORS e rejeição de acesso cruzado/genérico. Rever bindings e prova servidor sem copiar os seus valores para documentos ou logs.
3. Confirmar os valores efetivos das flags de produção: `VITE_ENABLE_CUSTOM_COVERS`, `VITE_ENABLE_VISUAL_EDITOR` e `VITE_ENABLE_PUBLIC_VISUAL_READER`. Não as ativar apenas com base nestes testes.
4. Conta A: criar/guardar/reabrir obra textual e visual, substituir/remover/reordenar páginas, publicar, editar o rascunho sem alterar o snapshot, atualizar explicitamente e verificar leitura anónima. Validar avatar/capa e persistência após nova sessão.
5. Conta B/anónimo: negar leituras e escritas privadas, uploads, alterações de propriedade e acesso direto por chave; verificar que guiões não aparecem no snapshot visual.
6. Retirar e verificar bloqueio de novos pedidos nas URLs antigas; republicar, arquivar apenas após retirada e restaurar sem perder páginas. Ensaiar conflito de revisão, repetição e falha de upload/resposta.
7. Confirmar quotas e limpeza somente de ficheiros descartáveis sem referências, preservando assets partilhados e snapshots. Registar resultados sem tokens ou dados pessoais.

Falhas nesses critérios bloqueiam o encerramento remoto e exigem correção direcionada. Não é necessário iniciar funcionalidades da Fase 5 para executar esta validação.

## Limitações não bloqueantes da baseline local

- Ficheiros selecionados e ainda não guardados não sobrevivem a recarga; existem buffers e avisos, mas não sincronização desses buffers.
- A remoção/substituição de avatar não inclui eliminação física dos objetos antigos; limpeza segura continua dependente do contrato do Worker.
- Biblioteca, favoritos, listas e progresso existentes são locais ao navegador/âmbito da conta; não são sincronização entre dispositivos.
- A relação de seguidores e contagem existem; seguir/deixar de seguir na interface, notificações e métricas ficam para a Fase 5.
- O plano da próxima fase está em [fase-5-plano.md](fase-5-plano.md). Não foi implementado nesta revisão.

Entrega preparada para commit, sem criar commit, push ou deploy.
