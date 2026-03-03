# FlutterFor

Documento completo para reimplementar o app IARGOS em Flutter. Este arquivo descreve o que o app atual faz (web), incluindo fluxos, telas, regras, integrações, variáveis de ambiente e design. Use como prompt/guia para um agente que irá reconstruir a versão Flutter.

## Objetivo do produto
App operacional para campanhas políticas com papéis hierárquicos (Diretor, Líderes e Soldados). O sistema organiza operação, zonas geográficas, tarefas, registros de campo, eleitores e comunicação (chat), com foco em controle de campo e dados em tempo real.

## Stack atual (web)
- Frontend: React + TypeScript (Vite).
- Roteamento: `HashRouter`.
- UI: Tailwind (via CDN), Font Awesome, fonte Inter (Google Fonts).
- Backend: Supabase (Postgres + Storage + Edge Functions).
- Mapas: Mapbox GL + Mapbox Draw.
- IA: Gemini (Google GenAI) via API key. (Serviço existe, mas não está integrado na UI do dashboard atualmente.)

## Variáveis de ambiente (nomes, sem valores)
- `VITE_SUPABASE_URL` ou `NEXT_PUBLIC_SUPABASE_URL`: URL do projeto Supabase.
- `VITE_SUPABASE_ANON_KEY` ou `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`: chave pública Supabase.
- `VITE_MAPBOX_TOKEN`: token Mapbox para Zone Planner.
- `GEMINI_API_KEY` (mapeado para `process.env.API_KEY` e `process.env.GEMINI_API_KEY`): chave da API Gemini.

## Convenções e chaves locais
- `localStorage`:
  - `iargos_user`: usuário logado (JSON).
  - `iargos_last_location_ping`: timestamp do último ping de localização (string ISO).

## Papéis (roles)
- `DIRETOR` (Director).
- `LIDER_N1` (L1).
- `LIDER_N2` (L2).
- `LIDER_N3` (L3).
- `SOLDADO` (Soldier).

## Permissões por role (menu)
- `Comando Central` (`/`): todos.
- `Monitoramento` (`/feed`): L1/L2/L3/DIRETOR (Soldado não acessa).
- `Minha Equipe` (`/minha-equipe`): L1/L2/L3.
- `Expansão de Equipe` (`/team`): L1/L2/L3/DIRETOR.
- `Estrutura e Avisos` (`/estrutura`): DIRETOR.
- `Cronograma` (`/cronograma`): DIRETOR.
- `Controle e Financeiro` (`/financeiro`): DIRETOR.
- `Chat` (`/chat`): todos.
- `Eleitores` (`/eleitores`): todos.
- `Configurações` (`/configuracoes`): DIRETOR.
- `Registros` (`/report`): todos.

## Rotas principais
- `/`: Login/Conectar (subordinados).
- `/diretor`: Login do diretor.
- `/santinho/:slug`: Santinho digital público.
- `/`: Dashboard do diretor após login (view Comando Central).
- `/estrutura`: Dashboard view Estrutura & Avisos + Zone Planner.
- `/cronograma`: Dashboard view Cronograma.
- `/configuracoes`: Dashboard view Configurações da operação/candidato.
- `/financeiro`: Dashboard view Controle & Financeiro.
- `/team`: Dashboard view Expansão de Equipe.
- `/minha-equipe`: Dashboard view Minha Equipe.
- `/eleitores`: Dashboard view Eleitores.
- `/report`: Tela Registros (relatos de campo + mídia).
- `/feed`: Monitoramento (real, com dados do Supabase e refresh periódico).
- `/chat`: Página de Chat.

## Layout e design (UI atual)
- Estilo geral: interface “tática”/operacional, com cards, bordas suaves, cantos arredondados, sombras leves.
- Paleta principal:
  - Primária: indigo (`#4338ca`).
  - Secundária (fundo app): slate escuro (`#0f172a`).
  - Background base das páginas: `#f8fafc` (slate-50).
