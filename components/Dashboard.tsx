
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  User,
  UserRole,
  Submission,
  VoterSentiment,
  CampaignConfig,
  HierarchyNote,
  CampaignScheduleStatus,
  MemberProfile,
  LeaderZoneSummary,
  ZoneDirectoryEntry,
  GeoPoint,
  VoterRecord
} from '../types';
import { analyzeSubmissions } from '../services/geminiService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { supabase } from '../services/supabaseClient';
import ZonePlanner from './ZonePlanner';
import SantinhoCard from './SantinhoCard';
import { fetchOperationVoters, createOperationVoter } from '../services/votersService';
import { fetchOperationSubmissions } from '../services/submissionsService';
import {
  fetchHierarchyNotes,
  createHierarchyNote,
  deleteHierarchyNote,
  fetchOperationTimeline,
  saveOperationTimeline,
  fetchOperationMembers,
  fetchLeaderAssignments,
  fetchZoneDirectory,
  MISSING_TIMELINE_RESPONSIBLE_COLUMN
} from '../services/operationSettingsService';
import { STATE_METADATA } from '../constants/states';
import {
  updateMemberDailyRate,
  normalizeTimesheet,
  TimesheetData
} from '../services/memberActivityService';

type DashboardView = 'COMMAND' | 'TEAM' | 'STRUCTURE' | 'CRONOGRAMA' | 'SETTINGS' | 'FINANCE' | 'VOTERS';
type FinanceRoleFilter = 'ALL' | UserRole;

interface DashboardProps {
  user: User;
  view?: DashboardView;
}

const CAMPAIGN_TYPE_OPTIONS = [
  { value: 'DEPUTADO_ESTADUAL', label: 'Deputado Estadual' },
  { value: 'DEPUTADO_FEDERAL', label: 'Deputado Federal' },
  { value: 'SENADOR', label: 'Senador' },
  { value: 'GOVERNADOR', label: 'Governador' }
] as const;

type CampaignTypeValue = (typeof CAMPAIGN_TYPE_OPTIONS)[number]['value'];

type OperationRecord = CandidateSeed & {
  id: string;
  nome?: string | null;
  estado?: string | null;
  diretor_id?: string | null;
  slug?: string | null;
  campaign_type?: CampaignTypeValue | null;
};

const OPERATION_SELECT_FIELDS =
  'id, nome, estado, slug, diretor_id, campaign_type, candidate_name, candidate_number, candidate_party, candidate_social_links, candidate_speech, candidate_other_links, candidate_photo_url, candidate_highlights, candidate_santinho_url, theme_primary_color, theme_secondary_color';

const PERMANENT_INVITE_EXPIRATION = '2099-12-31T23:59:59.999Z';

interface InviteSnapshot {
  id: string;
  token: string;
  tipo: 'LEADER' | 'SOLDIER';
  emitido_por?: string | null;
  expires_at: string | null;
  created_at: string;
  consumido_por?: string | null;
  consumido_em?: string | null;
}

const formatInviteExpiration = (value: string | null) => {
  if (!value) return 'Sem expiração';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Data inválida';
  if (parsed.getFullYear() >= 2099) return 'Sem expiração';
  return parsed.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const NOTE_ROLES = [UserRole.L1, UserRole.L2, UserRole.L3, UserRole.SOLDIER];

type NoteScopeOption = 'ALL' | 'BY_LEADER' | 'BY_ZONE' | 'BY_MEMBER';

const SCHEDULE_STATUS_OPTIONS: { label: string; value: CampaignScheduleStatus }[] = [
  { label: 'Planejado', value: 'PLANEJADO' },
  { label: 'Em andamento', value: 'EM_ANDAMENTO' },
  { label: 'Concluído', value: 'CONCLUIDO' },
  { label: 'Atrasado', value: 'ATRASADO' }
];

const SCHEDULE_STATUS_LABELS = SCHEDULE_STATUS_OPTIONS.reduce(
  (acc, item) => ({ ...acc, [item.value]: item.label }),
  {} as Record<CampaignScheduleStatus, string>
);

const SCHEDULE_STATUS_BADGE: Record<CampaignScheduleStatus, string> = {
  PLANEJADO: 'bg-slate-100 text-slate-600',
  EM_ANDAMENTO: 'bg-amber-100 text-amber-700',
  CONCLUIDO: 'bg-emerald-100 text-emerald-700',
  ATRASADO: 'bg-red-100 text-red-600'
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ScheduleFormState = {
  date: string;
  title: string;
  status: CampaignScheduleStatus;
  responsibleId: string;
  responsibleName: string;
};

const VOTER_SENTIMENT_OPTIONS = [
  { label: 'Positivo', value: VoterSentiment.POSITIVO },
  { label: 'Neutro', value: VoterSentiment.NEUTRO },
  { label: 'Negativo', value: VoterSentiment.NEGATIVO }
];

const VOTER_BOOL_OPTIONS = [
  { label: 'Selecione', value: '' },
  { label: 'Sim', value: 'yes' },
  { label: 'Não', value: 'no' }
];

type VoterFormState = {
  name: string;
  phone: string;
  city: string;
  neighborhood: string;
  sentiment: string;
  knowsCandidate: string;
  decidedVote: string;
  wishes: string;
  electoralZone: string;
};

const parseDateValue = (value?: string) => {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
};

const createScheduleFormDefaults = (): ScheduleFormState => ({
  date: new Date().toISOString().split('T')[0],
  title: '',
  status: 'PLANEJADO',
  responsibleId: '',
  responsibleName: ''
});

const createVoterFormDefaults = (): VoterFormState => ({
  name: '',
  phone: '',
  city: '',
  neighborhood: '',
  sentiment: '',
  knowsCandidate: '',
  decidedVote: '',
  wishes: '',
  electoralZone: ''
});

const formatScheduleMonth = (value: string) => {
  const parsed = parseDateValue(value);
  if (!parsed) return '--';
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(parsed).toUpperCase();
};

const formatScheduleDay = (value: string) => {
  const parsed = parseDateValue(value);
  if (!parsed) return '--';
  return parsed.getUTCDate().toString().padStart(2, '0');
};

const getScheduleStatusLabel = (value?: CampaignScheduleStatus) =>
  (value && SCHEDULE_STATUS_LABELS[value]) || SCHEDULE_STATUS_LABELS.PLANEJADO;

const normalizeCampaignConfig = (config: CampaignConfig): CampaignConfig => ({
  ...config,
  schedule: (config.schedule || []).map((item) => ({
    ...item,
    status: item.status || 'PLANEJADO',
    responsibleId: item.responsibleId || null,
    responsibleName: item.responsibleName || null
  }))
});

const BASE_CAMPAIGN_CONFIG: CampaignConfig = {
  state: 'SP',
  electionDate: '2024-10-04',
  schedule: [
    { date: '2024-08-16', title: 'Início Propaganda Eleitoral', status: 'PLANEJADO', responsibleName: null },
    { date: '2024-09-30', title: 'Fim do Horário Gratuito', status: 'PLANEJADO', responsibleName: null },
    { date: '2024-10-04', title: 'DIA DA ELEIÇÃO', status: 'PLANEJADO', responsibleName: null }
  ]
};

const createDefaultCampaignConfig = (): CampaignConfig =>
  normalizeCampaignConfig({
    state: BASE_CAMPAIGN_CONFIG.state,
    electionDate: BASE_CAMPAIGN_CONFIG.electionDate,
    schedule: BASE_CAMPAIGN_CONFIG.schedule.map((item) => ({ ...item }))
  });

const buildCampaignConfigKey = (operationId?: string | null, userId?: string) => {
  if (operationId) return `iargos_config_op_${operationId}`;
  if (userId) return `iargos_config_user_${userId}`;
  return 'iargos_config';
};

const readCampaignConfigFromStorage = (key: string): CampaignConfig | null => {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return null;
    return normalizeCampaignConfig(JSON.parse(saved));
  } catch {
    return null;
  }
};

type CandidateLink = { label?: string | null; url: string };
type CandidateSeed = {
  candidate_name?: string | null;
  candidate_number?: string | null;
  candidate_party?: string | null;
  candidate_social_links?: CandidateLink[] | null;
  candidate_speech?: string | null;
  candidate_other_links?: CandidateLink[] | null;
  candidate_photo_url?: string | null;
  candidate_highlights?: string[] | null;
  candidate_santinho_url?: string | null;
  theme_primary_color?: string | null;
  theme_secondary_color?: string | null;
};

type CandidateFormState = {
  name: string;
  number: string;
  party: string;
  speech: string;
  socialLinks: string;
  otherLinks: string;
  photoUrl: string;
  santinhoUrl: string;
  highlights: string;
  colorPrimary: string;
  colorSecondary: string;
};

const formatCandidateLinksInput = (links?: CandidateLink[] | null) => {
  if (!links || links.length === 0) return '';
  return links
    .map((entry) => {
      const url = entry.url?.trim();
      if (!url) return null;
      const label = entry.label?.toString().trim();
      return label ? `${label} | ${url}` : url;
    })
    .filter((value): value is string => Boolean(value))
    .join('\n');
};

const parseCandidateLinksInput = (value: string): CandidateLink[] => {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const hasDelimiter = line.includes('|');
      if (!hasDelimiter) {
        return { label: null, url: line };
      }
      const [rawLabel, rawUrl] = line.split('|');
      const url = (rawUrl || '').trim();
      const label = (rawLabel || '').trim();
      if (url) {
        return { label: label || null, url };
      }
      if (label) {
        return { label: null, url: label };
      }
      return null;
    })
    .filter((entry): entry is CandidateLink => Boolean(entry && entry.url));
};

const formatCandidateHighlightsInput = (entries?: string[] | null) => {
  if (!entries || entries.length === 0) return '';
  return entries.join('\n');
};

const parseCandidateHighlightsInput = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const createCandidateFormState = (seed?: CandidateSeed | null): CandidateFormState => ({
  name: seed?.candidate_name || '',
  number: seed?.candidate_number || '',
  party: seed?.candidate_party || '',
  speech: seed?.candidate_speech || '',
  socialLinks: formatCandidateLinksInput(seed?.candidate_social_links),
  otherLinks: formatCandidateLinksInput(seed?.candidate_other_links),
  photoUrl: seed?.candidate_photo_url || '',
  santinhoUrl: seed?.candidate_santinho_url || '',
  highlights: formatCandidateHighlightsInput(seed?.candidate_highlights),
  colorPrimary: seed?.theme_primary_color || '#4338ca',
  colorSecondary: seed?.theme_secondary_color || '#0f172a'
});

