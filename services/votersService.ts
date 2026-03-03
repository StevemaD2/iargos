import { supabase } from './supabaseClient';
import { VoterGender, VoterRecord, VoterSentiment } from '../types';

export interface CreateVoterPayload {
  name: string;
  phone: string;
  city?: string;
  neighborhood?: string;
  gender?: VoterGender | null;
  age?: number | null;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
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
  gender: (row.genero as VoterGender | null) || null,
  age: typeof row.idade === 'number' ? row.idade : row.idade ? Number(row.idade) : null,
  lat: typeof row.lat === 'number' ? row.lat : row.lat ? Number(row.lat) : null,
  lng: typeof row.lng === 'number' ? row.lng : row.lng ? Number(row.lng) : null,
  accuracy: typeof row.acuracia === 'number' ? row.acuracia : row.acuracia ? Number(row.acuracia) : null,
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
      'id, operacao_id, nome, telefone, cidade, bairro, genero, idade, lat, lng, acuracia, sentimento, conhece_candidato, voto_definido, desejos, zona_eleitoral, registrado_por_id, registrado_por_nome, created_at'
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
    genero: payload.gender || null,
    idade: typeof payload.age === 'number' ? payload.age : payload.age ? Number(payload.age) : null,
    lat: typeof payload.lat === 'number' ? payload.lat : payload.lat ? Number(payload.lat) : null,
    lng: typeof payload.lng === 'number' ? payload.lng : payload.lng ? Number(payload.lng) : null,
    acuracia: typeof payload.accuracy === 'number' ? payload.accuracy : payload.accuracy ? Number(payload.accuracy) : null,
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
      'id, operacao_id, nome, telefone, cidade, bairro, genero, idade, lat, lng, acuracia, sentimento, conhece_candidato, voto_definido, desejos, zona_eleitoral, registrado_por_id, registrado_por_nome, created_at'
    )
    .single();

  if (error) throw error;
  return mapRowToVoter(data);
};
