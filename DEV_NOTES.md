# Desenvolvimento IARGOS

## Diretor

### Já implementado
- Cadastro/edição de operação com Estado e slug automático (Configuração da Operação).
- Emissão, listagem e revogação de convites para líderes e soldados com histórico e monitoramento de quem emitiu.
- Estrutura e Avisos: lista de líderes com zonas, direcionamento de notas (por líder, zona, subzona ou membros) e histórico.
- Cronograma de campanha com versionamento, status por marco e edição inline.
- Controle e Financeiro: visão completa de membros (telefones com link WhatsApp, CPF, chave PIX copiada, diárias configuráveis, folha de ponto modal).
- Folha de ponto básica: login/logout de subordinados registrando horário e geolocalização.
- Página “Minha Equipe” (view `LEADER_TEAM`) entrega visão operacional para líderes: contagem de diretos/equipe total, tabela dos subordinados e resumo dos eleitores captados pela cadeia.
- Registros: diretoria consulta todos os envios com filtros por operador, tipo, datas e carregamento sob demanda dos anexos hospedados no Supabase Storage.
- Rotas dedicadas para login de diretor (`/diretor`) e para subordinados (`/`).

### Em andamento / pendente
- Registrar checkpoints automáticos a cada 30 min e reset quando houver envio de arquivos.
- Exibir arquivos e interações na folha de ponto (hoje apenas placeholder).
- Auditoria financeira (totais pagos, exportações, filtros por período).
- Painel de monitoramento (rota `/feed`) ainda usa dados mockados.
- Configurações adicionais da operação (limites, políticas) não existem.

## Líder

### Situação atual
- Consegue gerar convites para soldados e monitorar os criados por ele.
- Visualiza sua operação, zonas e notas dirigidas.
- Pode registrar novos soldados via QR/link.
- Acessa a página “Minha Equipe” para consultar subordinados diretos, totais da tropa e os eleitores captados pela rede, com dados filtrados automaticamente por `operation_id` e pela cadeia de liderança.
- Tela Registros unificada: líderes (e soldados) enviam relatos com foto/áudio/vídeo, acompanham seus próprios envios e podem baixar anexos com links temporários.

### Próximos passos
- Painel próprio dentro de “Controle e Financeiro” com escopo limitado aos seus subordinados (hoje o módulo é focado no diretor).
- Dashboard de campo com métricas reais (monitoramento ainda mockado).
- Interface para aprovar/encerrar folgas e acompanhar folha de ponto da própria equipe.
- Suporte ao upload/envio de arquivos das missões (para resetar contador de 30 min e alimentar relatórios).
- Definir política de upload no bucket `iargosstorage` com validação por pasta (`<operacao_id>/<membro_id>/arquivo`) para manter isolamento por operação.

## Soldado

### Situação atual
- Faz onboarding via link/QR fornecido pelo líder (Primeiro Acesso) informando telefone, CPF e chave PIX.
- Pode voltar usando apenas o CPF (“Já sou registrado”).
- Login registra automaticamente o ponto com localização.
- Fluxo de submissões (Zona Planner, formulários) existe, mas dados ainda são mockados em várias seções.

### Próximos passos
- Implementar de fato a coleta dos registros de campo no backend (hoje `mockData`).
- Controle de presença contínua (checkpoints automáticos, alertas quando ficar offline).
- Visão das notas dirigidas e confirmação de leitura.
- Canal para anexar arquivos (áudio, foto, vídeo) que alimentem tanto o monitoramento quanto a folha de ponto.

## Itens gerais pendentes
- Definir política de permissões para cada rota (por enquanto o App router só usa `user.role` para o sidebar).
- Configurar constraint única `membros(operacao_id, cpf)` para suportar o `upsert`.
- Criar serviço backend/cron para os checkpoints periódicos e armazenamento de arquivos.
- Documentar a estrutura das tabelas (cronogramas, hierarquia_notas, membros, convites etc.) e escrever migrações SQL oficiais.
- Supabase Storage: garantir as duas policies básicas do bucket `iargosstorage`:
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
  Ajustar o `split_part` quando passarmos a embutir `operation_id` / `member_id` no JWT.

Este documento deve ser atualizado conforme cada módulo evoluir para manter o time alinhado sobre entregas e backlog.