- Tipografia: Inter (300–700).
- Ícones: Font Awesome 6.
- Sidebar fixa no desktop com navegação vertical, acento indigo e estados ativos destacados.
- No mobile: header compacto + menu lateral em drawer (overlay). O drawer fecha ao clicar fora.
- Sidebar contém widget de contagem regressiva eleitoral (dias/semanas).
- Cards e blocos: `rounded-xl` / `rounded-2xl`, com bordas `slate-200`.
- Botões: cores sólidas (indigo, slate), foco em contraste.
- Input padrão: borda leve, cantos arredondados, texto pequeno.

## Arquitetura e estrutura de dados (Supabase)
### Tabelas principais
- `operacoes`: operação ativa/inativa, `slug`, estado, `diretor_id`, dados do candidato (`candidate_*`) e tema (`theme_primary_color`, `theme_secondary_color`, `campaign_type`).
- `diretores`: credenciais do diretor (`usuario`, `senha_hash`, `telefone`).
- `membros`: pessoas da operação (`tipo`/`member_role`, `responsavel_id`, contato, `cpf`, `pix`, `valordiaria`, `folhaponto` JSON, `last_location`, `last_location_at`).
- `convites`: tokens de convite (`tipo`, `token`, `expires_at`, `consumido_em`, `consumido_por`, `metadata`, `emitido_por`).
- `zonas`: zonas estratégicas (nome, descrição, cor, polígono geojson, ordem).
- `subzonas`: recortes dentro de zonas (nome, descrição, ordem, polígono geojson).
- `subzona_acoes`: tarefas ligadas a zona/subzona (data, título, descrição, status, responsável, observações).
- `zona_lideres`: vínculo entre líderes e zonas.
- `cronogramas_operacao`: agenda da operação (título, data, status, responsável, versão).
- `hierarquia_notas`: notas/avisos por role, com versão e destinatários.
- `eleitores`: base de eleitores (nome, telefone, bairro/cidade, sentimento, conhece candidato, voto definido, desejos, zona eleitoral, registrado_por).
- `submissoes`: relatos de campo com `midia_refs` (JSONB) para anexos.
- `chats`: canais (GLOBAL, ZONAL, DIRECT).
- `chat_members`: vínculo membros<->chats diretos.
- `chat_messages`: mensagens atuais.
- `chat_messages_archive`: mensagens arquivadas.
- `chat_messages_all`: view para busca global.

### Constraint crítica
- `membros(operacao_id, cpf)` deve ser UNIQUE para suportar upsert seguro.

## Edge Functions (Supabase)
### `chat`
- Ações: `getChatList`, `getChatMessages`, `getChatArchive`, `sendMessage`, `globalSearch`.
- Controla acesso por `operacao_id` e role.
- Chats:
  - GLOBAL: todo mundo na operação.
  - ZONAL: líderes/chain de liderança conectados às zonas.
  - DIRECT: 1:1 entre membros; diretor pode abrir com qualquer membro.
- Regras principais:
  - Director vê todos os chats.
  - Líderes e soldados veem global + zonais da sua cadeia + diretos onde são membros.
  - Histórico só para líderes/diretor em chats não diretos.
  - Busca global somente líderes/diretor.

### `archive-chat`
- Esperada: chama RPC `archive_chat_messages` para mover mensagens para arquivo.
- Observação: não há chamada direta a esta função no frontend atual.

## Serviços (frontend)
- `supabaseClient`: cria cliente com URL + chave pública.
- `locationService`: usa geolocalização do navegador.
- `memberActivityService`:
  - `recordMemberTimesheetEvent`: registra login/logout e geolocalização em `folhaponto` (JSON).
  - `updateMemberDailyRate`: salva diária do membro.
  - `updateMemberLastLocation`: atualiza localização atual e timestamp.
- `submissionsService`:
  - `createSubmission`, `fetchSubmissions`, `fetchOperationSubmissions`.
  - `uploadSubmissionFiles`: upload para bucket `iargosstorage`.
  - `createSignedAttachmentUrl` para baixar anexos.
- `votersService`: `fetchOperationVoters`, `createOperationVoter`.
- `operationSettingsService`: notas hierárquicas, cronograma, membros, líderes por zona.
- `chatService`: chama Edge Function `chat`.
- `geminiService`: analisa submissões com Gemini, retorna JSON com resumo/temas/briefing. (Não utilizado no UI atual.)