const Dashboard: React.FC<DashboardProps> = ({ user, view = 'COMMAND' }) => {
  const isLeaderRole = [UserRole.L1, UserRole.L2, UserRole.L3].includes(user.role);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const initialConfigKey = buildCampaignConfigKey(user.operationId, user.id);
  const [campaignConfig, setCampaignConfig] = useState<CampaignConfig>(() => {
    const stored = readCampaignConfigFromStorage(initialConfigKey);
    return stored || createDefaultCampaignConfig();
  });

  const [operation, setOperation] = useState<OperationRecord | null>(
    () =>
      user.operationId
        ? {
            id: user.operationId,
            nome: user.operationName,
            estado: user.operationState,
            diretor_id: user.role === UserRole.DIRECTOR ? user.id : undefined
          }
        : null
  );
  const configStorageKey = useMemo(
    () => buildCampaignConfigKey(operation?.id || user.operationId, user.id),
    [operation?.id, user.operationId, user.id]
  );
  const configKeyRef = useRef<string | null>(initialConfigKey);
  const [hierarchyNotes, setHierarchyNotes] = useState<HierarchyNote[]>([]);
  const [supportsTimelineResponsibleName, setSupportsTimelineResponsibleName] = useState(true);
  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationNameInput, setOperationNameInput] = useState(user.operationName || '');
  const [operationStateInput, setOperationStateInput] = useState(user.operationState || campaignConfig.state);
  const [operationCampaignType, setOperationCampaignType] = useState<CampaignTypeValue | ''>('');
  const [operationSaving, setOperationSaving] = useState(false);
  const [operationSuccessMessage, setOperationSuccessMessage] = useState<string | null>(null);
  const [candidateForm, setCandidateForm] = useState<CandidateFormState>(() => createCandidateFormState());
  const [santinhoLinkCopied, setSantinhoLinkCopied] = useState(false);
  const [leaderInviteGenerating, setLeaderInviteGenerating] = useState(false);
  const [leaderInviteResult, setLeaderInviteResult] = useState<{ token: string; link: string } | null>(null);
  const [leaderInviteError, setLeaderInviteError] = useState<string | null>(null);
  const [leaderInviteCopied, setLeaderInviteCopied] = useState(false);
  const [soldierInviteGenerating, setSoldierInviteGenerating] = useState(false);
  const [soldierInviteResult, setSoldierInviteResult] = useState<{ token: string; link: string } | null>(null);
  const [soldierInviteError, setSoldierInviteError] = useState<string | null>(null);
  const [soldierInviteCopied, setSoldierInviteCopied] = useState(false);
  const [leaderInviteHistory, setLeaderInviteHistory] = useState<InviteSnapshot[]>([]);
  const [soldierInviteHistory, setSoldierInviteHistory] = useState<InviteSnapshot[]>([]);
  const [copiedInviteToken, setCopiedInviteToken] = useState<string | null>(null);
  const [inviteRevokingId, setInviteRevokingId] = useState<string | null>(null);
  const [inviteActionError, setInviteActionError] = useState<string | null>(null);
  const [inviteListError, setInviteListError] = useState<string | null>(null);
  const [inviteConsumptionFeed, setInviteConsumptionFeed] = useState<InviteSnapshot[]>([]);
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [membersMap, setMembersMap] = useState<Record<string, MemberProfile>>({});
  const [leaderSummaries, setLeaderSummaries] = useState<LeaderZoneSummary[]>([]);
  const [zoneDirectoryData, setZoneDirectoryData] = useState<ZoneDirectoryEntry[]>([]);
  const leaderOptions = useMemo(
    () =>
      [...members]
        .filter((member) => member.role !== UserRole.SOLDIER)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [members]
  );
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [noteComposer, setNoteComposer] = useState<{
    role: UserRole;
    text: string;
    targetScope: NoteScopeOption;
    selectedLeaders: string[];
    selectedZones: string[];
    selectedSubzones: string[];
    selectedMembers: string[];
  }>({
    role: UserRole.SOLDIER,
    text: '',
    targetScope: 'ALL',
    selectedLeaders: [],
    selectedZones: [],
    selectedSubzones: [],
    selectedMembers: []
  });
  const [noteActionLoading, setNoteActionLoading] = useState(false);
  const [noteDeletingId, setNoteDeletingId] = useState<string | null>(null);
  const [noteSuccessMessage, setNoteSuccessMessage] = useState<string | null>(null);
  const [noteRecipientsSupported, setNoteRecipientsSupported] = useState(true);
  const [notesFeatureBlocked, setNotesFeatureBlocked] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSuccess, setScheduleSuccess] = useState<string | null>(null);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(() => createScheduleFormDefaults());
  const [editingScheduleIndex, setEditingScheduleIndex] = useState<number | null>(null);
  const [scheduleFormError, setScheduleFormError] = useState<string | null>(null);
  const brandPrimary = candidateForm.colorPrimary || '#4338ca';
  const brandSecondary = candidateForm.colorSecondary || '#0f172a';
  const [voters, setVoters] = useState<VoterRecord[]>([]);
  const [votersLoading, setVotersLoading] = useState(false);
  const [votersError, setVotersError] = useState<string | null>(null);
  const [voterForm, setVoterForm] = useState<VoterFormState>(() => createVoterFormDefaults());
  const [voterFormError, setVoterFormError] = useState<string | null>(null);
  const [voterSaving, setVoterSaving] = useState(false);
  const [voterSuccess, setVoterSuccess] = useState<string | null>(null);
  const [voterFormExpanded, setVoterFormExpanded] = useState(user.role !== UserRole.DIRECTOR);
  const [voterSearch, setVoterSearch] = useState('');
  const [voterSentimentFilter, setVoterSentimentFilter] = useState('');
  const [voterKnowledgeFilter, setVoterKnowledgeFilter] = useState('');
  const [voterDecisionFilter, setVoterDecisionFilter] = useState('');
  const [voterSort, setVoterSort] = useState<'newest' | 'oldest' | 'name'>('newest');

  const candidatePreview = useMemo(
    () => {
      const social = parseCandidateLinksInput(candidateForm.socialLinks);
      const other = parseCandidateLinksInput(candidateForm.otherLinks);
      const highlights = parseCandidateHighlightsInput(candidateForm.highlights);
      const trimmedPhoto = candidateForm.photoUrl.trim();
      const trimmedSantinho = candidateForm.santinhoUrl.trim();
      const baseOperationName =
        operationNameInput.trim() || operation?.nome || user.operationName || '';
      return {
        name: candidateForm.name.trim() || baseOperationName,
        number: candidateForm.number.trim() || '',
        party: candidateForm.party.trim() || '',
        speech: candidateForm.speech.trim() || '',
        photoUrl: trimmedPhoto || trimmedSantinho || '',
        santinhoUrl: trimmedSantinho || '',
        socialLinks: social,
        otherLinks: other,
        highlights,
        operationName: baseOperationName
      };
    },
    [candidateForm, operation?.nome, operationNameInput, user.operationName]
  );
  const [financeSearch, setFinanceSearch] = useState('');
  const [financeRoleFilter, setFinanceRoleFilter] = useState<FinanceRoleFilter>('ALL');
  const [dailyRateDrafts, setDailyRateDrafts] = useState<Record<string, string>>({});
  const [dailyRateSavingId, setDailyRateSavingId] = useState<string | null>(null);
  const [dailyRateError, setDailyRateError] = useState<string | null>(null);
  const [timesheetModal, setTimesheetModal] = useState<{ open: boolean; member: MemberProfile | null; data: TimesheetData }>({
    open: false,
    member: null,
    data: { days: [] }
  });
  const [pixCopiedId, setPixCopiedId] = useState<string | null>(null);
  const financeSummary = useMemo(() => {
    const totalDaily = members.reduce((sum, member) => sum + (member.dailyRate || 0), 0);
    const missingPix = members.filter((member) => !member.pix?.trim()).length;
    const missingCpf = members.filter((member) => !member.cpf?.trim()).length;
    const missingDailyRate = members.filter((member) => member.dailyRate == null).length;
    return { totalDaily, missingPix, missingCpf, missingDailyRate };
  }, [members]);

  const refreshInviteLists = useCallback(async () => {
    if (!supabase || !operation?.id) {
      setLeaderInviteHistory([]);
      setSoldierInviteHistory([]);
      setInviteConsumptionFeed([]);
      setInviteListError(null);
      return;
    }
    try {
      setInviteListError(null);
      const { data, error } = await supabase
        .from('convites')
        .select('id, token, tipo, expires_at, created_at, emitido_por, consumido_por, consumido_em')
        .eq('operacao_id', operation.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const now = Date.now();
      const filterActive = (entry: InviteSnapshot) =>
        !entry.expires_at || new Date(entry.expires_at).getTime() > now;
      const payload = (data || []) as InviteSnapshot[];
      const canViewAllSoldierInvites = user.role === UserRole.DIRECTOR;
      setLeaderInviteHistory(payload.filter((invite) => invite.tipo === 'LEADER' && filterActive(invite)));
      setSoldierInviteHistory(
        payload.filter(
          (invite) =>
            invite.tipo === 'SOLDIER' &&
            filterActive(invite) &&
            (canViewAllSoldierInvites || invite.emitido_por === user.id)
        )
      );
      const consumed = payload
        .filter((invite) => Boolean(invite.consumido_em))
        .sort((a, b) => (b.consumido_em || '').localeCompare(a.consumido_em || ''))
        .slice(0, 6);
      setInviteConsumptionFeed(consumed);
    } catch (error) {
      console.error('Erro ao carregar convites ativos', error);
      setInviteListError('Não foi possível carregar a lista de convites ativos.');
    }
  }, [supabase, operation?.id, user.id, user.role]);

  useEffect(() => {
    refreshInviteLists();
  }, [refreshInviteLists]);

  useEffect(() => {
    if (configKeyRef.current === configStorageKey) return;
    configKeyRef.current = configStorageKey;
    const stored = readCampaignConfigFromStorage(configStorageKey);
    if (stored) {
      setCampaignConfig(stored);
    } else {
      setCampaignConfig(createDefaultCampaignConfig());
    }
  }, [configStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(configStorageKey, JSON.stringify(campaignConfig));
  }, [campaignConfig, configStorageKey]);

  useEffect(() => {
    setVoterFormExpanded(user.role !== UserRole.DIRECTOR);
  }, [user.role]);

  useEffect(() => {
    const fetchOperation = async () => {
      if (!supabase) return;
      setOperationLoading(true);
      setOperationError(null);
      try {
        let response;
        if (user.role === UserRole.DIRECTOR) {
          response = await supabase
            .from('operacoes')
            .select(OPERATION_SELECT_FIELDS)
            .eq('diretor_id', user.id)
            .limit(1)
            .maybeSingle();
        } else if (user.operationId) {
          response = await supabase
            .from('operacoes')
            .select(OPERATION_SELECT_FIELDS)
            .eq('id', user.operationId)
            .maybeSingle();
        } else {
          setOperation(null);
          setOperationCampaignType('');
          setCandidateForm(createCandidateFormState());
          return;
        }

        if (response.error) {
          if (response.error.code === 'PGRST116') {
            setOperation(null);
            setOperationCampaignType('');
            setCandidateForm(createCandidateFormState());
            return;
          }
          throw response.error;
        }

        if (response.data) {
          setOperation(response.data as OperationRecord);
          setOperationNameInput(response.data.nome || '');
          setOperationStateInput(response.data.estado || campaignConfig.state);
          setOperationCampaignType((response.data.campaign_type as CampaignTypeValue) || '');
          setCandidateForm(createCandidateFormState(response.data as CandidateSeed));
        } else {
          setOperation(null);
          setOperationCampaignType('');
          setCandidateForm(createCandidateFormState());
        }
      } catch (error) {
        console.error('Supabase operation error', error);
        setOperationError('Não foi possível carregar os dados da operação.');
      } finally {
        setOperationLoading(false);
      }
    };

    fetchOperation();
  }, [user.id, user.role, user.operationId]);

  useEffect(() => {
    if (operation?.estado) {
      setCampaignConfig(prev => ({ ...prev, state: operation.estado }));
    }
  }, [operation?.estado]);

  useEffect(() => {
    setOperationCampaignType((operation?.campaign_type as CampaignTypeValue) || '');
  }, [operation?.campaign_type]);

  useEffect(() => {
    const loadHierarchyNotes = async () => {
      if (!operation?.id || !supabase) {
        setHierarchyNotes([]);
        setNoteComposer({
          role: UserRole.SOLDIER,
          text: '',
          targetScope: 'ALL',
          selectedLeaders: [],
          selectedZones: [],
          selectedSubzones: [],
          selectedMembers: []
        });
        setNotesError(null);
        setNotesLoading(false);
        setNotesFeatureBlocked(false);
        setNoteRecipientsSupported(true);
        return;
      }
      setNotesLoading(true);
      setNotesError(null);
      try {
        const result = await fetchHierarchyNotes(operation.id);
        setHierarchyNotes(result.notes);
        setNoteRecipientsSupported(result.supportsRecipients);
        setNotesFeatureBlocked(!result.supportsRecipients);
      } catch (error) {
        console.error('Hierarchy notes fetch error', error);
        setNotesError('Não foi possível carregar as notas de comando.');
      } finally {
        setNotesLoading(false);
      }
    };

    loadHierarchyNotes();
  }, [operation?.id]);

  useEffect(() => {
    if (!noteRecipientsSupported) {
      setNoteComposer((prev) => ({
        ...prev,
        targetScope: 'ALL',
        selectedLeaders: [],
        selectedZones: [],
        selectedSubzones: [],
        selectedMembers: []
      }));
    }
  }, [noteRecipientsSupported]);

  useEffect(() => {
    const loadTimeline = async () => {
      if (!operation?.id || !supabase) {
        setTimelineLoading(false);
        setScheduleError(null);
        setSupportsTimelineResponsibleName(true);
        setScheduleForm(createScheduleFormDefaults());
        setEditingScheduleIndex(null);
        setScheduleFormError(null);
        return;
      }
      setTimelineLoading(true);
      setScheduleError(null);
      try {
        const { entries, version, supportsResponsibleName } = await fetchOperationTimeline(operation.id);
        setSupportsTimelineResponsibleName(supportsResponsibleName);
        if (entries.length) {
          setCampaignConfig((prev) => normalizeCampaignConfig({ ...prev, schedule: entries, version }));
        } else {
          setCampaignConfig((prev) => ({ ...prev, version: 0 }));
        }
        setScheduleDirty(false);
        setScheduleForm(createScheduleFormDefaults());
        setEditingScheduleIndex(null);
        setScheduleFormError(null);
      } catch (error) {
        console.error('Cronograma fetch error', error);
        setScheduleError('Não foi possível carregar o cronograma.');
      } finally {
        setTimelineLoading(false);
      }
    };

    loadTimeline();
  }, [operation?.id]);

  useEffect(() => {
    const loadDirectory = async () => {
      if (!operation?.id || !supabase) {
        setMembers([]);
        setMembersMap({});
        setLeaderSummaries([]);
        setMembersError(null);
        return;
      }
      setMembersLoading(true);
      setMembersError(null);
      try {
        const [membersData, leaderData, zoneData] = await Promise.all([
          fetchOperationMembers(operation.id),
          fetchLeaderAssignments(operation.id),
          fetchZoneDirectory(operation.id)
        ]);
        setMembers(membersData);
        const dictionary: Record<string, MemberProfile> = {};
        membersData.forEach((member) => {
          dictionary[member.id] = member;
        });
        setMembersMap(dictionary);
        setLeaderSummaries(leaderData);
        setZoneDirectoryData(zoneData);
      } catch (error) {
        console.error('Operation members fetch error', error);
        setMembersError('Não foi possível carregar os dados de líderes e membros.');
      } finally {
        setMembersLoading(false);
      }
    };

    loadDirectory();
  }, [operation?.id]);

  const loadVoters = useCallback(async () => {
    if (user.role !== UserRole.DIRECTOR) {
      setVoters([]);
      setVotersError(null);
      return;
    }
    if (!operation?.id) {
      setVoters([]);
      setVotersError(null);
      return;
    }
    setVotersLoading(true);
    setVotersError(null);
    try {
      const data = await fetchOperationVoters(operation.id);
      setVoters(data);
    } catch (error) {
      console.error('Operation voters fetch error', error);
      setVotersError('Não foi possível carregar os eleitores cadastrados.');
    } finally {
      setVotersLoading(false);
    }
  }, [operation?.id, user.role]);

  useEffect(() => {
    loadVoters();
  }, [loadVoters]);

  const filteredVoters = useMemo(() => {
    let list = [...voters];
    const searchTerm = voterSearch.trim().toLowerCase();
    if (searchTerm) {
      list = list.filter((record) => {
        const haystack = [
          record.name,
          record.phone,
          record.city,
          record.neighborhood,
          record.wishes,
          record.electoralZone
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(searchTerm);
      });
    }
    if (voterSentimentFilter) {
      list = list.filter((record) => record.sentiment === voterSentimentFilter);
    }
    const matchBoolFilter = (value: boolean | null | undefined, filterValue: string) => {
      if (!filterValue) return true;
      const boolValue = filterValue === 'yes';
      return value === boolValue;
    };
    if (voterKnowledgeFilter) {
      list = list.filter((record) => matchBoolFilter(record.knowsCandidate, voterKnowledgeFilter));
    }
    if (voterDecisionFilter) {
      list = list.filter((record) => matchBoolFilter(record.decidedVote, voterDecisionFilter));
    }
    list.sort((a, b) => {
      if (voterSort === 'name') {
        return a.name.localeCompare(b.name);
      }
      if (voterSort === 'oldest') {
        return a.createdAt.localeCompare(b.createdAt);
      }
      // newest
      return b.createdAt.localeCompare(a.createdAt);
    });
    return list;
  }, [
    voters,
    voterSearch,
    voterSentimentFilter,
    voterKnowledgeFilter,
    voterDecisionFilter,
    voterSort
  ]);

  const handleExportVoters = () => {
    if (!filteredVoters.length) return;
    const header = [
      'Nome',
      'Telefone',
      'Cidade',
      'Bairro',
      'Sentimento',
      'Conhece candidato',
      'Voto definido',
      'Desejos',
      'Zona eleitoral',
      'Registrado por',
      'Data'
    ];
    const rows = filteredVoters.map((record) => [
      csvEscape(record.name),
      csvEscape(record.phone),
      csvEscape(record.city || ''),
      csvEscape(record.neighborhood || ''),
      csvEscape(
        VOTER_SENTIMENT_OPTIONS.find((option) => option.value === record.sentiment)?.label || ''
      ),
      csvEscape(formatBooleanDisplay(record.knowsCandidate)),
      csvEscape(formatBooleanDisplay(record.decidedVote)),
      csvEscape(record.wishes || ''),
      csvEscape(record.electoralZone || ''),
      csvEscape(record.recordedByName || ''),
      csvEscape(new Date(record.createdAt).toLocaleString('pt-BR'))
    ]);
    const csvContent = [header.map((value) => csvEscape(value)).join(','), ...rows.map((cells) => cells.join(','))].join(
      '\n'
    );
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `eleitores-${operation?.slug || 'operacao'}-${Date.now()}.csv`;
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const slugifyName = (value: string) => {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .substring(0, 50) || `op-${Date.now().toString(36)}`;
};

const parseBooleanSelect = (value: string): boolean | null => {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
};

const formatBooleanDisplay = (value?: boolean | null) => {
  if (value === true) return 'Sim';
  if (value === false) return 'Não';
  return '—';
};

const csvEscape = (value?: string | null) => {
  if (value == null) return '""';
  const sanitized = value.replace(/"/g, '""');
  return `"${sanitized}"`;
};

const handleCandidateFormChange = (field: keyof CandidateFormState, value: string) => {
  setCandidateForm((prev) => ({ ...prev, [field]: value }));
};

const handleVoterFormChange = (field: keyof VoterFormState, value: string) => {
  setVoterForm((prev) => ({ ...prev, [field]: value }));
};

  const handleVoterFormSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!operation?.id) {
      setVoterFormError('Configure uma operação antes de registrar eleitores.');
      return;
    }
  const trimmedName = voterForm.name.trim();
  const trimmedPhone = voterForm.phone.trim();
  if (!trimmedName || !trimmedPhone) {
    setVoterFormError('Informe nome e telefone do eleitor.');
    return;
  }

  setVoterSaving(true);
  setVoterFormError(null);
  setVoterSuccess(null);
  try {
    const payload = {
      name: trimmedName,
      phone: trimmedPhone,
      city: voterForm.city.trim() || undefined,
      neighborhood: voterForm.neighborhood.trim() || undefined,
      sentiment: (voterForm.sentiment as VoterSentiment) || null,
      knowsCandidate: parseBooleanSelect(voterForm.knowsCandidate),
      decidedVote: parseBooleanSelect(voterForm.decidedVote),
      wishes: voterForm.wishes.trim() || undefined,
      electoralZone: voterForm.electoralZone.trim() || undefined,
      recordedByName: user.name
    };
      const recordedById = user.role === UserRole.DIRECTOR ? undefined : user.id;
      const record = await createOperationVoter(operation.id, payload, recordedById);
      setVoterSuccess('Eleitor registrado com sucesso.');
      setVoterForm(createVoterFormDefaults());
      setVoters((prev) => (user.role === UserRole.DIRECTOR ? [record, ...prev] : prev));
  } catch (error) {
    console.error('Voter save error', error);
    setVoterFormError('Não foi possível salvar o eleitor agora.');
  } finally {
    setVoterSaving(false);
    setTimeout(() => setVoterSuccess(null), 3500);
  }
};

  const handleOperationSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      setOperationError('Configure o Supabase URL/KEY no .env.local.');
      return;
    }
    const trimmedName = operationNameInput.trim();
    if (!trimmedName) {
      setOperationError('Informe o nome da operação.');
      return;
    }
    if (!operationStateInput) {
      setOperationError('Selecione o estado da operação.');
      return;
    }
    if (!operationCampaignType) {
      setOperationError('Selecione o cargo em disputa.');
      return;
    }

    setOperationSaving(true);
    setOperationError(null);
    setOperationSuccessMessage(null);
    try {
      const socialLinks = parseCandidateLinksInput(candidateForm.socialLinks);
      const otherLinks = parseCandidateLinksInput(candidateForm.otherLinks);
      const highlightEntries = parseCandidateHighlightsInput(candidateForm.highlights);
      const candidatePayload = {
        candidate_name: candidateForm.name.trim() || null,
        candidate_number: candidateForm.number.trim() || null,
        candidate_party: candidateForm.party.trim() || null,
        candidate_speech: candidateForm.speech.trim() || null,
        candidate_photo_url: candidateForm.photoUrl.trim() || null,
        candidate_santinho_url: candidateForm.santinhoUrl.trim() || null,
        candidate_social_links: socialLinks.length ? socialLinks : null,
        candidate_other_links: otherLinks.length ? otherLinks : null,
        candidate_highlights: highlightEntries.length ? highlightEntries : null,
        theme_primary_color: candidateForm.colorPrimary || null,
        theme_secondary_color: candidateForm.colorSecondary || null
      };

      const basePayload = {
        nome: trimmedName,
        estado: operationStateInput,
        diretor_id: user.id,
        campaign_type: operationCampaignType,
        ...candidatePayload
      };

    const persist = async (slugValue: string) => {
      const payload = { ...basePayload, slug: slugValue };
      if (operation) {
        return supabase.from('operacoes').update(payload).eq('id', operation.id).select(OPERATION_SELECT_FIELDS).single();
      }
      return supabase
        .from('operacoes')
        .insert(payload)
        .select(OPERATION_SELECT_FIELDS)
        .single();
    };

    let response = await persist(slugifyName(trimmedName));
    if (response.error && response.error.code === '23505') {
      const fallbackSlug = `${slugifyName(trimmedName)}-${Math.random().toString(36).substring(2, 6)}`;
      response = await persist(fallbackSlug);
    }

    if (response.error) throw response.error;
    if (response.data) {
      setOperation(response.data as OperationRecord);
      setCandidateForm(createCandidateFormState(response.data as CandidateSeed));
      setOperationSuccessMessage('Configurações salvas com sucesso.');
    }
    } catch (error) {
      console.error('Supabase operation save error', error);
      setOperationError('Não foi possível salvar a operação agora.');
    } finally {
      setOperationSaving(false);
    }
  };

  const generateToken = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '');
    }
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  };

  const buildInviteLink = (token: string) => {
    const baseUrl =
      typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';
    return `${baseUrl}#/login?token=${token}`;
  };

  const handleCopySantinhoLink = async () => {
    const link = buildSantinhoLink();
    if (!link) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = link;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setSantinhoLinkCopied(true);
      setTimeout(() => setSantinhoLinkCopied(false), 2000);
    } catch (error) {
      console.error('Clipboard error', error);
    }
  };
  const buildSantinhoLink = useCallback(() => {
    if (typeof window === 'undefined' || !operation?.slug) return '';
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    return `${baseUrl}#/santinho/${operation.slug}`;
  }, [operation?.slug]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--iargos-brand-primary', brandPrimary);
    root.style.setProperty('--iargos-brand-secondary', brandSecondary);
  }, [brandPrimary, brandSecondary]);

  const createInvite = async (
    type: 'LEADER' | 'SOLDIER',
    responsibleId?: string
  ) => {
    if (!supabase) throw new Error('Configure o Supabase URL/KEY no .env.local.');
    if (!operation?.id) throw new Error('Nenhuma operação configurada.');

    const token = generateToken();
    const metadata: Record<string, any> = { reutilizavel: true };
    if (responsibleId) metadata.responsavel_id = responsibleId;

    const directorIdForInvite =
      operation.diretor_id || (user.role === UserRole.DIRECTOR ? user.id : user.leaderId);

    if (!directorIdForInvite) {
      throw new Error('Diretor responsável não identificado.');
    }

    const payload: Record<string, any> = {
      operacao_id: operation.id,
      tipo: type,
      token,
      expires_at: PERMANENT_INVITE_EXPIRATION,
      metadata,
      diretor_id: directorIdForInvite,
      emitido_por: responsibleId || (user.role !== UserRole.DIRECTOR ? user.id : null)
    };

    const { data, error } = await supabase
      .from('convites')
      .insert(payload)
      .select('token')
      .single();

    if (error) throw error;

    const finalToken = data?.token || token;
    return { token: finalToken, link: buildInviteLink(finalToken) };
  };

  const handleDirectorInvite = async () => {
    if (!operation) {
      setLeaderInviteError('Configure a operação antes de gerar convites.');
      return;
    }
    setLeaderInviteGenerating(true);
    setLeaderInviteError(null);
    setLeaderInviteResult(null);
    setLeaderInviteCopied(false);
    try {
      const result = await createInvite('LEADER');
      setLeaderInviteResult(result);
      refreshInviteLists();
    } catch (error) {
      console.error('Supabase invite creation error', error);
      setLeaderInviteError('Não conseguimos gerar o convite agora.');
    } finally {
      setLeaderInviteGenerating(false);
    }
  };

  const handleLeaderInvite = async () => {
    if (!operation) {
      setSoldierInviteError('Operação não identificada. Entre em contato com o diretor.');
      return;
    }
    setSoldierInviteGenerating(true);
    setSoldierInviteError(null);
    setSoldierInviteResult(null);
    setSoldierInviteCopied(false);
    try {
      const result = await createInvite('SOLDIER', user.id);
      setSoldierInviteResult(result);
      refreshInviteLists();
    } catch (error) {
      console.error('Supabase soldier invite error', error);
      setSoldierInviteError('Não foi possível gerar o link para soldados.');
    } finally {
      setSoldierInviteGenerating(false);
    }
  };

  const handleCopyLeaderInvite = async () => {
    if (!leaderInviteResult || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(leaderInviteResult.link);
      setLeaderInviteCopied(true);
      setTimeout(() => setLeaderInviteCopied(false), 2500);
    } catch (error) {
      console.error('Clipboard error', error);
    }
  };

  const handleCopySoldierInvite = async () => {
    if (!soldierInviteResult || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(soldierInviteResult.link);
      setSoldierInviteCopied(true);
      setTimeout(() => setSoldierInviteCopied(false), 2500);
    } catch (error) {
      console.error('Clipboard error', error);
    }
  };

  const handleCopyActiveInvite = async (token: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(buildInviteLink(token));
      setCopiedInviteToken(token);
      setTimeout(() => setCopiedInviteToken((prev) => (prev === token ? null : prev)), 2000);
    } catch (error) {
      console.error('Clipboard error', error);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!supabase) {
      setInviteActionError('Configure o Supabase URL/KEY no .env.local.');
      return;
    }
    setInviteActionError(null);
    setInviteRevokingId(inviteId);
    try {
      const { error } = await supabase
        .from('convites')
        .update({ expires_at: new Date().toISOString() })
        .eq('id', inviteId);
      if (error) throw error;
      await refreshInviteLists();
    } catch (error) {
      console.error('Invite revoke error', error);
      setInviteActionError('Não foi possível revogar o convite.');
    } finally {
      setInviteRevokingId(null);
    }
  };

  const handleNoteComposerChange = (field: 'role' | 'text' | 'scope', value: any) => {
    setNoteComposer((prev) => {
      if (field === 'role') {
        return {
          ...prev,
          role: value,
          selectedMembers: [],
          selectedLeaders: [],
          selectedZones: [],
          selectedSubzones: []
        };
      }
      if (field === 'scope') {
        const resolvedScope = noteRecipientsSupported ? value : 'ALL';
        return {
          ...prev,
          targetScope: resolvedScope,
          selectedLeaders: [],
          selectedZones: [],
          selectedSubzones: [],
          selectedMembers: []
        };
      }
      return { ...prev, text: value };
    });
  };

  const toggleLeaderRecipient = (leaderId: string) => {
    setNoteComposer((prev) => {
      const exists = prev.selectedLeaders.includes(leaderId);
      const next = exists ? prev.selectedLeaders.filter((id) => id !== leaderId) : [...prev.selectedLeaders, leaderId];
      return { ...prev, selectedLeaders: next };
    });
  };

  const toggleZoneRecipient = (zoneId: string) => {
    setNoteComposer((prev) => {
      const exists = prev.selectedZones.includes(zoneId);
      const next = exists ? prev.selectedZones.filter((id) => id !== zoneId) : [...prev.selectedZones, zoneId];
      return { ...prev, selectedZones: next };
    });
  };

  const toggleSubzoneRecipient = (subzoneId: string) => {
    setNoteComposer((prev) => {
      const exists = prev.selectedSubzones.includes(subzoneId);
      const next = exists
        ? prev.selectedSubzones.filter((id) => id !== subzoneId)
        : [...prev.selectedSubzones, subzoneId];
      return { ...prev, selectedSubzones: next };
    });
  };

  const toggleMemberRecipient = (memberId: string) => {
    setNoteComposer((prev) => {
      const exists = prev.selectedMembers.includes(memberId);
      const next = exists
        ? prev.selectedMembers.filter((id) => id !== memberId)
        : [...prev.selectedMembers, memberId];
      return { ...prev, selectedMembers: next };
    });
  };

  const handleNoteCreate = async () => {
    if (!operation?.id) {
      setNotesError('Configure a operação antes de lançar notas.');
      return;
    }
    if (!noteComposer.text.trim()) {
      setNotesError('Escreva a nota antes de lançar.');
      return;
    }

    if (!noteRecipientsSupported && noteComposer.targetScope !== 'ALL') {
      setNotesError('Direcionamento por líder/zona requer atualização do banco de dados.');
      return;
    }

    let recipients: string[] | null = null;
    const ensureMembers = (list: string[], emptyMessage: string) => {
      if (!list.length) {
        setNotesError(emptyMessage);
        return null;
      }
      return Array.from(new Set(list));
    };

    const gatherSoldiersFromLeaders = (leaderIds: string[], includeLeadersCopy = false) => {
      const buffer = new Set<string>();
      leaderIds.forEach((leaderId) => {
        if (includeLeadersCopy) buffer.add(leaderId);
        (leaderToSoldiersMap[leaderId] || []).forEach((soldierId) => buffer.add(soldierId));
      });
      return Array.from(buffer);
    };

    const gatherMembersByRole = (ids: string[]) => {
      return ids.filter((id) => membersMap[id]?.role === noteComposer.role);
    };

    const gatherZoneRecipients = (zoneIds: string[], subzoneIds: string[]) => {
      const buffer = new Set<string>();
      const processLeaderIds = (leaderIds: string[]) => {
        if (noteComposer.role === UserRole.SOLDIER) {
          gatherSoldiersFromLeaders(leaderIds, true).forEach((id) => buffer.add(id));
        } else {
          gatherMembersByRole(leaderIds).forEach((id) => buffer.add(id));
        }
      };

      zoneIds.forEach((zoneId) => {
        const zone = zoneDirectory.find((item) => item.id === zoneId);
        if (!zone) return;
        processLeaderIds(zone.leaderIds);
      });

      subzoneIds.forEach((subId) => {
        const subzoneEntry = subzoneDirectoryMap[subId];
        if (!subzoneEntry) return;
        processLeaderIds(subzoneEntry.leaderIds);
      });
      return Array.from(buffer);
    };

    switch (noteComposer.targetScope) {
      case 'ALL':
        recipients = null;
        break;
      case 'BY_MEMBER': {
        const result = ensureMembers(
          noteComposer.selectedMembers.filter((memberId) => membersMap[memberId]?.role === noteComposer.role),
          'Selecione ao menos um membro.'
        );
        if (!result) return;
        recipients = result;
        break;
      }
      case 'BY_LEADER': {
        const selectedIds = ensureMembers(noteComposer.selectedLeaders, 'Selecione ao menos um líder.');
        if (!selectedIds) return;
        if (noteComposer.role === UserRole.SOLDIER) {
          const result = gatherSoldiersFromLeaders(selectedIds);
          if (!result.length) {
            setNotesError('Nenhum soldado vinculado aos líderes selecionados.');
            return;
          }
          recipients = result;
        } else {
          recipients = gatherMembersByRole(selectedIds);
          if (!recipients.length) {
            setNotesError('Os líderes selecionados não possuem o mesmo nível escolhido.');
            return;
          }
        }
        break;
      }
      case 'BY_ZONE': {
        const selectedZones = ensureMembers(noteComposer.selectedZones, '');
        const selectedSubzones = ensureMembers(noteComposer.selectedSubzones, '');
        if ((!selectedZones || !selectedZones.length) && (!selectedSubzones || !selectedSubzones.length)) {
          setNotesError('Selecione ao menos uma zona ou subzona.');
          return;
        }
        const zoneIds = selectedZones || [];
        const subzoneIds = selectedSubzones || [];
        const result = gatherZoneRecipients(zoneIds, subzoneIds);
        if (!result.length) {
          setNotesError('Nenhum membro encontrado nas zonas selecionadas.');
          return;
        }
        recipients = result;
        break;
      }
      default:
        recipients = null;
    }

    setNoteActionLoading(true);
    setNotesError(null);
    try {
      const saved = await createHierarchyNote(
        operation.id,
        {
          role: noteComposer.role,
          text: noteComposer.text.trim(),
          recipients: recipients && recipients.length ? recipients : null
        },
        { supportsRecipients: noteRecipientsSupported }
      );
      setHierarchyNotes((prev) => [saved, ...prev]);
      setNoteComposer({
        role: noteComposer.role,
        text: '',
        targetScope: 'ALL',
        selectedLeaders: [],
        selectedZones: [],
        selectedSubzones: [],
        selectedMembers: []
      });
      setNoteSuccessMessage('Nota lançada para a tropa.');
      setTimeout(() => setNoteSuccessMessage(null), 2500);
    } catch (error) {
      console.error('Hierarchy note save error', error);
      if ((error as any)?.code === 'MISSING_DEST_COLUMN') {
        setNotesFeatureBlocked(true);
        setNotesError(
          'Adicione a coluna destinatarios (uuid[]) em hierarquia_notas para habilitar o direcionamento das notas.'
        );
      } else {
        setNotesError('Não foi possível lançar a nota.');
      }
    } finally {
      setNoteActionLoading(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!noteId) return;
    setNoteDeletingId(noteId);
    setNotesError(null);
    try {
      await deleteHierarchyNote(noteId);
      setHierarchyNotes((prev) => prev.filter((note) => note.id !== noteId));
    } catch (error) {
      console.error('Hierarchy note delete error', error);
      setNotesError('Não foi possível apagar esta nota.');
    } finally {
      setNoteDeletingId(null);
    }
  };

  const resetScheduleForm = () => {
    setScheduleForm(createScheduleFormDefaults());
    setEditingScheduleIndex(null);
    setScheduleFormError(null);
  };

  const handleScheduleFormInputChange = (field: 'title' | 'date' | 'status', value: string) => {
    setScheduleForm((prev) => ({
      ...prev,
      [field]: field === 'status' ? (value as CampaignScheduleStatus) : value
    }));
    if (scheduleFormError) setScheduleFormError(null);
  };

  const handleScheduleFormLeaderSelect = (value: string) => {
    setScheduleForm((prev) => ({
      ...prev,
      responsibleId: value,
      responsibleName: value ? '' : prev.responsibleName
    }));
    if (scheduleFormError) setScheduleFormError(null);
  };

  const handleScheduleFormResponsibleNameChange = (value: string) => {
    setScheduleForm((prev) => ({
      ...prev,
      responsibleName: value,
      responsibleId: value.trim().length ? '' : prev.responsibleId
    }));
    if (scheduleFormError) setScheduleFormError(null);
  };

  const handleScheduleEdit = (index: number) => {
    const target = campaignConfig.schedule[index];
    if (!target) return;
    setScheduleForm({
      date: target.date,
      title: target.title,
      status: (target.status || 'PLANEJADO') as CampaignScheduleStatus,
      responsibleId: target.responsibleName ? '' : target.responsibleId || '',
      responsibleName: target.responsibleName || ''
    });
    setEditingScheduleIndex(index);
    setScheduleFormError(null);
    setScheduleSuccess(null);
  };

  const handleScheduleFormSubmit = () => {
    if (!scheduleForm.date || !scheduleForm.title.trim()) {
      setScheduleFormError('Informe a data e o título do marco.');
      return;
    }
    const entry = {
      date: scheduleForm.date,
      title: scheduleForm.title.trim(),
      status: scheduleForm.status as CampaignScheduleStatus,
      responsibleId: scheduleForm.responsibleName.trim() ? null : scheduleForm.responsibleId || null,
      responsibleName: scheduleForm.responsibleName.trim() || null
    };
    setCampaignConfig((prev) => {
      const schedule = [...prev.schedule];
      if (typeof editingScheduleIndex === 'number' && schedule[editingScheduleIndex]) {
        schedule[editingScheduleIndex] = { ...schedule[editingScheduleIndex], ...entry };
      } else {
        schedule.push(entry);
      }
      return { ...prev, schedule };
    });
    setScheduleDirty(true);
    setScheduleSuccess(null);
    setScheduleFormError(null);
    resetScheduleForm();
  };

  const handleRemoveScheduleItem = (index: number) => {
    const target = campaignConfig.schedule[index];
    if (!target) return;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Remover o marco "${target.title}"?`);
      if (!confirmed) return;
    }
    setCampaignConfig((prev) => ({
      ...prev,
      schedule: prev.schedule.filter((_, idx) => idx !== index)
    }));
    setScheduleDirty(true);
    setScheduleSuccess(null);
    if (editingScheduleIndex !== null) {
      if (editingScheduleIndex === index) {
        resetScheduleForm();
      } else if (editingScheduleIndex > index) {
        setEditingScheduleIndex((prevIndex) => (typeof prevIndex === 'number' ? prevIndex - 1 : null));
      }
    }
  };

  const handleSaveChronogram = async () => {
    if (!operation?.id) {
      setScheduleError('Configure a operação antes de salvar o cronograma.');
      return;
    }
    const normalizeResponsibleId = (value?: string | null) => {
      if (!value) return null;
      const trimmed = value.trim();
      return UUID_REGEX.test(trimmed) ? trimmed : null;
    };
    const validEntries = campaignConfig.schedule
      .map((item) => ({
        ...item,
        title: item.title.trim(),
        date: item.date,
        status: (item.status || 'PLANEJADO') as CampaignScheduleStatus,
        responsibleId: item.responsibleName?.trim() ? null : normalizeResponsibleId(item.responsibleId),
        responsibleName: item.responsibleName?.trim() || null
      }))
      .filter((item) => item.date && item.title);

    if (!validEntries.length) {
      setScheduleError('Inclua ao menos um marco com data e título.');
      return;
    }

    setScheduleSaving(true);
    setScheduleError(null);
    try {
      const result = await saveOperationTimeline(operation.id, validEntries);
      setCampaignConfig((prev) => ({
        ...prev,
        schedule: result.entries,
        version: result.version
      }));
      setScheduleDirty(false);
      setScheduleSuccess(`Cronograma salvo (v${result.version}).`);
      setTimeout(() => setScheduleSuccess(null), 3000);
    } catch (error) {
      console.error('Cronograma save error', error);
      if ((error as any)?.code === MISSING_TIMELINE_RESPONSIBLE_COLUMN) {
        setScheduleError('Adicione a coluna responsavel_nome (text) em cronogramas_operacao para salvar nomes personalizados.');
        setSupportsTimelineResponsibleName(false);
      } else {
        setScheduleError('Não foi possível salvar o cronograma agora.');
      }
    } finally {
      setScheduleSaving(false);
    }
  };

  const resolveMemberLabel = (memberId?: string | null) => {
    if (!memberId) return null;
    const member = membersMap[memberId];
    if (!member) return null;
    return `${member.name}${member.role ? ` · ${member.role.replace('_', ' ')}` : ''}`;
  };

  const resolveNoteRecipients = (note: HierarchyNote) => {
    if (!note.recipients || note.recipients.length === 0) return 'Toda a operação';
    const names = note.recipients
      .map((id) => membersMap[id]?.name)
      .filter((value): value is string => Boolean(value));
    if (names.length === 0) return `${note.recipients.length} líderes selecionados`;
    return names.join(', ');
  };

  const resolveMemberResponsible = (member: MemberProfile) => {
    return resolveMemberLabel(member.leaderId) || (member.role === UserRole.SOLDIER ? 'Sem líder definido' : 'Direção');
  };

  const resolveScheduleResponsible = (item: CampaignScheduleItem) => {
    const manual = item.responsibleName?.trim();
    if (manual) return manual;
    return resolveMemberLabel(item.responsibleId);
  };

  const formatRoleLabel = (role: UserRole) => {
    switch (role) {
      case UserRole.L1:
        return 'Líder N1';
      case UserRole.L2:
        return 'Líder N2';
      case UserRole.L3:
        return 'Líder N3';
      case UserRole.SOLDIER:
        return 'Soldados';
      default:
        return role;
    }
  };

  const formatCpfDisplay = (value?: string | null) => {
    if (!value) return '--';
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 11) return value;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  };

  const formatPhoneDisplay = (value?: string | null) => {
    if (!value) return '--';
    return value.trim();
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const formatDateTimeLabel = (value?: string | null) => {
    if (!value) return '--';
    return new Date(value).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const sanitizePhoneNumber = (value?: string | null) => {
    if (!value) return '';
    return value.replace(/\D/g, '');
  };

  const formatDateLabel = (value?: string) => {
    if (!value) return '--';
    const parsed = new Date(`${value}T00:00:00`);
    return parsed.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
  };

  const formatTimeLabel = (value?: string) => {
    if (!value) return '--';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '--';
    return parsed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const formatLocationLabel = (location?: GeoPoint | null) => {
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return 'Local desconhecido';
    }
    return `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
  };

  const handleOpenTimesheet = (member: MemberProfile) => {
    setTimesheetModal({
      open: true,
      member,
      data: normalizeTimesheet(member.timesheet)
    });
  };

  const handleCloseTimesheet = () => {
    setTimesheetModal({ open: false, member: null, data: { days: [] } });
  };

  const handleCopyPix = async (memberId: string, pix?: string | null) => {
    if (!pix) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(pix);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = pix;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setPixCopiedId(memberId);
      setTimeout(() => setPixCopiedId((current) => (current === memberId ? null : current)), 2000);
    } catch (error) {
      console.warn('Não foi possível copiar a chave PIX', error);
    }
  };

  const getDailyRateInputValue = (member: MemberProfile) => {
    const draft = dailyRateDrafts[member.id];
    if (draft !== undefined) return draft;
    return member.dailyRate != null ? member.dailyRate.toString() : '';
  };

  const handleDailyRateInput = (memberId: string, value: string) => {
    setDailyRateDrafts((prev) => ({ ...prev, [memberId]: value }));
  };

  const handleDailyRateSave = async (member: MemberProfile) => {
    const draftValue = dailyRateDrafts[member.id];
    if (draftValue === undefined) return;
    const trimmed = draftValue.trim();
    const parsed = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
    if (trimmed !== '' && (Number.isNaN(parsed) || parsed < 0)) {
      setDailyRateError('Informe um valor numérico válido para a diária.');
      return;
    }
    const currentValue = member.dailyRate ?? null;
    if (parsed === currentValue) return;
    setDailyRateSavingId(member.id);
    setDailyRateError(null);
    try {
      await updateMemberDailyRate(member.id, parsed);
      setMembers((prev) =>
        prev.map((item) => (item.id === member.id ? { ...item, dailyRate: parsed } : item))
      );
      setMembersMap((prev) => {
        const current = prev[member.id] || member;
        return { ...prev, [member.id]: { ...current, dailyRate: parsed } };
      });
      setDailyRateDrafts((prev) => ({ ...prev, [member.id]: parsed == null ? '' : parsed.toString() }));
    } catch (error) {
      console.error('Erro ao salvar valor de diária', error);
      setDailyRateError('Não foi possível salvar o valor da diária.');
    } finally {
      setDailyRateSavingId(null);
    }
  };

  useEffect(() => {
    const loadSubmissions = async () => {
      if (!operation?.id) {
        setSubmissions([]);
        setAiInsight(null);
        return;
      }
      setSubmissionsLoading(true);
      try {
        const data = await fetchOperationSubmissions(operation.id);
        setSubmissions(data);
        if (data.length) {
          setAiLoading(true);
          const insight = await analyzeSubmissions(data.slice(0, 20), user.role);
          setAiInsight(insight);
        } else {
          setAiInsight(null);
        }
      } catch (error) {
        console.error('Submissions fetch error', error);
        setAiInsight(null);
      } finally {
        setSubmissionsLoading(false);
        setAiLoading(false);
      }
    };
    loadSubmissions();
  }, [operation?.id, user.role]);

  const sentimentChartData = useMemo(() => {
    const data = [
      { name: 'Positivo', key: VoterSentiment.POSITIVO, value: 0 },
      { name: 'Neutro', key: VoterSentiment.NEUTRO, value: 0 },
      { name: 'Negativo', key: VoterSentiment.NEGATIVO, value: 0 }
    ];
    submissions.forEach((submission) => {
      const sentiment = submission.voterInteraction?.sentimento;
      const entry = data.find((item) => item.key === sentiment);
      if (entry) entry.value += 1;
    });
    return data;
  }, [submissions]);

  const topNeighborhoodData = useMemo(() => {
    const counter: Record<string, number> = {};
    submissions.forEach((submission) => {
      const bairro = submission.locationDetails?.bairro?.trim();
      if (bairro) {
        counter[bairro] = (counter[bairro] || 0) + 1;
      }
    });
    return Object.entries(counter)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [submissions]);

  const totalSubmissions = submissions.length;
  const COLORS = ['#10b981', '#6366f1', '#ef4444'];

  const renderOperationConfigCard = () => (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <i className="fas fa-flag text-indigo-500"></i> Configuração da Operação
        </h3>
        <span className="text-[10px] font-black text-slate-400 uppercase">1 operação por diretor</span>
      </div>
      {operationLoading ? (
        <div className="space-y-3">
          <div className="h-12 bg-slate-100 rounded-xl animate-pulse"></div>
          <div className="h-12 bg-slate-100 rounded-xl animate-pulse"></div>
          <div className="h-12 bg-slate-100 rounded-xl animate-pulse"></div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleOperationSave}>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Nome da Operação</label>
            <input
              type="text"
              value={operationNameInput}
              onChange={(e) => setOperationNameInput(e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="Ex: Campanha João Silva 2024"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Estado</label>
            <select
              value={operationStateInput}
              onChange={(e) => setOperationStateInput(e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
            >
              {Object.keys(STATE_METADATA).map((uf) => (
                <option key={uf} value={uf}>
                  {uf} - {STATE_METADATA[uf].name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Cargo em disputa</label>
            <select
              value={operationCampaignType}
              onChange={(e) => setOperationCampaignType(e.target.value as CampaignTypeValue | '')}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Selecione o cargo desta operação</option>
              {CAMPAIGN_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase">Perfil do candidato</p>
              <p className="text-sm text-slate-500">Dados exibidos em materiais internos e dashboards.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Nome completo</label>
                <input
                  type="text"
                  value={candidateForm.name}
                  onChange={(e) => handleCandidateFormChange('name', e.target.value)}
                  className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="Ex: João Silva"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Número na urna</label>
                <input
                  type="text"
                  value={candidateForm.number}
                  onChange={(e) => handleCandidateFormChange('number', e.target.value)}
                  className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="Ex: 22"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Partido</label>
                <input
                  type="text"
                  value={candidateForm.party}
                  onChange={(e) => handleCandidateFormChange('party', e.target.value)}
                  className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="Ex: PL"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Foto do candidato (URL)</label>
                <input
                  type="text"
                  value={candidateForm.photoUrl}
                  onChange={(e) => handleCandidateFormChange('photoUrl', e.target.value)}
                  className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Santinho digital (URL)</label>
                <input
                  type="text"
                  value={candidateForm.santinhoUrl}
                  onChange={(e) => handleCandidateFormChange('santinhoUrl', e.target.value)}
                  className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="https://..."
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Cor primária</label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="color"
                    value={candidateForm.colorPrimary}
                    onChange={(e) => handleCandidateFormChange('colorPrimary', e.target.value)}
                    className="w-12 h-12 rounded-xl border border-slate-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={candidateForm.colorPrimary}
                    onChange={(e) => handleCandidateFormChange('colorPrimary', e.target.value)}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    placeholder="#4338ca"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Cor secundária</label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="color"
                    value={candidateForm.colorSecondary}
                    onChange={(e) => handleCandidateFormChange('colorSecondary', e.target.value)}
                    className="w-12 h-12 rounded-xl border border-slate-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={candidateForm.colorSecondary}
                    onChange={(e) => handleCandidateFormChange('colorSecondary', e.target.value)}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    placeholder="#0f172a"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Discurso / Manifesto</label>
              <textarea
                value={candidateForm.speech}
                onChange={(e) => handleCandidateFormChange('speech', e.target.value)}
                rows={4}
                className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="Mensagem-chave apresentada à tropa."
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Links de redes sociais</label>
                <textarea
                  value={candidateForm.socialLinks}
                  onChange={(e) => handleCandidateFormChange('socialLinks', e.target.value)}
                  rows={4}
                  className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="Instagram | https://instagram.com/candidato"
                />
                <p className="mt-1 text-[11px] text-slate-500">Use uma linha por link no formato NOME | URL.</p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Outros links úteis</label>
                <textarea
                  value={candidateForm.otherLinks}
                  onChange={(e) => handleCandidateFormChange('otherLinks', e.target.value)}
                  rows={4}
                  className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="Plano de Governo | https://..."
                />
                <p className="mt-1 text-[11px] text-slate-500">Linha por link, também no formato NOME | URL.</p>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Feitos importantes</label>
              <textarea
                value={candidateForm.highlights}
                onChange={(e) => handleCandidateFormChange('highlights', e.target.value)}
                rows={4}
                className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="Linha por feito / marco da trajetória."
              />
              <p className="mt-1 text-[11px] text-slate-500">Separe cada feito em uma linha.</p>
            </div>
            <div className="pt-2">
              <label className="text-xs font-bold text-slate-500 uppercase">Santinho digital</label>
              {operation?.slug ? (
                <div className="mt-2 flex flex-col gap-2">
                  <div className="flex flex-col md:flex-row md:items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={buildSantinhoLink()}
                      className="flex-1 border border-slate-200 rounded-xl px-4 py-2 text-sm bg-slate-50 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopySantinhoLink}
                      className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50"
                    >
                      {santinhoLinkCopied ? 'Link copiado!' : 'Copiar link'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Compartilhe com apoiadores: qualquer pessoa com o link pode visualizar o santinho digital.
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  Salve a operação primeiro para gerar o link compartilhável.
                </p>
              )}
            </div>
            <div className="pt-6 border-t border-slate-100 space-y-3">
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase">Prévia em tempo real</p>
                <p className="text-sm text-slate-500">As cores definidas acima também se aplicam à plataforma.</p>
              </div>
              <div className="flex justify-center">
                <SantinhoCard
                  name={candidatePreview.name}
                  number={candidatePreview.number}
                  party={candidatePreview.party}
                  speech={candidatePreview.speech}
                  photoUrl={candidatePreview.photoUrl}
                  santinhoUrl={candidatePreview.santinhoUrl}
                  highlights={candidatePreview.highlights.length ? candidatePreview.highlights : undefined}
                  socialLinks={candidatePreview.socialLinks}
                  otherLinks={candidatePreview.otherLinks}
                  operationName={candidatePreview.operationName}
                  brandPrimary={brandPrimary}
                  brandSecondary={brandSecondary}
                />
              </div>
            </div>
          </div>
          <button
            type="submit"
            disabled={operationSaving}
            className="brand-btn w-full py-3 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {operationSaving ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-save"></i>}
            {operation ? 'Atualizar Operação' : 'Registrar Operação'}
          </button>
          {operationSuccessMessage && <p className="text-sm text-emerald-600">{operationSuccessMessage}</p>}
          {operationError && <p className="text-sm text-red-500">{operationError}</p>}
        </form>
      )}
    </div>
  );

  const renderDirectorLeaderInvitesCard = () => {
    if (!operation) return null;
    return (
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <i className="fas fa-link text-indigo-500"></i> Convites para Líderes
            </h3>
            <p className="text-sm text-slate-500">Operação: {operation.nome || 'Sem nome'}</p>
          </div>
          <span className="text-xs font-bold text-indigo-500">Estado {operation.estado}</span>
        </div>
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleDirectorInvite}
            disabled={leaderInviteGenerating}
            className="brand-btn w-full py-3 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {leaderInviteGenerating ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-bolt"></i>}
            Gerar link para Líder
          </button>

          {leaderInviteError && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">{leaderInviteError}</div>
          )}

          {leaderInviteResult && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase">Token</p>
                <p className="text-sm font-mono break-all">{leaderInviteResult.token}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase">Link direto</p>
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    readOnly
                    value={leaderInviteResult.link}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLeaderInvite}
                    className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <i className={`fas ${leaderInviteCopied ? 'fa-check text-emerald-500' : 'fa-copy text-slate-500'}`}></i>
                    {leaderInviteCopied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {inviteListError && (
            <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">
              {inviteListError}
            </div>
          )}
          {inviteActionError && (
            <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">
              {inviteActionError}
            </div>
          )}
          <div className="pt-4 border-t border-slate-100 space-y-2">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Links ativos</p>
            {leaderInviteHistory.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhum convite ativo no momento.</p>
            ) : (
              leaderInviteHistory.slice(0, 6).map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50"
                >
                  <div className="flex-1">
                    <p className="text-xs font-mono break-all">{invite.token}</p>
                    <p className="text-[11px] text-slate-500">
                      Validade: {formatInviteExpiration(invite.expires_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyActiveInvite(invite.token)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-white transition-colors"
                    >
                      {copiedInviteToken === invite.token ? 'Copiado' : 'Copiar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(invite.id)}
                      disabled={inviteRevokingId === invite.id}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {inviteRevokingId === invite.id ? 'Revogando...' : 'Revogar'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderDirectorSoldierInvitesCard = () => {
    if (!operation || user.role !== UserRole.DIRECTOR) return null;
    return (
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <i className="fas fa-users text-indigo-500"></i> Convites de Soldados
            </h3>
            <p className="text-sm text-slate-500">Monitorando os links emitidos pelos líderes.</p>
          </div>
          <span className="text-xs font-bold text-indigo-500 uppercase">
            {soldierInviteHistory.length} ativos
          </span>
        </div>
        {inviteListError && (
          <div className="mb-4 p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">
            {inviteListError}
          </div>
        )}
        {soldierInviteHistory.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum convite ativo emitido pelos líderes.</p>
        ) : (
          <div className="space-y-3">
            {soldierInviteHistory.slice(0, 8).map((invite) => (
              <div
                key={`director-soldier-${invite.id}`}
                className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50"
              >
                <div className="flex-1">
                  <p className="text-xs font-mono break-all">{invite.token}</p>
                  <p className="text-[11px] text-slate-500">
                    Validade: {formatInviteExpiration(invite.expires_at)}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Emitido por: {resolveMemberLabel(invite.emitido_por) || 'Diretoria'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyActiveInvite(invite.token)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-white transition-colors"
                  >
                    {copiedInviteToken === invite.token ? 'Copiado' : 'Copiar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevokeInvite(invite.id)}
                    disabled={inviteRevokingId === invite.id}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    {inviteRevokingId === invite.id ? 'Revogando...' : 'Revogar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };


  const renderLeaderManagement = () => (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mt-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <i className="fas fa-people-line text-indigo-500"></i> Reforço de Soldados
          </h3>
          <p className="text-sm text-slate-500">Operação: {operation?.nome || 'Não identificado'}</p>
        </div>
        {operation?.estado && (
          <span className="text-xs font-bold text-indigo-500 uppercase">{operation.estado}</span>
        )}
      </div>

      {!operation ? (
        <p className="text-sm text-red-500">
          Operação não identificada. Solicite ao diretor que valide seu acesso antes de recrutar soldados.
        </p>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleLeaderInvite}
            disabled={soldierInviteGenerating}
            className="brand-btn w-full py-3 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {soldierInviteGenerating ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-bolt"></i>}
            Gerar link para Soldado
          </button>

          {soldierInviteError && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">{soldierInviteError}</div>
          )}

          {soldierInviteResult && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase">Token</p>
                <p className="text-sm font-mono break-all">{soldierInviteResult.token}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase">Link direto</p>
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    readOnly
                    value={soldierInviteResult.link}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleCopySoldierInvite}
                    className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <i className={`fas ${soldierInviteCopied ? 'fa-check text-emerald-500' : 'fa-copy text-slate-500'}`}></i>
                    {soldierInviteCopied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 space-y-2">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Convites ativos</p>
            {inviteListError && (
              <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">
                {inviteListError}
              </div>
            )}
            {inviteActionError && (
              <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">
                {inviteActionError}
              </div>
            )}
            {soldierInviteHistory.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhum convite disponível. Gere e compartilhe com seus soldados.</p>
            ) : (
              soldierInviteHistory.slice(0, 6).map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50"
                >
                  <div className="flex-1">
                    <p className="text-xs font-mono break-all">{invite.token}</p>
                    <p className="text-[11px] text-slate-500">
                      Validade: {formatInviteExpiration(invite.expires_at)}
                    </p>
                    {resolveMemberLabel(invite.emitido_por) && (
                      <p className="text-[11px] text-slate-400">
                        Emitido por: {resolveMemberLabel(invite.emitido_por)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyActiveInvite(invite.token)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-white transition-colors"
                    >
                      {copiedInviteToken === invite.token ? 'Copiado' : 'Copiar'}
                    </button>
                    {(user.role === UserRole.DIRECTOR || invite.emitido_por === user.id) && (
                      <button
                        type="button"
                        onClick={() => handleRevokeInvite(invite.id)}
                        disabled={inviteRevokingId === invite.id}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {inviteRevokingId === invite.id ? 'Revogando...' : 'Revogar'}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );

  const selectedState = STATE_METADATA[campaignConfig.state];
  const leaderProfiles = useMemo(() => {
    const map = new Map<string, MemberProfile>();
    members.forEach((member) => {
      if ([UserRole.L1, UserRole.L2, UserRole.L3].includes(member.role)) {
        map.set(member.id, member);
      }
    });
    leaderSummaries.forEach((summary) => {
      if (!map.has(summary.leaderId)) {
        map.set(summary.leaderId, {
          id: summary.leaderId,
          name: summary.leaderName,
          role: summary.leaderRole,
          leaderId: membersMap[summary.leaderId]?.leaderId || null
        });
      }
    });
    return Array.from(map.values());
  }, [members, leaderSummaries, membersMap]);
  const leaderZoneMap = useMemo(() => {
    return leaderSummaries.reduce((acc, summary) => {
      acc[summary.leaderId] = summary.zones.map((zone) => zone.name);
      return acc;
    }, {} as Record<string, string[]>);
  }, [leaderSummaries]);
  const zoneDirectory = useMemo(() => {
    if (zoneDirectoryData.length > 0) {
      return zoneDirectoryData;
    }
    const map = new Map<string, ZoneDirectoryEntry>();
    leaderSummaries.forEach((summary) => {
      summary.zones.forEach((zone) => {
        if (!map.has(zone.id)) {
          map.set(zone.id, { id: zone.id, name: zone.name, leaderIds: [], subzones: [] });
        }
        map.get(zone.id)!.leaderIds.push(summary.leaderId);
      });
    });
    return Array.from(map.values());
  }, [zoneDirectoryData, leaderSummaries]);
  const subzoneDirectoryMap = useMemo(() => {
    const map: Record<string, { name: string; leaderIds: string[]; zoneId: string }> = {};
    zoneDirectory.forEach((zone) => {
      zone.subzones?.forEach((subzone) => {
        map[subzone.id] = { name: subzone.name, leaderIds: subzone.leaderIds, zoneId: zone.id };
      });
    });
    return map;
  }, [zoneDirectory]);
  const subordinateCountMap = useMemo(() => {
    return members.reduce((acc, member) => {
      if (member.leaderId) {
        acc[member.leaderId] = (acc[member.leaderId] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
  }, [members]);
  const leaderToSoldiersMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    members.forEach((member) => {
      if (member.role === UserRole.SOLDIER && member.leaderId) {
        if (!map[member.leaderId]) map[member.leaderId] = [];
        map[member.leaderId].push(member.id);
      }
    });
    return map;
  }, [members]);
  const activeMembersCount = members.length;
  const financeRoleStats = useMemo(() => {
    const stats: Record<string, number> & { total: number } = {
      total: 0,
      [UserRole.L1]: 0,
      [UserRole.L2]: 0,
      [UserRole.L3]: 0,
      [UserRole.SOLDIER]: 0
    };
    members.forEach((member) => {
      stats.total += 1;
      if (typeof stats[member.role] === 'number') {
        stats[member.role] += 1;
      }
    });
    return stats;
  }, [members]);
  const filteredFinanceMembers = useMemo(() => {
    const term = financeSearch.trim().toLowerCase();
    return members.filter((member) => {
      const matchesRole = financeRoleFilter === 'ALL' || member.role === financeRoleFilter;
      if (!matchesRole) return false;
      if (!term) return true;
      const searchable = `${member.name} ${member.phone || ''} ${member.cpf || ''}`.toLowerCase();
      return searchable.includes(term);
    });
  }, [members, financeSearch, financeRoleFilter]);

  const renderCommandView = () => (
    <>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            Comando Central 
            <span className="text-indigo-600 text-lg opacity-30">/</span>
            <span className="text-indigo-600">{selectedState?.name}</span>
          </h2>
          <p className="text-slate-500 font-medium">Visualização tática de inteligência territorial.</p>
        </div>
        <div className="flex items-center gap-3">
           <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-200">
            <span className="w-2 h-2 bg-indigo-500 rounded-full animate-ping"></span>
            <span className="text-xs font-bold text-slate-700">Monitorando {campaignConfig.state}</span>
          </div>
        </div>
      </header>

      <ZonePlanner
        operationId={operation?.id}
        stateCenter={
          selectedState
            ? { lat: selectedState.coords[0], lng: selectedState.coords[1], zoom: selectedState.zoom }
            : undefined
        }
        readOnly={user.role !== UserRole.DIRECTOR}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="space-y-6 xl:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-6">
                <h4 className="font-bold text-slate-800 flex items-center gap-2">
                  <i className="fas fa-heart text-indigo-500"></i> Sentimento Regional
                </h4>
                <span className="text-[11px] font-black text-slate-400 uppercase">
                  {totalSubmissions} relatos
                </span>
              </div>
              <div className="h-64">
                {submissionsLoading ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm">Carregando inteligência...</div>
                ) : sentimentChartData.every((entry) => entry.value === 0) ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                    Nenhum dado de sentimento ainda.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={sentimentChartData} cx="50%" cy="50%" innerRadius={70} outerRadius={95} paddingAngle={10} dataKey="value">
                        {sentimentChartData.map((entry, index) => (
                          <Cell key={`cell-${entry.key}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
              <h4 className="font-bold mb-6 text-slate-800 flex items-center gap-2">
                <i className="fas fa-chart-simple text-indigo-500"></i> Eficiência por Bairro
              </h4>
              <div className="h-64">
                {submissionsLoading ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm">Carregando dados...</div>
                ) : topNeighborhoodData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                    Cadastre relatos com bairro para visualizar.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topNeighborhoodData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '15px', border: 'none' }} />
                      <Bar dataKey="value" fill="#6366f1" radius={[10, 10, 0, 0]} barSize={45} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-indigo-900 text-white p-6 rounded-3xl shadow-2xl shadow-indigo-900/40 border border-indigo-700 relative overflow-hidden">
             <div className="absolute top-0 right-0 p-3 opacity-10">
               <i className="fas fa-brain text-7xl"></i>
             </div>
             <div className="flex items-center gap-3 mb-6 relative">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-md border border-white/20">
                  <i className="fas fa-robot text-indigo-300"></i>
                </div>
                <h3 className="text-xl font-black tracking-tight uppercase">SÍNTESE IA</h3>
             </div>
             
             {aiLoading ? (
               <div className="space-y-4 animate-pulse">
                 <div className="h-4 bg-white/10 rounded w-3/4"></div>
                 <div className="h-40 bg-white/10 rounded"></div>
               </div>
             ) : aiInsight ? (
               <div className="space-y-6 relative">
                 <p className="text-indigo-100/90 text-sm leading-relaxed font-medium bg-indigo-950/50 p-4 rounded-2xl border border-white/5">
                   "{aiInsight.summary}"
                 </p>
                 <div className="flex flex-wrap gap-2">
                   {aiInsight.topThemes?.map((t: string) => (
                     <span key={t} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 transition-colors rounded-xl text-[10px] font-black border border-white/10">
                       {t}
                     </span>
                   ))}
                 </div>
                 
                 {user.role === UserRole.DIRECTOR && aiInsight.candidateBriefing && (
                   <div className="pt-6 border-t border-white/10 space-y-5">
                     <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Comando do Candidato</h4>
                     <div className="space-y-4">
                        <div className="flex gap-4 p-3 bg-white/5 rounded-2xl border border-white/5">
                           <div className="w-8 h-8 shrink-0 bg-red-500/20 text-red-400 rounded-lg flex items-center justify-center">
                             <i className="fas fa-bolt text-xs"></i>
                           </div>
                           <div>
                             <p className="text-[10px] font-black text-red-400 uppercase">Foco Crítico</p>
                             <p className="text-xs text-white font-medium">{aiInsight.candidateBriefing.risks[0]}</p>
                           </div>
                        </div>
                        <div className="flex gap-4 p-3 bg-white/5 rounded-2xl border border-white/5">
                           <div className="w-8 h-8 shrink-0 bg-emerald-500/20 text-emerald-400 rounded-lg flex items-center justify-center">
                             <i className="fas fa-bullseye text-xs"></i>
                           </div>
                           <div>
                             <p className="text-[10px] font-black text-emerald-400 uppercase">Oportunidade</p>
                             <p className="text-xs text-white font-medium">{aiInsight.candidateBriefing.opportunities[0]}</p>
                           </div>
                        </div>
                     </div>
                   </div>
                 )}
               </div>
             ) : (
               <div className="text-sm text-indigo-100/70">
                 Ainda sem dados suficientes para gerar a síntese. Solicite relatos no campo e tente novamente.
               </div>
             )}
          </div>
          
          {user.role !== UserRole.DIRECTOR && (
            <div className="bg-amber-50 p-6 rounded-3xl border border-amber-200/50 shadow-sm relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                 <i className="fas fa-bullhorn text-5xl"></i>
               </div>
               <h4 className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-3">DIRETRIZ DE CAMPO</h4>
               <p className="text-sm font-bold text-amber-900 leading-relaxed italic relative z-10">
                 "Concentrem esforços em ouvir o eleitor que ainda não decidiu. Cada dúvida é uma oportunidade de voto."
               </p>
               <div className="mt-4 flex items-center gap-2">
                 <div className="w-2 h-2 bg-amber-400 rounded-full"></div>
                 <span className="text-[9px] font-black text-amber-600 uppercase">Assinado: Comando Central</span>
               </div>
            </div>
          )}
        </div>
      </div>

    </>
  );

  const renderStructureView = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Estrutura e Avisos</h2>
          <p className="text-slate-500 font-medium">Gerencie líderes, zonas e notas direcionadas.</p>
        </div>
        <div className="flex gap-2 text-[10px] font-black text-slate-500">
          <span className="bg-slate-100 px-3 py-1 rounded">Ativos: {activeMembersCount}</span>
          <span className="bg-slate-100 px-3 py-1 rounded">Líderes: {leaderProfiles.length}</span>
        </div>
      </div>
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        {membersError && (
          <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">
            {membersError}
          </div>
        )}
        {membersLoading ? (
          <div className="space-y-3">
            {[1, 2].map((item) => (
              <div key={item} className="h-20 bg-slate-100 rounded-2xl animate-pulse"></div>
            ))}
          </div>
        ) : leaderProfiles.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum líder cadastrado nesta operação ainda.</p>
        ) : (
          <div className="space-y-4">
            {leaderProfiles.map((leader) => {
              const zones = leaderZoneMap[leader.id] || [];
              const subCount = subordinateCountMap[leader.id] || 0;
              return (
                <div
                  key={leader.id}
                  className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-bold text-slate-800">{leader.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {formatRoleLabel(leader.role)} · {subCount} subordinados
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {zones.length === 0 ? (
                      <span className="text-[11px] text-slate-400">Sem zona atribuída</span>
                    ) : (
                      zones.map((zone) => (
                        <span
                          key={`${leader.id}-${zone}`}
                          className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200"
                        >
                          {zone}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-slate-100 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-500 uppercase">Notas de Comando</p>
            {noteSuccessMessage && (
              <span className="text-[11px] text-emerald-600 font-semibold">{noteSuccessMessage}</span>
            )}
          </div>
          {notesError && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">
              {notesError}
            </div>
          )}
          {notesFeatureBlocked && (
            <div className="p-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl">
              Para direcionar notas, execute no Supabase: `alter table public.hierarquia_notas add column destinatarios uuid[];`
            </div>
          )}
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase">Alcance</label>
            <div
              className={`grid ${
                noteRecipientsSupported ? 'grid-cols-2' : 'grid-cols-1'
              } gap-2 mt-1`}
            >
              {(
                noteRecipientsSupported
                  ? [
                      { label: 'Toda operação', value: 'ALL' },
                      { label: 'Por líder', value: 'BY_LEADER' },
                      { label: 'Por zona', value: 'BY_ZONE' },
                      { label: 'Selecionar pessoas', value: 'BY_MEMBER' }
                    ]
                  : [{ label: 'Toda operação', value: 'ALL' }]
              ).map((option) => (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => handleNoteComposerChange('scope', option.value)}
                  className={`px-3 py-2 rounded-xl border text-xs font-bold ${
                    noteComposer.targetScope === option.value ? 'text-white' : 'bg-white text-slate-500 border-slate-200'
                  }`}
                  style={
                    noteComposer.targetScope === option.value
                      ? { backgroundColor: brandPrimary, borderColor: brandPrimary }
                      : undefined
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {noteRecipientsSupported && noteComposer.targetScope === 'BY_LEADER' && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-40 overflow-auto flex flex-wrap gap-2">
              {leaderProfiles.length === 0 ? (
                <p className="text-xs text-slate-500">Cadastre líderes antes de direcionar notas.</p>
              ) : (
                leaderProfiles.map((leader) => {
                  const isSelected = noteComposer.selectedLeaders.includes(leader.id);
                  return (
                    <button
                      type="button"
                      key={`select-leader-${leader.id}`}
                      onClick={() => toggleLeaderRecipient(leader.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                        isSelected ? 'text-white' : 'bg-white text-slate-500 border-slate-200'
                      }`}
                      style={
                        isSelected ? { backgroundColor: brandPrimary, borderColor: brandPrimary } : undefined
                      }
                    >
                      {leader.name} · {subordinateCountMap[leader.id] || 0} soldados
                    </button>
                  );
                })
              )}
            </div>
          )}

          {noteRecipientsSupported && noteComposer.targetScope === 'BY_ZONE' && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-40 overflow-auto flex flex-wrap gap-2">
              {zoneDirectory.length === 0 ? (
                <p className="text-xs text-slate-500">Associe líderes a zonas para liberar esta opção.</p>
              ) : (
                zoneDirectory.map((zone) => {
                  const isSelected = noteComposer.selectedZones.includes(zone.id);
                  return (
                    <button
                      type="button"
                      key={`select-zone-${zone.id}`}
                      onClick={() => toggleZoneRecipient(zone.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                        isSelected ? 'text-white' : 'bg-white text-slate-500 border-slate-200'
                      }`}
                      style={
                        isSelected ? { backgroundColor: brandPrimary, borderColor: brandPrimary } : undefined
                      }
                    >
                      {zone.name} · {zone.leaderIds.length} líder(es)
                    </button>
                  );
                })
              )}
            </div>
          )}

          {noteRecipientsSupported &&
            noteComposer.targetScope === 'BY_ZONE' &&
            zoneDirectory.some((zone) => zone.subzones && zone.subzones.length > 0) && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-40 overflow-auto flex flex-wrap gap-2">
                {zoneDirectory.flatMap((zone) => zone.subzones || []).map((subzone) => {
                  const isSelected = noteComposer.selectedSubzones.includes(subzone.id);
                  return (
                    <button
                      type="button"
                      key={`select-subzone-${subzone.id}`}
                      onClick={() => toggleSubzoneRecipient(subzone.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                        isSelected ? 'text-white' : 'bg-white text-slate-500 border-slate-200'
                      }`}
                      style={
                        isSelected ? { backgroundColor: brandPrimary, borderColor: brandPrimary } : undefined
                      }
                    >
                      {subzone.name}
                    </button>
                  );
                })}
              </div>
            )}

          {noteRecipientsSupported && noteComposer.targetScope === 'BY_MEMBER' && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-40 overflow-auto flex flex-wrap gap-2">
              {members.filter((member) => member.role === noteComposer.role).length === 0 ? (
                <p className="text-xs text-slate-500">Nenhum membro com este perfil foi encontrado.</p>
              ) : (
                members
                  .filter((member) => member.role === noteComposer.role)
                  .map((member) => {
                    const isSelected = noteComposer.selectedMembers.includes(member.id);
                    return (
                      <button
                        type="button"
                        key={`select-member-${member.id}`}
                        onClick={() => toggleMemberRecipient(member.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                      isSelected ? 'text-white' : 'bg-white text-slate-500 border-slate-200'
                    }`}
                    style={
                      isSelected
                        ? { backgroundColor: brandPrimary, borderColor: brandPrimary }
                        : undefined
                    }
                      >
                        {member.name}
                      </button>
                    );
                  })
              )}
            </div>
          )}

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase">Mensagem</label>
            <textarea
              value={noteComposer.text}
              onChange={(e) => handleNoteComposerChange('text', e.target.value)}
              rows={3}
              className="mt-1 w-full bg-white border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="Escreva a diretriz de comando..."
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleNoteCreate}
              disabled={noteActionLoading || notesFeatureBlocked}
              className="brand-btn px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-50"
            >
              {noteActionLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-paper-plane"></i>}
              Lançar Nota
            </button>
            <span className="text-[11px] text-slate-500">
              Histórico recente: {hierarchyNotes.length} registros
            </span>
          </div>

          <div className="space-y-3">
            {notesLoading ? (
              <div className="space-y-3">
                {[1, 2].map((item) => (
                  <div key={`note-skeleton-${item}`} className="h-16 bg-slate-100 rounded-2xl animate-pulse"></div>
                ))}
              </div>
            ) : hierarchyNotes.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma nota registrada ainda.</p>
            ) : (
              hierarchyNotes.slice(0, 6).map((note) => (
                <div key={note.id} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-black text-slate-700">{formatRoleLabel(note.role)}</p>
                      <p className="text-[11px] text-slate-500">
                        {new Date(note.updatedAt).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => note.id && handleDeleteNote(note.id)}
                      disabled={noteDeletingId === note.id}
                      className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
                    >
                      {noteDeletingId === note.id ? 'Apagando...' : 'Apagar'}
                    </button>
                  </div>
                  <p className="text-sm text-slate-800 mt-2">{note.text}</p>
                  <p className="text-[11px] text-slate-500 mt-2">
                    Destino: {resolveNoteRecipients(note)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderCronogramaView = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Cronograma</h2>
          <p className="text-slate-500 font-medium">Visualize e versione os marcos da operação.</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Versão</p>
          <p className="text-sm font-black text-indigo-600">
            {campaignConfig.version ? `v${campaignConfig.version}` : 'Sem histórico'}
          </p>
          {scheduleDirty && <span className="text-[10px] font-black text-amber-600 uppercase">Rascunho</span>}
        </div>
      </div>
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase">Gerenciar marcos</p>
              <p className="text-sm text-slate-500">
                {editingScheduleIndex !== null ? 'Editando um marco existente' : 'Adicione marcos importantes da operação'}
              </p>
            </div>
            {editingScheduleIndex !== null && (
              <button
                type="button"
                onClick={resetScheduleForm}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-500"
              >
                Cancelar edição
              </button>
            )}
          </div>
          {scheduleFormError && (
            <div className="p-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl">{scheduleFormError}</div>
          )}
          {!supportsTimelineResponsibleName && (
            <div className="p-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl">
              Para salvar nomes personalizados de responsáveis, adicione a coluna <code className="font-mono">responsavel_nome</code> (TEXT) na tabela <code className="font-mono">cronogramas_operacao</code>.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3 items-end">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Data</label>
              <input
                type="date"
                value={scheduleForm.date}
                onChange={(e) => handleScheduleFormInputChange('date', e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Título</label>
              <input
                type="text"
                value={scheduleForm.title}
                onChange={(e) => handleScheduleFormInputChange('title', e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="Descrição do marco"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Status</label>
              <select
                value={scheduleForm.status}
                onChange={(e) => handleScheduleFormInputChange('status', e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              >
                {SCHEDULE_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Líder responsável</label>
              <select
                value={scheduleForm.responsibleId}
                onChange={(e) => handleScheduleFormLeaderSelect(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Selecionar líder (opcional)</option>
                {leaderOptions.map((leader) => (
                  <option key={leader.id} value={leader.id}>
                    {leader.name} · {formatRoleLabel(leader.role)}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Ou outro responsável</label>
              <input
                type="text"
                value={scheduleForm.responsibleName}
                onChange={(e) => handleScheduleFormResponsibleNameChange(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="Nome livre"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleScheduleFormSubmit}
              className="brand-btn px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2"
            >
              <i className={`fas ${editingScheduleIndex !== null ? 'fa-check-circle' : 'fa-plus'}`}></i>
              {editingScheduleIndex !== null ? 'Atualizar marco' : 'Adicionar marco'}
            </button>
            <button
              type="button"
              onClick={resetScheduleForm}
              className="brand-outline-btn px-4 py-2 text-xs font-bold rounded-xl"
            >
              Limpar campos
            </button>
          </div>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Marcos de Operação</label>
          {timelineLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-20 bg-slate-100 rounded-2xl animate-pulse"></div>
              ))}
            </div>
          ) : campaignConfig.schedule.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum marco registrado ainda.</p>
          ) : (
            campaignConfig.schedule.map((item, idx) => {
              const isElection = item.title.toUpperCase().includes("ELEIÇÃO");
              const statusClass = SCHEDULE_STATUS_BADGE[item.status || 'PLANEJADO'];
              const responsibleLabel = resolveScheduleResponsible(item);
              return (
                <div key={idx} className={`flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-xl border transition-all ${isElection ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-slate-50 border-slate-100'}`}>
                  <div
                    className={`w-12 text-center flex flex-col items-center justify-center p-1 rounded-lg ${
                      isElection ? 'text-white' : 'bg-white border text-slate-600'
                    }`}
                    style={isElection ? { backgroundColor: brandPrimary, borderColor: brandPrimary } : undefined}
                  >
                    <span className="text-[10px] uppercase font-bold opacity-80">{formatScheduleMonth(item.date)}</span>
                    <span className="text-lg font-black leading-none">{formatScheduleDay(item.date)}</span>
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-bold ${isElection ? 'text-indigo-900' : 'text-slate-800'}`}>{item.title}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span>Status:</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${statusClass}`}>
                        {getScheduleStatusLabel(item.status)}
                      </span>
                    </div>
                    {responsibleLabel && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        Responsável: <span className="font-semibold text-slate-700">{responsibleLabel}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 self-end md:self-auto">
                    <button
                      type="button"
                      onClick={() => handleScheduleEdit(idx)}
                      className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-white"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveScheduleItem(idx)}
                      className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                    >
                      Apagar
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="pt-4 border-t border-slate-100 space-y-3">
          {scheduleSuccess && <span className="text-[11px] text-emerald-600 font-semibold">{scheduleSuccess}</span>}
          {scheduleError && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">{scheduleError}</div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveChronogram}
              disabled={!scheduleDirty || scheduleSaving}
              className="brand-btn px-4 py-2 text-xs font-bold rounded-xl disabled:opacity-50 flex items-center gap-2"
            >
              {scheduleSaving ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-save"></i>}
              Salvar Cronograma
            </button>
            {scheduleDirty && (
              <span className="text-[11px] font-semibold text-amber-600 uppercase">Rascunho não salvo</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderFinanceView = () => {
    const filterOptions: { label: string; value: FinanceRoleFilter }[] = [
      { label: 'Todos', value: 'ALL' },
      { label: 'Líder N1', value: UserRole.L1 },
      { label: 'Líder N2', value: UserRole.L2 },
      { label: 'Líder N3', value: UserRole.L3 },
      { label: 'Soldados', value: UserRole.SOLDIER }
    ];
    const cards = [
      { label: 'Ativos', value: financeRoleStats.total, icon: 'fa-users' },
      { label: 'Líderes N1', value: financeRoleStats[UserRole.L1] || 0, icon: 'fa-user-shield' },
      { label: 'Líderes N2', value: financeRoleStats[UserRole.L2] || 0, icon: 'fa-user-tie' },
      { label: 'Líderes N3', value: financeRoleStats[UserRole.L3] || 0, icon: 'fa-people-group' },
      { label: 'Soldados', value: financeRoleStats[UserRole.SOLDIER] || 0, icon: 'fa-person-military-pointing' }
    ];

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Controle e Financeiro</h2>
            <p className="text-slate-500 font-medium">
              Visão completa dos membros da operação, com dados para repasses e auditoria.
            </p>
          </div>
          <div className="flex gap-2 text-[10px] font-black text-slate-500">
            <span className="bg-slate-100 px-3 py-1 rounded">Registros: {financeRoleStats.total}</span>
            <span className="bg-slate-100 px-3 py-1 rounded">Operação: {operation?.nome || '---'}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {cards.map((card) => (
            <div
              key={card.label}
              className="p-4 bg-white rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl">
                <i className={`fas ${card.icon}`}></i>
              </div>
              <div>
                <p className="text-xs uppercase font-bold text-slate-400">{card.label}</p>
                <p className="text-2xl font-black text-slate-900">{card.value}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-sm">
            <p className="text-xs uppercase font-bold text-white/70">Custo diário estimado</p>
            <p className="text-2xl font-black mt-1">{formatCurrency(financeSummary.totalDaily)}</p>
            <p className="text-[11px] text-white/50 mt-1">Soma das diárias configuradas</p>
          </div>
          <div className="p-4 bg-white rounded-2xl border border-slate-200">
            <p className="text-xs uppercase font-bold text-slate-500">Sem PIX cadastrado</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{financeSummary.missingPix}</p>
            <p className="text-[11px] text-slate-500 mt-1">Precisa para agilizar repasses</p>
          </div>
          <div className="p-4 bg-white rounded-2xl border border-slate-200">
            <p className="text-xs uppercase font-bold text-slate-500">Sem CPF / diária</p>
            <div className="flex items-baseline gap-6 mt-1">
              <div>
                <p className="text-2xl font-black text-slate-900">{financeSummary.missingCpf}</p>
                <p className="text-[11px] text-slate-500">CPF ausente</p>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900">{financeSummary.missingDailyRate}</p>
                <p className="text-[11px] text-slate-500">Sem diária</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex-1 w-full">
              <label className="text-xs uppercase font-bold text-slate-500">Buscar membros</label>
              <input
                type="text"
                value={financeSearch}
                onChange={(e) => setFinanceSearch(e.target.value)}
                className="mt-2 w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="Nome, telefone ou CPF"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {filterOptions.map((option) => {
                const isActive = financeRoleFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFinanceRoleFilter(option.value)}
                    className={`px-3 py-2 text-xs font-semibold rounded-xl border ${
                      isActive ? 'text-white' : 'bg-white text-slate-500 border-slate-200'
                    }`}
                    style={isActive ? { backgroundColor: brandPrimary, borderColor: brandPrimary } : undefined}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {membersError && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">{membersError}</div>
          )}

          {dailyRateError && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">{dailyRateError}</div>
          )}

          {membersLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <div key={`finance-loading-${item}`} className="h-16 bg-slate-100 rounded-2xl animate-pulse"></div>
              ))}
            </div>
          ) : filteredFinanceMembers.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum membro encontrado para o filtro selecionado. Ajuste sua busca ou verifique os cadastros.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400">
                    <th className="pb-3">Membro</th>
                    <th className="pb-3">Telefone</th>
                    <th className="pb-3">CPF</th>
                    <th className="pb-3">Diária (R$)</th>
                    <th className="pb-3">Chave PIX</th>
                    <th className="pb-3">Folha de Ponto</th>
                    <th className="pb-3">Responsável</th>
                    <th className="pb-3">Entrada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredFinanceMembers.map((member) => {
                    const sanitizedPhone = sanitizePhoneNumber(member.phone);
                    return (
                      <tr key={`finance-${member.id}`} className="hover:bg-slate-50">
                      <td className="py-3">
                        <p className="font-semibold text-slate-800">{member.name}</p>
                        <p className="text-[11px] text-slate-500">{formatRoleLabel(member.role)}</p>
                      </td>
                      <td className="py-3 text-slate-600">
                        {sanitizedPhone ? (
                          <a
                            href={`https://wa.me/${sanitizedPhone}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-600 font-semibold hover:underline inline-flex items-center gap-1"
                          >
                            <i className="fab fa-whatsapp"></i>
                            {formatPhoneDisplay(member.phone)}
                          </a>
                        ) : (
                          formatPhoneDisplay(member.phone)
                        )}
                      </td>
                      <td className="py-3 text-slate-600 font-mono">{formatCpfDisplay(member.cpf)}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">R$</span>
                          <input
                            type="text"
                            value={getDailyRateInputValue(member)}
                            onChange={(e) => handleDailyRateInput(member.id, e.target.value)}
                            className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500"
                            placeholder="0,00"
                          />
                          <button
                            type="button"
                            onClick={() => handleDailyRateSave(member)}
                            disabled={dailyRateSavingId === member.id}
                            className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {dailyRateSavingId === member.id ? (
                              <i className="fas fa-spinner fa-spin text-indigo-500 text-xs"></i>
                            ) : (
                              <i className="fas fa-save text-xs"></i>
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-3 text-slate-600 break-all">
                        {member.pix ? (
                          <button
                            type="button"
                            onClick={() => handleCopyPix(member.id, member.pix)}
                            className="text-left w-full text-slate-600 hover:text-indigo-600 font-semibold flex items-center gap-2"
                          >
                            <span>{member.pix}</span>
                            <i className={`fas ${pixCopiedId === member.id ? 'fa-check text-emerald-500' : 'fa-copy text-slate-400 text-xs'}`}></i>
                          </button>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => handleOpenTimesheet(member)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50"
                        >
                          <i className="fas fa-clipboard-list mr-1.5"></i> Folha
                        </button>
                      </td>
                      <td className="py-3 text-slate-600">{resolveMemberResponsible(member)}</td>
                      <td className="py-3 text-slate-500 text-xs">
                        {member.createdAt
                          ? new Date(member.createdAt).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : '--'}
                      </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderVotersView = () => {
    const isDirector = user.role === UserRole.DIRECTOR;
    const canSubmit = Boolean(operation?.id);

    const formFields = (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Nome do eleitor *</label>
            <input
              type="text"
              value={voterForm.name}
              onChange={(e) => handleVoterFormChange('name', e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="Maria Souza"
              disabled={!canSubmit || voterSaving}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Telefone *</label>
            <input
              type="text"
              value={voterForm.phone}
              onChange={(e) => handleVoterFormChange('phone', e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="(11) 99999-0000"
              disabled={!canSubmit || voterSaving}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Cidade</label>
            <input
              type="text"
              value={voterForm.city}
              onChange={(e) => handleVoterFormChange('city', e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="Campinas"
              disabled={!canSubmit || voterSaving}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Bairro</label>
            <input
              type="text"
              value={voterForm.neighborhood}
              onChange={(e) => handleVoterFormChange('neighborhood', e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="Jardim São Pedro"
              disabled={!canSubmit || voterSaving}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Zona Eleitoral</label>
            <input
              type="text"
              value={voterForm.electoralZone}
              onChange={(e) => handleVoterFormChange('electoralZone', e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="Zona 245"
              disabled={!canSubmit || voterSaving}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Sentimento</label>
            <select
              value={voterForm.sentiment}
              onChange={(e) => handleVoterFormChange('sentiment', e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
              disabled={!canSubmit || voterSaving}
            >
              <option value="">Selecione o sentimento</option>
              {VOTER_SENTIMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Conhece o candidato?</label>
            <select
              value={voterForm.knowsCandidate}
              onChange={(e) => handleVoterFormChange('knowsCandidate', e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
              disabled={!canSubmit || voterSaving}
            >
              {VOTER_BOOL_OPTIONS.map((option) => (
                <option key={`knows-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase">Voto definido?</label>
            <select
              value={voterForm.decidedVote}
              onChange={(e) => handleVoterFormChange('decidedVote', e.target.value)}
              className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
              disabled={!canSubmit || voterSaving}
            >
              {VOTER_BOOL_OPTIONS.map((option) => (
                <option key={`vote-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Desejos / Observações</label>
          <textarea
            value={voterForm.wishes}
            onChange={(e) => handleVoterFormChange('wishes', e.target.value)}
            rows={3}
            className="mt-2 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500"
            placeholder="Quais pautas importam para este eleitor?"
            disabled={!canSubmit || voterSaving}
          />
        </div>
      </>
    );

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Eleitores</h2>
            <p className="text-slate-500 font-medium">
              {isDirector
                ? 'Cadastre e acompanhe todos os eleitores captados na operação.'
                : 'Registre os eleitores abordados na rua para o comando acompanhar.'}
            </p>
          </div>
          {isDirector && (
            <div className="flex flex-col items-end gap-2">
              <div className="text-xs font-bold text-slate-500 uppercase">
                Operação: {operation?.nome || 'Não configurada'}
              </div>
              <button
                type="button"
                onClick={() => setVoterFormExpanded((prev) => !prev)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                {voterFormExpanded ? 'Recolher registro rápido' : 'Novo eleitor'}
              </button>
            </div>
          )}
        </div>

        {(!isDirector || voterFormExpanded) && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase">Registro rápido</p>
                <p className="text-sm text-slate-500">Preencha os dados do eleitor logo após a conversa.</p>
              </div>
              {voterSuccess && <span className="text-sm text-emerald-600 font-semibold">{voterSuccess}</span>}
            </div>
            {!canSubmit && (
              <div className="p-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl">
                Configure ou selecione uma operação para liberar o cadastro de eleitores.
              </div>
            )}
            {voterFormError && (
              <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">{voterFormError}</div>
            )}
            <form className="space-y-4" onSubmit={handleVoterFormSubmit}>
              {formFields}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!canSubmit || voterSaving}
                  className="brand-btn px-5 py-3 rounded-2xl font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {voterSaving ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-user-plus"></i>}
                  Registrar eleitor
                </button>
                <button
                  type="button"
                  onClick={() => setVoterForm(createVoterFormDefaults())}
                  disabled={voterSaving}
                  className="px-4 py-3 rounded-2xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Limpar campos
                </button>
              </div>
            </form>
          </div>
        )}

        {isDirector && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase">Base de eleitores</p>
                <p className="text-sm text-slate-500">Extrato completo dos registros desta operação.</p>
              </div>
              <span className="text-[11px] font-bold text-slate-500 uppercase">
                Total: {filteredVoters.length} / {voters.length}
              </span>
            </div>
            {votersError && (
              <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">{votersError}</div>
            )}
            {voters.length > 0 && (
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-[11px] font-bold text-slate-500 uppercase">Busca rápida</label>
                  <input
                    type="text"
                    value={voterSearch}
                    onChange={(e) => setVoterSearch(e.target.value)}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    placeholder="Nome, telefone, cidade..."
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase">Sentimento</label>
                  <select
                    value={voterSentimentFilter}
                    onChange={(e) => setVoterSentimentFilter(e.target.value)}
                    className="mt-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Todos</option>
                    {VOTER_SENTIMENT_OPTIONS.map((option) => (
                      <option key={`sent-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase">Conhece candidato</label>
                  <select
                    value={voterKnowledgeFilter}
                    onChange={(e) => setVoterKnowledgeFilter(e.target.value)}
                    className="mt-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    {VOTER_BOOL_OPTIONS.map((option) => (
                      <option key={`filter-known-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase">Voto definido</label>
                  <select
                    value={voterDecisionFilter}
                    onChange={(e) => setVoterDecisionFilter(e.target.value)}
                    className="mt-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    {VOTER_BOOL_OPTIONS.map((option) => (
                      <option key={`filter-vote-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase">Ordenação</label>
                  <select
                    value={voterSort}
                    onChange={(e) => setVoterSort(e.target.value as typeof voterSort)}
                    className="mt-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="newest">Mais recentes</option>
                    <option value="oldest">Mais antigos</option>
                    <option value="name">Nome A-Z</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleExportVoters}
                    disabled={!filteredVoters.length}
                    className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <i className="fas fa-file-export mr-2"></i> Exportar CSV
                  </button>
                </div>
              </div>
            )}
            {votersLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <div key={`voter-loading-${item}`} className="h-16 bg-slate-100 rounded-2xl animate-pulse"></div>
                ))}
              </div>
            ) : voters.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum eleitor cadastrado ainda.</p>
            ) : filteredVoters.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum eleitor encontrado para os filtros atuais.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-slate-400">
                      <th className="pb-3">Nome</th>
                      <th className="pb-3">Contato</th>
                      <th className="pb-3">Cidade / Bairro</th>
                      <th className="pb-3">Sentimento</th>
                      <th className="pb-3">Conhece</th>
                      <th className="pb-3">Voto</th>
                      <th className="pb-3">Desejos</th>
                      <th className="pb-3">Zona</th>
                      <th className="pb-3">Registrado por</th>
                      <th className="pb-3">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredVoters.map((record) => {
                      const sentimentLabel =
                        VOTER_SENTIMENT_OPTIONS.find((option) => option.value === record.sentiment)?.label || '—';
                      return (
                        <tr key={record.id} className="hover:bg-slate-50">
                          <td className="py-3">
                            <p className="font-semibold text-slate-800">{record.name}</p>
                            {record.wishes && (
                              <p className="text-[11px] text-slate-500 line-clamp-1">{record.wishes}</p>
                            )}
                          </td>
                          <td className="py-3 text-slate-600">{formatPhoneDisplay(record.phone)}</td>
                          <td className="py-3 text-slate-600">
                            <div className="text-sm font-semibold">{record.city || '—'}</div>
                            <div className="text-xs text-slate-500">{record.neighborhood || '—'}</div>
                          </td>
                          <td className="py-3 text-slate-600">{sentimentLabel}</td>
                          <td className="py-3 text-slate-600">{formatBooleanDisplay(record.knowsCandidate)}</td>
                          <td className="py-3 text-slate-600">{formatBooleanDisplay(record.decidedVote)}</td>
                          <td className="py-3 text-slate-600 max-w-xs">
                            <p className="line-clamp-2">{record.wishes || '—'}</p>
                          </td>
                          <td className="py-3 text-slate-600">{record.electoralZone || '—'}</td>
                          <td className="py-3 text-slate-600 text-sm">{record.recordedByName || 'Equipe'}</td>
                          <td className="py-3 text-slate-500 text-xs">
                            {new Date(record.createdAt).toLocaleString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSettingsView = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Configurações</h2>
          <p className="text-slate-500 font-medium">Gerencie dados da operação e convites permanentes.</p>
        </div>
      </div>
      {renderOperationConfigCard()}
    </div>
  );

  const renderTeamView = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Expansão de Equipe</h2>
          <p className="text-slate-500 font-medium">Gerencie convites para líderes e soldados.</p>
        </div>
      </div>
      {user.role === UserRole.DIRECTOR && (
        <div className="space-y-6">
          {!operation && (
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800">
              Configure uma operação antes de emitir convites.
            </div>
          )}
          {renderDirectorLeaderInvitesCard()}
          {renderDirectorSoldierInvitesCard()}
          {inviteConsumptionFeed.length > 0 && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <i className="fas fa-bell text-emerald-500"></i> Convites utilizados recentemente
                </h3>
                <span className="text-[11px] font-black text-slate-400 uppercase">
                  Últimos {inviteConsumptionFeed.length}
                </span>
              </div>
              <div className="space-y-3">
                {inviteConsumptionFeed.map((invite) => {
                  const consumerName = invite.consumido_por ? membersMap[invite.consumido_por]?.name : null;
                  return (
                    <div
                      key={`usage-${invite.id}`}
                      className="p-3 rounded-xl border border-slate-100 bg-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-2"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {consumerName || 'Novo membro'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {invite.tipo === 'LEADER' ? 'Convite de líder' : 'Convite de soldado'} · Token {invite.token.slice(0, 6)}...
                        </p>
                      </div>
                      <span className="text-[11px] font-bold text-slate-500 uppercase">
                        {formatDateTimeLabel(invite.consumido_em)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {isLeaderRole && renderLeaderManagement()}
    </div>
  );

  const renderTimesheetModal = () => {
    if (!timesheetModal.open || !timesheetModal.member) return null;
    const days = [...(timesheetModal.data.days || [])].sort((a, b) => b.date.localeCompare(a.date));
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl border border-slate-200 relative">
          <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase font-bold text-slate-500">Folha de ponto</p>
              <h3 className="text-2xl font-black text-slate-900">{timesheetModal.member.name}</h3>
              <p className="text-sm text-slate-500">{formatRoleLabel(timesheetModal.member.role)}</p>
            </div>
            <button
              type="button"
              onClick={handleCloseTimesheet}
              className="w-10 h-10 rounded-2xl border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
          <div className="p-6 space-y-4">
            {days.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nenhuma atividade registrada ainda para este membro. Assim que ele se conectar, os horários aparecerão aqui.
              </p>
            ) : (
              days.map((day) => (
                <div key={`timesheet-day-${day.date}`} className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase font-bold text-slate-500">Dia</p>
                      <p className="text-lg font-black text-slate-900">{formatDateLabel(day.date)}</p>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-500">
                      {day.sessions.length} turno(s) registrado(s)
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {day.sessions.length === 0 ? (
                      <p className="text-sm text-slate-500">Sem sessões para este dia.</p>
                    ) : (
                      day.sessions.map((session, index) => (
                        <div
                          key={`session-${day.date}-${index}`}
                          className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3"
                        >
                          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                            <div>
                              <p className="text-[11px] font-bold text-slate-400 uppercase">Entrada</p>
                              <p className="text-sm font-semibold text-slate-800">{formatTimeLabel(session.loginAt)}</p>
                              <p className="text-xs text-slate-500">
                                <i className="fas fa-location-dot mr-1"></i> {formatLocationLabel(session.loginLocation)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] font-bold text-slate-400 uppercase">Saída</p>
                              <p className="text-sm font-semibold text-slate-800">
                                {session.logoutAt ? formatTimeLabel(session.logoutAt) : 'Em aberto'}
                              </p>
                              <p className="text-xs text-slate-500">
                                <i className="fas fa-location-dot mr-1"></i>{' '}
                                {session.logoutAt ? formatLocationLabel(session.logoutLocation) : 'Aguardando finalização'}
                              </p>
                            </div>
                          </div>
                          <div className="text-xs text-slate-500 italic flex items-center gap-2">
                            <i className="fas fa-folder-open"></i>
                            Registro de arquivos será exibido aqui quando a funcionalidade estiver disponível.
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (view) {
      case 'STRUCTURE':
        return renderStructureView();
      case 'CRONOGRAMA':
        return renderCronogramaView();
      case 'SETTINGS':
        return renderSettingsView();
      case 'FINANCE':
        return renderFinanceView();
      case 'TEAM':
        return renderTeamView();
      case 'VOTERS':
        return renderVotersView();
      default:
        return renderCommandView();
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {renderContent()}
      {renderTimesheetModal()}
    </div>
  );
};

export default Dashboard;
