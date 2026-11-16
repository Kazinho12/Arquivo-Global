# F6.1 — Personalização global

## Entrega e limites

Implementação local de temas, editor visual/CSS controlado, região, idiomas de leitura e sincronização privada opcional. Não foram executados SQL remoto, alterações de segredos ou deploy manual. A sincronização real entre dispositivos permanece por validar no Supabase após instalação.

**Idiomas da interface:** apenas `pt-PT`, a interface de referência existente, está disponível. `pt-BR`, `pt-MZ`, `en`, `es` e `fr` têm catálogos iniciais incompletos e aparecem indisponíveis. Grande parte das mensagens F1–F5 ainda está diretamente nos componentes em português: a migração integral dessas mensagens para chaves e a revisão das cinco traduções continuam pendentes. Não basta ativar uma entrada na lista para declarar uma tradução completa. O catálogo mundial de idiomas não representa traduções disponíveis.

## Arquitetura

Um único `PersonalizationProvider` substitui o provider anterior de tema, preservando `useTheme`. A sessão é isolada por UUID/visitante. Os efeitos dentro do router aplicam tokens sem remontar formulários; `lang`/`dir` pertencem à interface, não à direção de leitura do mangá. As preferências locais dos leitores continuam independentes.

Rotas: `/definicoes/aparencia`, `/definicoes/aparencia/estudio`, `/definicoes/aparencia/recuperar` e `/definicoes/idioma`. Studio, dados mundiais e catálogos adicionais são carregados separadamente. O pequeno catálogo de referência permanece no bundle inicial. A infraestrutura inclui chaves tipadas, interpolação textual React, plurais e formatação `Intl` de datas/números, fallback explícito e estrutura RTL; nenhum idioma RTL está anunciado como traduzido.

Temas: Noite Estrelada (padrão), Rubi, Pôr do Sol, Aurora Dourada, Esmeralda, Oceano, Safira, Ametista, Sakura, Pergaminho, Minimalista, Alto Contraste, Claro, Escuro e Automático. Os ícones Lucide correspondem aos temas, sem emojis. Prévia isolada, comparação, histórico desfazer/refazer e confirmação explícita precedem a aplicação. Temas pessoais podem ser duplicados, renomeados, exportados e removidos.

## Tokens e CSS seguro

O editor aceita exclusivamente um bloco `:theme { ... }`. Não aceita folhas CSS arbitrárias. O parser percorre a estrutura, controla comentários, delimitadores e declarações; rejeita seletores adicionais, at-rules, strings, escapes, recursos remotos, propriedades desconhecidas e duplicadas. Limites: 12 KB e 60 declarações. Apenas o objeto normalizado é aplicado/persistido; o texto CSS nunca é injetado como stylesheet.

Tokens de cores: `--bg`, `--surface`, `--elevated`, `--text`, `--muted`, `--link`, `--button`, `--button-ink`, `--border`, `--accent`, `--focus`, `--success`, `--warning`, `--error`. HEX, RGB e HSL validados são normalizados para HEX de seis dígitos. Texto/estados/links precisam de razão 4.5:1 sobre as três superfícies; bordas/foco de 3:1 e texto/botão de 4.5:1. Isso não constitui certificação integral WCAG.

Os nomes e intervalos exatos dos tokens tipográficos e componentes estão em `skin.ts`/`themes.ts`, compartilhados com a validação do editor: fontes locais `sans|serif|mono`, tamanho 14–22 px, entrelinha 1.4–1.9, peso 500–800, letras 0–0.12 em, raios 0–24 px, bordas 1–3 px, espaçamento 0.85–1.3 e densidades enumeradas. O botão de exportar CSS produz a sintaxe canónica suportada. JSON usa o formato versionado `arquivo-global-theme`, até 16 KB, sem propriedades adicionais.

Autenticação e administração usam aparência oficial; skins pessoais não alteram perfis vistos por terceiros. A recuperação tem aparência oficial e restaura apenas a aparência, preservando região/idiomas e temas guardados. Cache ilegível é conservado numa chave de recuperação antes da substituição.

RGB inicia desligado. Os modos estático, suave e dinâmico afetam apenas pequenos elementos decorativos, bordas, ícones e destaques. Intensidade máxima 0.4, ciclos de pelo menos 10 s, sem flashes. Movimento reduzido e documento oculto desligam os efeitos. Existe controlo imediato para desligar. Texto literário, fundos do leitor e imagens não recebem RGB.

## Dados mundiais