## Regras e fluxos principais
### Login do Diretor
- Tela dedicada `/diretor`.
- Busca em `diretores` por username (pode ser `usuario`, `user`, `User`).
- Compara senha simples (sem hash real no frontend).
- Se autenticado, tenta buscar operação vinculada em `operacoes`.

### Login/Onboarding de subordinados
- Tela `/` com dois fluxos:
  - Primeiro acesso: token de convite + nome + telefone + CPF + PIX.
  - Já sou registrado: CPF.
- Convite validado por `convites.token` e `expires_at`.
- Registra ou atualiza membro em `membros`.
- Captura localização e registra ponto (login).

**Formato do link de convite (web atual)**:
- `#/login?token=<TOKEN>` (HashRouter).
- Token também pode vir como URL completa; o app tenta extrair `token` de `?token=`, `?code=` ou `?data=` e, se não houver, usa o último segmento do path.

**Mapeamento de roles (login)**:
- `convites.tipo = 'LEADER'` → usuário entra como `LIDER_N3` (L3).
- `convites.tipo = 'SOLDIER'` → usuário entra como `SOLDADO`.
- No login por CPF, `membros.tipo` aceita variações: `L1`, `L2`, `L3`, `LIDER_N1`, `LIDER_N2`, `LIDER_N3`, `LEADER`.

**Upsert de membro (primeiro acesso)**:
- `membros.upsert` com `onConflict: operacao_id, cpf`.
- Campos usados: `operacao_id`, `diretor_id`, `tipo`, `nome`, `telefone`, `convite_token`, `cpf`, `pix`, `responsavel_id`.

### Folha de ponto
- Login/Logout registra sessões com localização.
- Armazenado como JSON em `membros.folhaponto`.
- Checkpoint automático de localização a cada 5 minutos, com janela de 30 minutos.
**Formato do JSON**:
```json
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "sessions": [
        {
          "loginAt": "ISO",
          "loginLocation": { "lat": 0, "lng": 0, "accuracy": 0 },
          "logoutAt": "ISO",
          "logoutLocation": { "lat": 0, "lng": 0, "accuracy": 0 }
        }
      ]
    }
  ]
}
```

### Submissões/Registros de campo
- Quem pode criar: líderes/soldados.
- Formulário com:
  - Tipo de submissão (enum).
  - Contexto (RUA/DIGITAL/MISTO).
  - Conteúdo textual.
  - Campos de interação do eleitor (sentimento, intenções, frases, objeções, oportunidades).
  - Geolocalização obrigatória.
  - Anexos (imagem/áudio/vídeo) até 15MB.
- Uploads via Supabase Storage `iargosstorage`:
  - Path: `<operacao_id>/<membro_id>/<uuid>-<arquivo>`.
- Tipos de mídia aceitos: `image/*`, `audio/*`, `video/*`.
- Estrutura do anexo:
  - `id`, `name`, `path`, `size`, `mimeType`, `kind` (`image|audio|video|file`).
- Diretor vê todas as submissões da operação com filtros.
- Líder/soldado vê apenas as próprias.

### Eleitores
- CRUD básico (criar + listar).
- Sentimento, conhece candidato, voto definido, desejos, zona eleitoral.
- Líderes veem subset filtrado por cadeia de liderança (no dashboard).
- Exportação CSV disponível na UI (web).

### Comando Central (dashboard)
- KPIs e gráficos (Recharts): sentimento, bairros, totais.
- Serviço Gemini existe, mas não está integrado na UI do dashboard atualmente.

### Estrutura & Avisos
- Gestão de zonas/subzonas (Mapbox Draw).
- Atribuição de líderes por zona.
- Ações por subzona (planejado/em andamento/concluído/cancelado).
- Exibe localização de membros (pins) quando disponível.

### Cronograma
- Agenda por operação com status e versão.
- Responsável opcional por item.

### Controle & Financeiro
- Lista membros com:
  - Telefone com link WhatsApp.
  - CPF, chave PIX copiável.
  - Diária editável.
  - Acesso à folha de ponto.

### Minha Equipe
- Dashboard focado em líderes (L1/L2/L3):
  - Contagem de diretos e total da cadeia.
  - Tabela de subordinados.
  - Resumo de eleitores captados pela rede.

