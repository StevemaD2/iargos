import { supabase } from './supabaseClient';
import { Submission, SubmissionType, VoterInteraction } from '../types';

const TABLE = 'submissoes';

type SubmissionRow = {
  id: string;
  operacao_id: string;
  membro_id?: string | null;
  membro_nome?: string | null;
  tipo: SubmissionType;
  contexto: 'RUA' | 'DIGITAL' | 'MISTO';
  conteudo: string;
  interacao?: VoterInteraction | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  lat?: number | null;
  lng?: number | null;
  acuracia?: number | null;
  created_at: string;
};

const mapRowToSubmission = (row: SubmissionRow): Submission => ({
  id: row.id,
  userId: row.membro_id || 'desconhecido',
  userName: row.membro_nome || 'Operador',
  leaderChain: [],
  type: row.tipo,
  timestamp: row.created_at,
  geo: row.lat != null && row.lng != null
    ? { lat: row.lat, lng: row.lng, accuracy: row.acuracia ?? 0 }
    : { lat: 0, lng: 0, accuracy: 0 },
  locationDetails: {
    bairro: row.bairro || '',
    cidade: row.cidade || '',
    uf: row.uf || ''
  },
  context: row.contexto,
  missionId: undefined,
  content: row.conteudo,
  voterInteraction: row.interacao || undefined
});

export interface CreateSubmissionPayload {
  operationId: string;
  memberId: string;
  memberName: string;
  type: SubmissionType;
  context: 'RUA' | 'DIGITAL' | 'MISTO';
  content: string;
  interaction?: VoterInteraction;
  locationDetails?: { bairro?: string; cidade?: string; uf?: string };
  location?: { lat: number; lng: number; accuracy?: number } | null;
}

export const createSubmission = async (payload: CreateSubmissionPayload): Promise<Submission> => {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      operacao_id: payload.operationId,
      membro_id: payload.memberId,
      membro_nome: payload.memberName,
      tipo: payload.type,
      contexto: payload.context,
      conteudo: payload.content,
      interacao: payload.interaction || null,
      bairro: payload.locationDetails?.bairro || null,
      cidade: payload.locationDetails?.cidade || null,
      uf: payload.locationDetails?.uf || null,
      lat: payload.location?.lat ?? null,
      lng: payload.location?.lng ?? null,
      acuracia: payload.location?.accuracy ?? null
    })
    .select(
      'id, operacao_id, membro_id, membro_nome, tipo, contexto, conteudo, interacao, bairro, cidade, uf, lat, lng, acuracia, created_at'
    )
    .single();

  if (error || !data) {
    throw error || new Error('Não foi possível registrar o envio.');
  }

  return mapRowToSubmission(data as SubmissionRow);
};

export const fetchOperationSubmissions = async (operationId: string): Promise<Submission[]> => {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      'id, operacao_id, membro_id, membro_nome, tipo, contexto, conteudo, interacao, bairro, cidade, uf, lat, lng, acuracia, created_at'
    )
    .eq('operacao_id', operationId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data || []).map((row) => mapRowToSubmission(row as SubmissionRow));
};
