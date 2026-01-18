import { supabase } from './supabaseClient';
import { VoterRecord, VoterSentiment } from '../types';

export interface CreateVoterPayload {
  name: string;
  phone: string;
  city?: string;
  neighborhood?: string;
  sentiment?: VoterSentiment | null;
  knowsCandidate?: boolean | null;
  decidedVote?: boolean | null;
  wishes?: string;
  electoralZone?: string;
  recordedByName?: string;
}

const TABLE = 'eleitores';

const mapRowToVoter = (row: any): VoterRecord => ({
  id: row.id,
  operationId: row.operacao_id,
  name: row.nome,
  phone: row.telefone,
  city: row.cidade,
  neighborhood: row.bairro,
  sentiment: (row.sentimento as VoterSentiment | null) || null,
  knowsCandidate: row.conhece_candidato,
  decidedVote: row.voto_definido,
  wishes: row.desejos,
  electoralZone: row.zona_eleitoral,
  createdAt: row.created_at,
  recordedById: row.registrado_por_id || null,
  recordedByName: row.registrado_por_nome || null
});

export const fetchOperationVoters = async (operationId: string): Promise<VoterRecord[]> => {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      'id, operacao_id, nome, telefone, cidade, bairro, sentimento, conhece_candidato, voto_definido, desejos, zona_eleitoral, registrado_por_id, registrado_por_nome, created_at'
    )
    .eq('operacao_id', operationId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapRowToVoter);
};

export const createOperationVoter = async (
  operationId: string,
  payload: CreateVoterPayload,
  recordedById?: string
): Promise<VoterRecord> => {
  if (!supabase) throw new Error('Supabase não configurado.');
  const body: Record<string, any> = {
    operacao_id: operationId,
    nome: payload.name,
    telefone: payload.phone,
    cidade: payload.city || null,
    bairro: payload.neighborhood || null,
    sentimento: payload.sentiment || null,
    conhece_candidato: payload.knowsCandidate,
    voto_definido: payload.decidedVote,
    desejos: payload.wishes || null,
    zona_eleitoral: payload.electoralZone || null,
    registrado_por_id: recordedById || null,
    registrado_por_nome: payload.recordedByName || null
  };

  const { data, error } = await supabase
    .from(TABLE)
    .insert(body)
    .select(
      'id, operacao_id, nome, telefone, cidade, bairro, sentimento, conhece_candidato, voto_definido, desejos, zona_eleitoral, registrado_por_id, registrado_por_nome, created_at'
    )
    .single();

  if (error) throw error;
  return mapRowToVoter(data);
};
