
export enum UserRole {
  DIRECTOR = 'DIRETOR',
  L1 = 'LIDER_N1',
  L2 = 'LIDER_N2',
  L3 = 'LIDER_N3',
  SOLDIER = 'SOLDADO'
}

export enum SubmissionType {
  AUDIO_ELEITOR = 'AUDIO_ELEITOR',
  FOTO_CASA_VISITADA = 'FOTO_CASA_VISITADA',
  VIDEO_DEPOIMENTO = 'VIDEO_DEPOIMENTO',
  TEXTO_RELATO = 'TEXTO_RELATO',
  PRINT_CONVERSA_DIGITAL = 'PRINT_CONVERSA_DIGITAL',
  LINK_POSTAGEM = 'LINK_POSTAGEM',
  CHECKIN_POSTO = 'CHECKIN_POSTO',
  CHECKOUT_POSTO = 'CHECKOUT_POSTO',
  OCORRENCIA = 'OCORRENCIA',
  MATERIAL_ENTREGUE = 'MATERIAL_ENTREGUE'
}

export enum VoterSentiment {
  POSITIVO = 'POSITIVO',
  NEUTRO = 'NEUTRO',
  NEGATIVO = 'NEGATIVO'
}

export enum IntentionVoto {
  JA_TEM_CANDIDATO = 'JA_TEM_CANDIDATO',
  EM_DUVIDA = 'EM_DUVIDA',
  APOIA_NOSSO = 'APOIA_NOSSO',
  REJEITA_NOSSO = 'REJEITA_NOSSO',
  NAO_QUER_FALAR = 'NAO_QUER_FALAR'
}

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface VoterInteraction {
  foi_atendido: 'BEM' | 'MAL' | 'NAO_ATENDEU';
  intencao_voto: IntentionVoto;
  temas_mencionados: string[];
  sentimento: VoterSentiment;
  principais_frases: string;
  objecoes: string[];
  oportunidades: string[];
  urgencia_followup: 'BAIXA' | 'MEDIA' | 'ALTA';
  observacoes: string;
}

export interface Submission {
  id: string;
  userId: string;
  userName: string;
  leaderChain: string[]; 
  type: SubmissionType;
  timestamp: string;
  geo: GeoPoint;
  locationDetails: {
    bairro: string;
    cidade: string;
    uf: string;
  };
  context: 'RUA' | 'DIGITAL' | 'MISTO';
  missionId?: string;
  content: string;
  voterInteraction?: VoterInteraction;
  aiClassification?: {
    theme: string;
    sentiment: VoterSentiment;
    risk: boolean;
  };
  attachments?: SubmissionAttachment[];
}

export type SubmissionAttachmentType = 'image' | 'audio' | 'video' | 'file';

export interface SubmissionAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  kind: SubmissionAttachmentType;
}

export type CampaignScheduleStatus = 'PLANEJADO' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'ATRASADO';

export interface CampaignScheduleItem {
  id?: string;
  date: string;
  title: string;
  status?: CampaignScheduleStatus;
  responsibleId?: string | null;
  responsibleName?: string | null;
}

export interface CampaignConfig {
  state: string;
  electionDate: string;
  schedule: CampaignScheduleItem[];
  version?: number;
}

export interface MemberProfile {
  id: string;
  name: string;
  role: UserRole;
  leaderId?: string | null;
  phone?: string | null;
  cpf?: string | null;
  pix?: string | null;
  createdAt?: string | null;
  dailyRate?: number | null;
  timesheet?: any;
}

export interface LeaderZoneSummary {
  leaderId: string;
  leaderName: string;
  leaderRole: UserRole;
  zones: { id: string; name: string }[];
}

export interface ZoneDirectoryEntry {
  id: string;
  name: string;
  leaderIds: string[];
  subzones: { id: string; name: string; leaderIds: string[] }[];
}

export interface HierarchyNote {
  id?: string;
  role: UserRole;
  text: string;
  updatedAt: string;
  version?: number;
  recipients?: string[] | null;
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  leaderId?: string;
  notesFromSuperior?: string;
  operationId?: string;
  operationName?: string;
  operationState?: string;
}

export interface VoterRecord {
  id: string;
  operationId: string;
  name: string;
  phone: string;
  city?: string | null;
  neighborhood?: string | null;
  sentiment?: VoterSentiment | null;
  knowsCandidate?: boolean | null;
  decidedVote?: boolean | null;
  wishes?: string | null;
  electoralZone?: string | null;
  recordedById?: string | null;
  recordedByName?: string | null;
  createdAt: string;
}