### Expansão de equipe
- Emissão de convites por link, listagem e revogação.

### Chat
- Lista de chats (global, zonal, diretos).
- Busca global para líderes/diretor.
- Abre chat 1:1.
- Polling a cada 5s para novas mensagens.
- Diretor pode acessar chats diretos de outros (somente leitura quando não é participante).
 - Aba de histórico aparece apenas para chats não-diretos e somente para líder/diretor.

### Santinho digital
- Página pública com dados do candidato, imagem, links e tema (cores da operação).
**Link público**:
- `#/santinho/<slug>` (HashRouter).

### Monitoramento
- Rota `/feed` com dados reais e refresh periódico.
  - Intervalo: 5 minutos (contador regressivo).
  - Diretor vê tudo.
  - Líderes veem apenas submissões da própria cadeia de liderança.
  - Soldado não tem acesso (tela de aviso).

## Políticas Supabase Storage
Necessárias para uploads/downloads públicos com chave anônima:
```sql
create policy "iargos uploads"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'iargosstorage'
  and split_part(name, '/', 1) <> ''
  and split_part(name, '/', 2) <> ''
);

create policy "iargos downloads"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'iargosstorage');
```

## Detalhamento por tela (ultra detalhado)

### 1) Tela Login / Conectar (`/`)
**Objetivo**: autenticar subordinados e realizar primeiro acesso via convite.

**Estados e modos**:
- `choice`: escolha entre “Diretor” e “Conectar”.
- `connect`: fluxo de subordinados.
- `director`: redireciona para `/diretor` quando selecionado (ou outro modo com `lockMode`).
- `connectVariant`: `first` (primeiro acesso) ou `existing` (já sou registrado).

**Campos**:
- Primeiro acesso:
  - `connectToken` (token do convite ou URL que contém token).
  - `connectName`.
  - `connectPhone`.
  - `connectCpf` (sanitiza para apenas números).
  - `connectPix`.
- Já sou registrado:
  - `returnCpf`.

**Regras e validações**:
- Convite obrigatório no primeiro acesso.
- CPF obrigatório em ambos os fluxos.
- Mensagens de status:
  - `Convite expirado`.
  - `Convite não encontrado`.
  - `Token inválido`.
  - `Configure o Supabase URL/KEY no .env.local`.
- Geolocalização coletada durante login para registrar ponto.

**Ações**:
- Primeiro acesso:
  - Buscar convite em `convites`.
  - Validar expiração.
  - Criar/atualizar membro em `membros`.
  - Registrar ponto (login) via `recordMemberTimesheetEvent`.
  - Atualizar última localização.
- Já sou registrado:
  - Buscar membro por CPF.
  - Autenticar, registrar ponto e carregar operação.

**Saídas**:
- Define `user` no localStorage (`iargos_user`).
- Redireciona para `/` (dashboard).

### 2) Tela Login Diretor (`/diretor`)
**Objetivo**: autenticar diretor.

**Campos**:
- `directorUser`.
- `directorPassword`.

**Regras e validações**:
- Busca por `usuario`, `user`, `User` em `diretores`.
- Senha comparada diretamente (sem hash no frontend).
- Mensagens:
  - `Usuário não encontrado`.
  - `Usuário ou senha inválidos`.

**Saídas**:
- Define `user` com `role = DIRETOR`.
- Tenta buscar operação do diretor em `operacoes`.

### 3) Layout principal + Sidebar (todas as páginas autenticadas)
**Objetivo**: navegação e identidade da operação.

**Desktop**:
- Sidebar fixa com:
  - Logo IARGOS.
  - Role do usuário.
  - Widget de contagem regressiva eleitoral.
  - Menu de navegação com ícones.
  - Card do usuário + botão sair.

**Mobile**:
- Header compacto com:
  - Botão de menu (hamburger).
  - Identidade (IARGOS + role).
  - Avatar inicial do usuário.
- Drawer lateral:
  - Mesmo conteúdo da sidebar.
  - Fecha ao clicar fora.

**Regras de permissões no menu**:
- Itens filtrados por `role`.

