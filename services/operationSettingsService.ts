import { supabase } from './supabaseClient';
import {
  CampaignScheduleItem,
  CampaignScheduleStatus,
  HierarchyNote,
  LeaderZoneSummary,
  MemberProfile,
  UserRole,
  ZoneDirectoryEntry
} from '../types';

const HIERARCHY_TABLE = 'hierarquia_notas';
const TIMELINE_TABLE = 'cronogramas_operacao';
const MISSING_RECIPIENTS_CODE = 'MISSING_DEST_COLUMN';

type RawHierarchyNote = {
  id: string;
  role: UserRole;
  texto: string;
  versao: number;
  atualizado_em: string | null;
  created_at?: string;
  destinatarios?: string[] | null;
};

type RawTimelineEntry = {
  id: string;
  titulo: string;
  data: string;
  status: CampaignScheduleStatus | null;
  responsavel_id?: string | null;
  versao: number;
  created_at?: string;
};

const toHierarchyNote = (row: RawHierarchyNote): HierarchyNote => ({
  id: row.id,
  role: row.role,
  text: row.texto || '',
  updatedAt: row.atualizado_em || row.created_at || new Date().toISOString(),
  version: row.versao,
  recipients: row.destinatarios || null
});

const mapDbRoleToUserRole = (value?: string | null): UserRole => {
  if (!value) return UserRole.SOLDIER;
  const normalized = value.toUpperCase();
  switch (normalized) {
    case 'DIRECTOR':
    case 'DIRETOR':
      return UserRole.DIRECTOR;
    case 'LIDER_N1':
      return UserRole.L1;
    case 'LIDER_N2':
      return UserRole.L2;
    case 'LIDER_N3':
      return UserRole.L3;
    case 'LEADER':
      return UserRole.L3;
    case 'L1':
      return UserRole.L1;
    case 'L2':
      return UserRole.L2;
    case 'L3':
      return UserRole.L3;
    default:
      return UserRole.SOLDIER;
  }
};

const toTimelineEntry = (row: RawTimelineEntry): CampaignScheduleItem => ({
  id: row.id,
  date: row.data,
  title: row.titulo,
  status: row.status || 'PLANEJADO',
  responsibleId: row.responsavel_id || null
});

export const fetchHierarchyNotes = async (
  operationId: string
): Promise<{ notes: HierarchyNote[]; supportsRecipients: boolean }> => {
  if (!supabase) throw new Error('Supabase não configurado.');

  const runQuery = async (includeRecipients: boolean) =>
    supabase
      .from(HIERARCHY_TABLE)
      .select(
        includeRecipients
          ? 'id, role, texto, versao, atualizado_em, created_at, destinatarios'
          : 'id, role, texto, versao, atualizado_em, created_at'
      )
      .eq('operacao_id', operationId)
      .order('created_at', { ascending: false });

  const { data, error } = await runQuery(true);
  if (error) {
    const missingColumn =
      error.code === '42703' ||
      error.code === 'PGRST204' ||
      error.message?.toLowerCase().includes('destinatarios');
    if (!missingColumn) {
      throw error;
    }
    const fallback = await runQuery(false);
    if (fallback.error) throw fallback.error;
    return {
      supportsRecipients: false,
      notes: ((fallback.data || []) as RawHierarchyNote[]).map((row) => ({ ...toHierarchyNote(row), recipients: null }))
    };
  }

  if (!data || data.length === 0) {
    return { notes: [], supportsRecipients: true };
  }

  return { notes: (data as RawHierarchyNote[]).map(toHierarchyNote), supportsRecipients: true };
};

type CreateHierarchyNotePayload = {
  role: UserRole;
  text: string;
  recipients?: string[] | null;
};

