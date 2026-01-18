import { supabase } from './supabaseClient';
import { Submission, SubmissionAttachment, SubmissionAttachmentType, SubmissionType, VoterInteraction } from '../types';

const TABLE = 'submissoes';
const STORAGE_BUCKET = 'iargosstorage';

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
  midia_refs?: SubmissionAttachment[] | null;
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
  voterInteraction: row.interacao || undefined,
  attachments: row.midia_refs || undefined
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
  attachments?: SubmissionAttachment[];
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
      acuracia: payload.location?.accuracy ?? null,
      midia_refs: payload.attachments?.length ? payload.attachments : null
    })
    .select(
      'id, operacao_id, membro_id, membro_nome, tipo, contexto, conteudo, interacao, bairro, cidade, uf, lat, lng, acuracia, created_at, midia_refs'
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
      'id, operacao_id, membro_id, membro_nome, tipo, contexto, conteudo, interacao, bairro, cidade, uf, lat, lng, acuracia, created_at, midia_refs'
    )
    .eq('operacao_id', operationId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data || []).map((row) => mapRowToSubmission(row as SubmissionRow));
};

const sanitizeFileName = (value: string) => value.replace(/[^a-zA-Z0-9.\-_]/g, '_') || 'arquivo';

const createLocalId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const getAttachmentKind = (mimeType: string): SubmissionAttachmentType => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
};

export const uploadSubmissionFiles = async (
  operationId: string,
  memberId: string,
  files: File[]
): Promise<SubmissionAttachment[]> => {
  if (!supabase) throw new Error('Supabase não configurado.');
  if (!files.length) return [];

  const uploads: SubmissionAttachment[] = [];

  for (const file of files) {
    const sanitized = sanitizeFileName(file.name || 'arquivo');
    const objectPath = `${operationId}/${memberId}/${createLocalId()}-${sanitized}`;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined
    });
    if (error) {
      const message = (error as any)?.message?.toLowerCase?.() || '';
      if (message.includes('row-level security')) {
        throw new Error(
          'Upload bloqueado pelas políticas do bucket. Verifique as regras RLS/Storage para liberar gravação por operação.'
        );
      }
      console.error('Upload error', error);
      throw new Error('Falha ao enviar arquivo. Tente novamente.');
    }
    uploads.push({
      id: createLocalId(),
      name: file.name,
      path: objectPath,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      kind: getAttachmentKind(file.type || '')
    });
  }

  return uploads;
};

export const createSignedAttachmentUrl = async (path: string, expiresInSeconds = 60 * 30) => {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw error || new Error('Não foi possível gerar o link do arquivo.');
  }
  return data.signedUrl;
};

export const fetchSubmissions = async ({
  operationId,
  memberId,
  limit = 200
}: {
  operationId: string;
  memberId?: string;
  limit?: number;
}): Promise<Submission[]> => {
  if (!supabase) throw new Error('Supabase não configurado.');
  let query = supabase
    .from(TABLE)
    .select(
      'id, operacao_id, membro_id, membro_nome, tipo, contexto, conteudo, interacao, bairro, cidade, uf, lat, lng, acuracia, created_at, midia_refs'
    )
    .eq('operacao_id', operationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (memberId) {
    query = query.eq('membro_id', memberId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => mapRowToSubmission(row as SubmissionRow));
};