### 4) Dashboard – Comando Central (`/` view COMMAND)
**Objetivo**: visão executiva da operação.

**Blocos**:
- KPIs gerais (contagem de submissões e sentimento).
- Gráficos (Recharts):
  - Sentimento de eleitores.
  - Distribuição por bairro/cidade.

**IA Gemini**:
- Serviço existe no frontend, porém não está integrado à UI do dashboard atualmente.

**Entradas**:
- Dados de `submissoes` filtrados por `operacao_id`.

### 5) Dashboard – Estrutura & Avisos (`/estrutura`)
**Objetivo**: gerir estrutura operacional e notas.

**Seções**:
- Avisos por role:
  - Notas direcionadas por função e destinatários.
  - Versionamento de notas.
- Zone Planner:
  - Gestão de zonas e subzonas.
  - Desenho de polígonos.
  - Atribuição de líderes.
  - Ações por subzona.
  - Pins de localização de membros.

### 6) Dashboard – Zone Planner (detalhe)
**Mapa**:
- Mapbox com Draw.
- Cores por zona.
- Ajuste de viewport automático para encaixar polígonos.

**Formulários**:
- Zona: nome, descrição, cor.
- Subzona: nome, descrição.
- Ação: data, título, descrição, status, responsável, observações.

**Regras**:
- Zones/subzonas salvas com GeoJSON.
- Ações podem ser vinculadas a subzona ou zona geral.
- Exibir membros com localização em tempo real (último ping).

### 7) Dashboard – Cronograma (`/cronograma`)
**Objetivo**: calendário da operação.

**Campos por item**:
- Data.
- Título.
- Status (Planejado, Em andamento, Concluído, Atrasado).
- Responsável (nome/ID).

**Regras**:
- Versionamento global do cronograma.
- Atualização salva em `cronogramas_operacao`.

### 8) Dashboard – Configurações (`/configuracoes`)
**Objetivo**: configurar operação e candidato.

**Campos principais**:
- Nome da operação.
- Estado.
- Tipo de campanha (Deputado Estadual/Federal, Senador, Governador).
- Dados do candidato:
  - Nome, número, partido.
  - Frase/Discurso.
  - Destaques.
  - Links sociais e outros links.
  - Foto.
- Tema do santinho:
  - Cor primária.
  - Cor secundária.

**Saídas**:
- Atualiza `operacoes`.
- Atualiza preview do santinho.
- Atualiza tema em CSS vars: `--iargos-brand-primary` e `--iargos-brand-secondary`.

### 9) Dashboard – Controle & Financeiro (`/financeiro`)
**Objetivo**: gestão de equipe e diárias.

**Lista de membros**:
- Nome.
- Telefone (link WhatsApp).
- CPF.
- PIX (copiar).
- Diária (editável).
- Botão “Folha de ponto”.

**Folha de ponto**:
- Modal com sessões (login/logout + localização).
- Visualização dos registros por data.

### 10) Dashboard – Minha Equipe (`/minha-equipe`)
**Objetivo**: visão de líderes.

**Blocos**:
- Métricas: diretos, total na cadeia.
- Tabela de subordinados diretos.
- Resumo dos eleitores captados pela cadeia.

### 11) Dashboard – Eleitores (`/eleitores`)
**Objetivo**: cadastro e acompanhamento da base.

**Formulário de eleitor**:
- Nome.
- Telefone.
- Cidade.
- Bairro.
- Sentimento.
- Conhece candidato (sim/não).
- Voto definido (sim/não).
- Desejos.
- Zona eleitoral.

**Lista**:
- Mostra eleitores da operação (filtrado por cadeia para líderes).

### 12) Dashboard – Expansão de Equipe (`/team`)
**Objetivo**: gerar convites e expandir time.

**Funções**:
- Criar convite para líder/soldado.
- Definir se convite é permanente.
- Listar convites emitidos.
- Revogar convites.
- Geração de link.

**Regras atuais (web)**:
- Convites permanentes usam `expires_at = 2099-12-31T23:59:59.999Z`.
- `metadata.reutilizavel = true`.
- `emitido_por`:
  - Diretor: `null`.
  - Líder: `user.id` (líder que gerou para soldados).
