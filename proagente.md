# PROAGENTE

Documento de referência rápida para retomar o projeto IARGOS em novas sessões.

## Visão geral
- **Stack**: Vite + React (TS). Rotas via `HashRouter`.
- **Principais componentes**:
  - `App.tsx`: roteamento com páginas `Dashboard` (views `COMMAND`, `STRUCTURE`, `CRONOGRAMA`, `SETTINGS`, `FINANCE`, `TEAM`, `VOTERS`, `LEADER_TEAM`), `SubmissionForm`, `LeaderFeed`. A rota `/minha-equipe` aponta para a view exclusiva dos líderes e o fluxo antigo de “Vincular Líder” foi removido do router/Sidebar.
  - `Login.tsx`: autenticação separada para diretor (`/#/diretor`) e subordinados (`/#/`), usando `initialMode`/`lockMode`.
  - `Dashboard.tsx`: concentra os módulos (Comando Central, Estrutura & Avisos, Controle & Financeiro, Cronograma, Configurações, Expansão).
- **Serviços/config**: `services/operationSettingsService.ts`, `memberActivityService.ts` (folha de ponto + diárias), `locationService.ts`.

## Estrutura da base (Supabase)
- `operacoes`: operação ativa/inativa, `slug`, estado e vínculo com `diretor_id`; chave primária para filtrar todos os módulos.
- `diretores`: credenciais dos gestores (`usuario`, `senha_hash`, `telefone`), referenciados por `operacoes` e `membros`.
- `membros`: pessoas de cada operação (`tipo`/`member_role`, `responsavel_id`, contatos, `cpf`, `pix`, `valordiaria`, `folhaponto` em JSON); precisa de constraint única (`operacao_id + cpf`).
- `convites`: tokens emitidos por diretores (`tipo`, `token`, `expires_at`, consumo e `metadata`), usados no onboarding.
- `zonas` ↔ `subzonas`: recortes geográficos por operação (nome, descrição, `poligono_geojson`, `ordem`); cada subzona pode ter ações e líderes.
- `subzona_acoes`: tarefas registradas em uma subzona (data, título, descrição, `acao_status`, `responsavel_id`, observações).
- `zone_lideres`: ligação entre `membros` e `zonas`, guardando o `papel` exercido.
- `cronogramas_operacao`: agenda da operação (`titulo`, `data`, `status`, `responsavel_id`, `versao`).
- `hierarquia_notas`: notas/avisos por operação com `role` alvo, `texto`, versão e lista de `destinatarios` (array UUID).
- `submissoes`: relatos enviados em campo. Além dos campos textuais, inclui `midia_refs` (JSONB) armazenando anexos hospedados no bucket `iargosstorage` do Supabase Storage. Cada objeto guarda `id`, `name`, `path`, `size`, `mimeType` e `kind`. **SQL para coluna**:
  ```sql
  alter table public.submissoes add column if not exists midia_refs jsonb;
  ```

> Todas as consultas devem sempre filtrar por `operacao_id` para manter o isolamento multi-tenant e evitar colisões ao criar novas features.

## Estado atual (2024-xx-xx)
- Rotas públicas:
  - `/` → Login “Conectar” (Primeiro acesso / Já sou registrado).
  - `/diretor` → Login de diretores.
- Fluxo de onboarding salva CPF e chave PIX (colunas adicionadas em `membros`) e registra folha de ponto com geolocalização.
- Controle & Financeiro lista todos os membros (telefone com link WhatsApp, PIX copiável, edição de diárias, modal da folha de ponto).
- View “Minha Equipe” entrega aos líderes (N1/N2/N3) um painel focado na própria tropa: contagem de diretos/equipe total, tabela dos subordinados e resumo dos eleitores captados pela cadeia. A base de eleitores também é carregada para líderes, possibilitando alimentar os cards em tempo real sempre que eles registram contatos pelo formulário.
- Tela “Registros” substitui o antigo “Novo Registro”: líderes/soldados enviam relatos (texto + mídia) e visualizam apenas os próprios envios; o diretor visualiza todos com filtros por operador, tipo, contexto e datas. O painel mantém o formulário de envio fixo no topo para quem pode criar registros, e a lista traz carregamento de anexos sob demanda para poupar banda.
- Anexos de registros vão para o bucket `iargosstorage`, sempre dentro da pasta `operacao_id/membro_id/<arquivo>`. Para funcionar com a chave pública é obrigatório manter duas policies em `storage.objects`:
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
  Ajuste a validação das pastas quando incluirmos `operation_id` no JWT emitido pelo Supabase Auth.
- `DEV_NOTES.md` descreve funcionalidades atuais e backlog por perfil.

## Pontos de atenção
1. **Constraint pendente**: criar `ALTER TABLE membros ADD CONSTRAINT membros_operacao_cpf_key UNIQUE (operacao_id, cpf);` para o `upsert`.
2. **Backlog crítico**:
   - Registrar checkpoints automáticos de localização a cada 30 min.
   - Implementar upload de arquivos (reset do contador, exibir na folha de ponto).
   - Tornar o monitoramento (`/feed`) dinâmico (hoje é mock).
3. **Multi-tenant**: sempre filtrar consultas por `operacao_id` e, futuramente, habilitar RLS no Supabase.
4. **Documentos úteis**:
   - `DEV_NOTES.md`: estado do projeto e tarefas por perfil.
   - Este `proagente.md`: atualizar ao final de cada sessão com decisões importantes.

## Checklist ao retomar uma sessão
1. Ler `DEV_NOTES.md` e esta página para lembrar o contexto.
2. Verificar `git status` — há arquivos como `services/operationSettingsService.ts` que podem estar unstaged.
3. Confirmar `.env.local` (Supabase URL/KEY, tokens) se for testar convites/logins.
4. Revisar demandas do usuário e garantir que planos/pendências sejam atualizados nos docs.

## Próximos passos sugeridos (incompletos)
- Automatizar checkpoints na folha de ponto.
- Exibir dados reais no monitoramento e nos dashboards.
- Backend para uploads (com storage por operação).
- Testes e validação de constraints/migrações no Supabase.

> **Regra**: Sempre atualizar este arquivo antes de encerrar a sessão com novos aprendizados/decisões relevantes.