export const createHierarchyNote = async (
  operationId: string,
  payload: CreateHierarchyNotePayload,
  options?: { supportsRecipients?: boolean }
): Promise<HierarchyNote> => {
  if (!supabase) throw new Error('Supabase não configurado.');

  const { data: latest } = await supabase
    .from(HIERARCHY_TABLE)
    .select('versao')
    .eq('operacao_id', operationId)
    .eq('role', payload.role)
    .order('versao', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (latest?.versao || 0) + 1;

  const body: Record<string, any> = {
    operacao_id: operationId,
    role: payload.role,
    texto: payload.text,
    versao: nextVersion,
    atualizado_em: new Date().toISOString()
  };
  if (options?.supportsRecipients !== false) {
    body.destinatarios = payload.recipients?.length ? payload.recipients : null;
  }

  const { data, error } = await supabase
    .from(HIERARCHY_TABLE)
    .insert(body)
    .select('id, role, texto, versao, atualizado_em, destinatarios')
    .single();

  if (error || !data) {
    const missingColumn =
      (error as any)?.code === '42703' ||
      (error as any)?.code === 'PGRST204' ||
      (error as any)?.message?.toLowerCase().includes('destinatarios');
    if (missingColumn) {
      const err = new Error('A coluna destinatarios não existe em hierarquia_notas.');
      (err as any).code = MISSING_RECIPIENTS_CODE;
      throw err;
    }
    throw error || new Error('Falha ao salvar nota.');
  }

  return toHierarchyNote(data as RawHierarchyNote);
};

export const deleteHierarchyNote = async (noteId: string) => {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { error } = await supabase.from(HIERARCHY_TABLE).delete().eq('id', noteId);
  if (error) throw error;
};

export const fetchOperationTimeline = async (
  operationId: string
): Promise<{ version: number; entries: CampaignScheduleItem[] }> => {
  if (!supabase) throw new Error('Supabase não configurado.');

  const { data, error } = await supabase
    .from(TIMELINE_TABLE)
    .select('id, titulo, data, status, responsavel_id, versao, created_at')
    .eq('operacao_id', operationId)
    .order('versao', { ascending: false })
    .order('data', { ascending: true });

  if (error) throw error;
  if (!data || data.length === 0) return { version: 0, entries: [] };

  const rows = data as RawTimelineEntry[];
  const latestVersion = rows[0]?.versao || 1;
  return {
    version: latestVersion,
    entries: rows.filter((row) => row.versao === latestVersion).map(toTimelineEntry)
  };
};

export const saveOperationTimeline = async (
  operationId: string,
  entries: CampaignScheduleItem[],
  userId?: string
): Promise<{ version: number; entries: CampaignScheduleItem[] }> => {
  if (!supabase) throw new Error('Supabase não configurado.');
  if (!entries.length) throw new Error('Informe ao menos um marco.');

  const { data: latest } = await supabase
    .from(TIMELINE_TABLE)
    .select('versao')
    .eq('operacao_id', operationId)
    .order('versao', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (latest?.versao || 0) + 1;
  const payload = entries.map((entry) => ({
    operacao_id: operationId,
    titulo: entry.title,
    data: entry.date,
    status: entry.status || 'PLANEJADO',
    responsavel_id: entry.responsibleId || userId || null,
    versao: nextVersion
  }));

  const { data, error } = await supabase
    .from(TIMELINE_TABLE)
    .insert(payload)
    .select('id, titulo, data, status, responsavel_id, versao, created_at');

  if (error || !data) throw error || new Error('Falha ao salvar cronograma.');

  const rows = data as RawTimelineEntry[];
  return { version: nextVersion, entries: rows.map(toTimelineEntry) };
};

export const fetchOperationMembers = async (operationId: string): Promise<MemberProfile[]> => {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase
    .from('membros')
    .select('id, nome, tipo, responsavel_id, telefone, cpf, pix, created_at, valordiaria, folhaponto')
    .eq('operacao_id', operationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.nome,
    role: mapDbRoleToUserRole(row.tipo),
    leaderId: row.responsavel_id || null,
    phone: row.telefone || null,
    cpf: row.cpf || null,
    pix: row.pix || null,
    createdAt: row.created_at || null,
    dailyRate: typeof row.valordiaria === 'number' ? row.valordiaria : row.valordiaria ? Number(row.valordiaria) : null,
    timesheet: row.folhaponto || null
  }));
};

type RawZoneWithLeaders = {
  id: string;
  nome: string;
  zona_lideres?: Array<{
    lider_id: string;
    membros?: { id: string; nome: string; tipo: UserRole } | null;
  }>;
  subzonas?: Array<{ id: string; nome: string }>;
};

export const fetchLeaderAssignments = async (operationId: string): Promise<LeaderZoneSummary[]> => {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase
    .from('zonas')
    .select('id, nome, zona_lideres(lider_id, membros:lider_id(id, nome, tipo))')
    .eq('operacao_id', operationId);

  if (error) throw error;
  if (!data) return [];

  const aggregated = new Map<string, LeaderZoneSummary>();
  (data as RawZoneWithLeaders[]).forEach((zone) => {
    zone.zona_lideres?.forEach((assignment) => {
      const leader = assignment.membros;
      if (!leader) return;
      if (!aggregated.has(assignment.lider_id)) {
        aggregated.set(assignment.lider_id, {
          leaderId: assignment.lider_id,
          leaderName: leader.nome,
          leaderRole: leader.tipo as UserRole,
          zones: []
        });
      }
      const entry = aggregated.get(assignment.lider_id);
      if (entry && !entry.zones.find((z) => z.id === zone.id)) {
        entry.zones.push({ id: zone.id, name: zone.nome });
      }
    });
  });

  return Array.from(aggregated.values());
};

export const fetchZoneDirectory = async (operationId: string): Promise<ZoneDirectoryEntry[]> => {
  if (!supabase) throw new Error('Supabase não configurado.');

  const { data, error } = await supabase
    .from('zonas')
    .select('id, nome, zona_lideres(lider_id), subzonas(id, nome)')
    .eq('operacao_id', operationId);

  if (error) throw error;
  if (!data) return [];

  return (data as RawZoneWithLeaders[]).map((zone) => {
    const leaderIds = (zone.zona_lideres || []).map((assignment) => assignment.lider_id);
    const subzones =
      zone.subzonas?.map((subzone) => ({
        id: subzone.id,
        name: subzone.nome,
        leaderIds
      })) || [];
    return {
      id: zone.id,
      name: zone.nome,
      leaderIds,
      subzones
    };
  });
};