- Revogação: atualiza `expires_at` para `now()`.

### 13) Tela Registros (`/report`)
**Objetivo**: envio e histórico de submissões.

**Formulário**:
- Tipo de submissão (enum `SubmissionType`).
- Contexto (RUA/DIGITAL/MISTO).
- Bairro, cidade, UF.
- Texto do relato.
- Interação do eleitor (estrutura detalhada).
- Upload de anexos (imagem/áudio/vídeo, até 15MB).

**Validações**:
- GPS obrigatório.
- Arquivos max 15MB.
- Apenas tipos de mídia permitidos.

**Lista**:
- Diretor vê tudo com filtros por operador, tipo, contexto e data.
- Líder/soldado vê apenas seus envios.
- Botão para carregar anexos sob demanda (signed URLs).

### 14) Tela Chat (`/chat`)
**Objetivo**: comunicação interna.

**Coluna esquerda**:
- Busca global (somente diretor e líderes).
- Criar chat direto (select de membros permitidos).
- Lista de chats (global, zonal, diretos).

**Coluna direita**:
- Mensagens em balões.
- Indicador de mensagens do diretor com cor distinta.
- Tabs de “Atual” e “Histórico” para chats não diretos.
- Input com textarea + botão enviar.

**Regras**:
- Diretor pode ver chats diretos de outros em modo somente leitura.
- Polling de mensagens a cada 5s.

### 15) Tela Santinho (`/santinho/:slug`)
**Objetivo**: página pública de campanha.

**Conteúdo**:
- Foto do candidato.
- Nome, número, partido.
- Frase de campanha.
- Destaques.
- Links sociais.
- Tema com cores da operação.

### 16) Tela Monitoramento (`/feed`)
**Objetivo**: monitoramento operacional.
- Dados reais com filtros e refresh periódico.
- Escopo:
  - Diretor: vê todos.
  - Líder: vê apenas membros da sua cadeia (`membros.responsavel_id`).
  - Soldado: sem acesso.

## Modo Web vs Modo App (Flutter)
### Web atual
- HashRouter, estado local em `localStorage`.
- Geolocalização via navegador.
- Uploads via `File` e Supabase Storage.

### Flutter (alvo)
- Navegação com `go_router` ou `Navigator 2.0`.
- Estado local persistente (`shared_preferences`).
- Geolocalização via `geolocator`.
- Uploads via `supabase_flutter` e picker nativo.
- Mapbox: `mapbox_maps_flutter` ou `flutter_map` com Mapbox tiles.
- Substituir polling de chat por stream/realtime se possível.

## Requisitos de segurança e multi-tenant
- Todas as queries filtram por `operacao_id`.
- Edge Function valida `operacao_id` e membership.
- RLS ainda pendente no Supabase.

## Backlog crítico (para Flutter já nascer melhor)
- Monitoramento `/feed` com insights mais avançados (já existe feed real).
- Auditoria financeira avançada.
- RLS completo no Supabase + JWT com `operation_id`.

## Requisitos de compatibilidade
- Suporte mobile prioritário (layout responsivo, drawer menu).
- Web responsivo também.
- Modo offline: pelo menos cache de usuário e telas básicas.

## Itens implementados no projeto web que devem entrar no Flutter
- Exportação de eleitores para CSV na tela de Eleitores.
- Convites permanentes com `expires_at` muito no futuro e `metadata.reutilizavel = true`.
- Monitoramento `/feed` com filtros e refresh periódico real.

## Itens existentes no repositório, mas não usados no app atual
- Componentes `QRGenerator` e `QRScanner` existem no código, mas não estão ligados a rotas nem a telas do app.

## Observações finais
- O app atual usa padrões de UI padronizados por Tailwind. Em Flutter, replicar com tema customizado, `ThemeData` com cores e tipografia Inter.
- O fluxo de login do diretor usa comparação simples de senha no frontend (repensar em Flutter). Ideal mover autenticação para Supabase Auth.
- A implementação Flutter deve manter as tabelas, nomes e regras atuais para compatibilidade com Supabase.
- Se precisar de referência fiel do comportamento atual, consulte o projeto web nesta pasta `/Users/asterdefi/Documents/iargos`.