- 249 países/territórios ISO 3166-1, extraídos de **iso-codes 4.16.0** (pacote local 4.16.0-1). [Projeto fonte](https://salsa.debian.org/iso-codes-team/iso-codes).
- 1 578 relações território/idioma de **Unicode CLDR JSON 48.2.0**, versão fixada, não anunciada como a mais recente. [Fonte versionada](https://github.com/unicode-org/cldr-json/tree/48.2.0).
- `territoryInfo.json`: `cldr-core/supplemental/territoryInfo.json`; nomes portugueses: `cldr-localenames-full/main/pt/languages.json` nessa versão.
- 800 códigos aceites de preferências de leitura, união dos dados CLDR, catálogo já existente e variantes portuguesas. Não são 800 traduções da interface.

Nomes de países usam `Intl.DisplayNames` com fallback ao nome ISO; nomes nativos só são mostrados quando suportados pelo navegador. Pesquisa aceita nomes, códigos alpha-2/alpha-3 e acentos. A classificação de cada relação conserva os rótulos CLDR oficial, regional, minoritária, de facto ou uso documentado. Estes dados não substituem fontes jurídicas atuais nem garantem cobertura de todas as línguas nacionais/sinalizadas; na ausência de nome traduzido, mostra-se o código, sem inventar denominações. Não há associação inferida de nacionalidade ou alteração automática de filtros de conteúdo.

Licenças e créditos acompanham `features/personalization/data/`: Unicode, copyright iso-codes e LGPL-2.1.

Atualização reproduzível, com os três ficheiros de origem já obtidos das versões acima:

```sh
npx tsx scripts/update-personalization-data.ts /caminho/iso_3166-1.json /caminho/territoryInfo.json /caminho/languages.json
```

O gerador é offline, não lê credenciais, não altera migrations e não instala dependências. Para uma nova versão, atualizar os metadados/versionamento, rever o diff, licenças, testes e as allowlists SQL numa **migration aditiva posterior** antes de disponibilizar novos códigos. Não reescrever SQL já aplicado.

## Persistência e concorrência

Local: chave `ag:personalization:v1:<UUID|guest>`, com envelope versionado. Só a sessão visitante pode aproveitar o antigo `ag.v2.theme`. Login não transfere dados anónimos; o utilizador pode importar explicitamente. A e B nunca partilham a mesma chave. Falhas de armazenamento são mostradas e não declaradas como gravação concluída.

Conta: `global_personalization(read|save)` verifica sessão/proprietário, usa Bearer atual e revisão CAS. UUID de operação é reutilizado na repetição de um pedido pendente. A interface só confirma sincronização após resposta do servidor. Edição durante um pedido mantém-se pendente; conflitos permitem recuperar a versão remota ou conciliar, preservando cópias locais de temas conflitantes, sem sobrescrever silenciosamente. Limite de 20 temas pessoais.

Migration: `20261116010000_global_personalization.sql`. Tabelas de preferências e recibos compactos de operação; RLS por proprietário, nenhuma escrita direta concedida, helpers sem execução pública, RPC apenas `authenticated`, `SECURITY DEFINER` com `search_path` vazio e nomes qualificados. A RPC deriva UUID de `auth.uid()`, valida forma/tamanho/enumerações/contraste, serializa por utilizador, limita 30 gravações confirmadas/minuto e preserva idempotência sem guardar snapshots duplicados no recibo. Os recibos não expiram nesta versão; acompanhar crescimento e definir retenção posterior sem enfraquecer a garantia de repetição.

## Instalação remota pendente

1. Confirmar projeto `dlwsjfqijrsmwejsmuts`, histórico e presença das migrations anteriores. Fazer o procedimento habitual de backup do proprietário.
2. Manter `VITE_ENABLE_GLOBAL_PERSONALIZATION=false` enquanto a migration não estiver instalada. Temas locais continuam disponíveis; nenhuma chamada a esta RPC é feita com a flag desligada.
3. Rever e executar manualmente o ficheiro SQL completo numa única transação. Não reaplicar se já existir.
4. Verificar objetos e permissões, sem incluir conteúdos pessoais nos resultados partilhados:

```sql
select to_regclass('public.global_personalization_preferences'),
       to_regclass('public.global_personalization_operations'),
       to_regprocedure('public.global_personalization(text,jsonb,bigint,uuid)');
select relname, relrowsecurity from pg_class
where oid in ('public.global_personalization_preferences'::regclass,
              'public.global_personalization_operations'::regclass);
select tablename, policyname, roles, cmd from pg_policies
where tablename in ('global_personalization_preferences','global_personalization_operations');
select has_function_privilege('anon','public.global_personalization(text,jsonb,bigint,uuid)','EXECUTE') as anon_rpc,
       has_function_privilege('authenticated','public.global_personalization(text,jsonb,bigint,uuid)','EXECUTE') as member_rpc,
       has_table_privilege('authenticated','public.global_personalization_preferences','UPDATE') as direct_update;
-- Esperado: false, true, false.
```

5. Só após revisão, configurar manualmente a flag como `true` no ambiente desejado e publicar o frontend pelo processo normal do projeto.
6. Usar duas contas de teste e dois dispositivos: guardar, recuperar, conciliar conflito e confirmar isolamento. Não declarar essa validação a partir dos mocks locais.

Reversão conservadora: desligar a flag e restaurar o tema oficial pela rota de recuperação. Preservar tabelas e preferências para recuperação; não fazer DROP nem apagar dados. Auth, perfis, R2, publicação e flags anteriores não são alterados por esta migration.

## Validação local

- 429 testes automatizados aprovados, incluindo 14 novos testes de personalização e três rotas.
- 16 cenários de navegador F6.1 aprovados: temas/ícones, editor, CSS malicioso, países/idiomas, persistência simulada, contas isoladas, conflito/rede, RGB, rotas protegidas, recuperação e 360/1280 px.
- Suíte PostgreSQL em memória F6.1 aprovada: contraste dos 15 temas, schemas/valores hostis, RLS/grants, proprietário, CAS/replay, quantidade e rate limit.
- Regressões SQL F5.2, F5.3 e F5.4 aprovadas. Dez cenários de navegador de leitura aprovados; o teste obsoleto das obras demonstrativas foi atualizado para exigir 404, preservando a remoção anterior desses conteúdos.
- Typecheck e build de produção aprovados. Chunks separados: entrada cerca de 178 KB, UI vendor 250 KB, editor rico existente 448 KB (valores sem gzip); nenhum chunk acima do limiar de aviso de 500 KB nesse build. Studio de temas e catálogo mundial separados.

Navegador testa transporte simulado; SQL usa PGlite local. Acessibilidade básica e responsividade verificadas não equivalem a auditoria assistiva completa. Migração integral das mensagens F1–F5, revisão linguística das traduções adicionais e validação remota real continuam pendentes.
