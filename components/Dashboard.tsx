
import React, { useState, useEffect, useCallback } from 'react';
import { User, UserRole, Submission, VoterSentiment, CampaignConfig, HierarchyNote } from '../types';
import { analyzeSubmissions } from '../services/geminiService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { supabase } from '../services/supabaseClient';
import ZonePlanner from './ZonePlanner';

interface DashboardProps {
  user: User;
}

const STATE_METADATA: Record<string, { name: string, coords: [number, number], zoom: number }> = {
  "AC": { name: "Acre", coords: [-9.02, -70.81], zoom: 6 },
  "AL": { name: "Alagoas", coords: [-9.57, -36.78], zoom: 8 },
  "AP": { name: "Amapá", coords: [1.41, -51.77], zoom: 6 },
  "AM": { name: "Amazonas", coords: [-3.41, -65.05], zoom: 5 },
  "BA": { name: "Bahia", coords: [-12.97, -38.5], zoom: 6 },
  "CE": { name: "Ceará", coords: [-3.71, -38.54], zoom: 7 },
  "DF": { name: "Distrito Federal", coords: [-15.78, -47.93], zoom: 10 },
  "ES": { name: "Espírito Santo", coords: [-19.18, -40.3], zoom: 8 },
  "GO": { name: "Goiás", coords: [-15.82, -49.83], zoom: 7 },
  "MA": { name: "Maranhão", coords: [-2.53, -44.3], zoom: 6 },
  "MT": { name: "Mato Grosso", coords: [-12.64, -55.42], zoom: 6 },
  "MS": { name: "Mato Grosso do Sul", coords: [-20.44, -54.64], zoom: 7 },
  "MG": { name: "Minas Gerais", coords: [-18.51, -44.55], zoom: 6 },
  "PA": { name: "Pará", coords: [-1.45, -48.5], zoom: 5 },
  "PB": { name: "Paraíba", coords: [-7.11, -34.86], zoom: 8 },
  "PR": { name: "Paraná", coords: [-24.81, -52.13], zoom: 7 },
  "PE": { name: "Pernambuco", coords: [-8.28, -35.07], zoom: 7 },
  "PI": { name: "Piauí", coords: [-5.09, -42.8], zoom: 6 },
  "RJ": { name: "Rio de Janeiro", coords: [-22.9, -43.17], zoom: 8 },
  "RN": { name: "Rio Grande do Norte", coords: [-5.79, -35.2], zoom: 8 },
  "RS": { name: "Rio Grande do Sul", coords: [-30.03, -51.23], zoom: 7 },
  "RO": { name: "Rondônia", coords: [-11.5, -63.58], zoom: 7 },
  "RR": { name: "Roraima", coords: [2.82, -60.67], zoom: 6 },
  "SC": { name: "Santa Catarina", coords: [-27.24, -50.21], zoom: 7 },
  "SP": { name: "São Paulo", coords: [-23.55, -46.63], zoom: 7 },
  "SE": { name: "Sergipe", coords: [-10.91, -37.07], zoom: 9 },
  "TO": { name: "Tocantins", coords: [-10.17, -48.33], zoom: 6 }
};

const PERMANENT_INVITE_EXPIRATION = '2099-12-31T23:59:59.999Z';

interface InviteSnapshot {
  id: string;
  token: string;
  tipo: 'LEADER' | 'SOLDIER';
  emitido_por?: string | null;
  expires_at: string | null;
  created_at: string;
}

const formatInviteExpiration = (value: string | null) => {
  if (!value) return 'Sem expiração';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Data inválida';
  if (parsed.getFullYear() >= 2099) return 'Sem expiração';
  return parsed.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const Dashboard: React.FC<DashboardProps> = ({ user }) => {
  const isLeaderRole = [UserRole.L1, UserRole.L2, UserRole.L3].includes(user.role);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [aiInsight, setAiInsight] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [campaignConfig, setCampaignConfig] = useState<CampaignConfig>(() => {
    const saved = localStorage.getItem('iargos_config');
    return saved ? JSON.parse(saved) : {
      state: "SP",
      electionDate: "2024-10-04",
      schedule: [
        { date: "2024-08-16", title: "Início Propaganda Eleitoral" },
        { date: "2024-09-30", title: "Fim do Horário Gratuito" },
        { date: "2024-10-04", title: "DIA DA ELEIÇÃO" }
      ]
    };
  });

  const [hierarchyNotes, setHierarchyNotes] = useState<HierarchyNote[]>([
    { role: UserRole.L1, text: "Focar na zona leste esta semana.", updatedAt: new Date().toISOString() },
    { role: UserRole.SOLDIER, text: "Lembrem-se: geolocalização ligada sempre!", updatedAt: new Date().toISOString() }
  ]);
  const [operation, setOperation] = useState<{ id: string; nome?: string; estado?: string; diretor_id?: string } | null>(
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
  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationNameInput, setOperationNameInput] = useState(user.operationName || '');
  const [operationStateInput, setOperationStateInput] = useState(user.operationState || campaignConfig.state);
  const [operationSaving, setOperationSaving] = useState(false);
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

  const refreshInviteLists = useCallback(async () => {
    if (!supabase || !operation?.id) {
      setLeaderInviteHistory([]);
      setSoldierInviteHistory([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('convites')
        .select('id, token, tipo, expires_at, created_at, emitido_por')
        .eq('operacao_id', operation.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const now = Date.now();
      const filterActive = (entry: InviteSnapshot) =>
        !entry.expires_at || new Date(entry.expires_at).getTime() > now;
      const payload = (data || []) as InviteSnapshot[];
      setLeaderInviteHistory(payload.filter((invite) => invite.tipo === 'LEADER' && filterActive(invite)));
      setSoldierInviteHistory(
        payload.filter(
          (invite) => invite.tipo === 'SOLDIER' && invite.emitido_por === user.id && filterActive(invite)
        )
      );
    } catch (error) {
      console.error('Erro ao carregar convites ativos', error);
    }
  }, [supabase, operation?.id, user.id]);

  useEffect(() => {
    refreshInviteLists();
  }, [refreshInviteLists]);

  useEffect(() => {
    localStorage.setItem('iargos_config', JSON.stringify(campaignConfig));
  }, [campaignConfig]);

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
            .select('id, nome, estado, diretor_id')
            .eq('diretor_id', user.id)
            .limit(1)
            .maybeSingle();
        } else if (user.operationId) {
          response = await supabase
            .from('operacoes')
            .select('id, nome, estado, diretor_id')
            .eq('id', user.operationId)
            .maybeSingle();
        } else {
          setOperation(null);
          return;
        }

        if (response.error) {
          if (response.error.code === 'PGRST116') {
            setOperation(null);
            return;
          }
          throw response.error;
        }

        if (response.data) {
          setOperation(response.data);
          setOperationNameInput(response.data.nome || '');
          setOperationStateInput(response.data.estado || campaignConfig.state);
        } else {
          setOperation(null);
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

  const slugifyName = (value: string) => {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50) || `op-${Date.now().toString(36)}`;
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

    setOperationSaving(true);
    setOperationError(null);
    try {
    const basePayload = {
      nome: trimmedName,
      estado: operationStateInput,
      diretor_id: user.id
    };

    const persist = async (slugValue: string) => {
      const payload = { ...basePayload, slug: slugValue };
      if (operation) {
        return supabase
          .from('operacoes')
          .update(payload)
          .eq('id', operation.id)
          .select('id, nome, estado, diretor_id')
          .single();
      }
      return supabase
        .from('operacoes')
        .insert(payload)
        .select('id, nome, estado, diretor_id')
        .single();
    };

    let response = await persist(slugifyName(trimmedName));
    if (response.error && response.error.code === '23505') {
      const fallbackSlug = `${slugifyName(trimmedName)}-${Math.random().toString(36).substring(2, 6)}`;
      response = await persist(fallbackSlug);
    }

    if (response.error) throw response.error;
    if (response.data) {
      setOperation(response.data);
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

  useEffect(() => {
    const mockData: Submission[] = [
      {
        id: '1',
        userId: 'u1',
        userName: 'Operador Alfa',
        leaderChain: ['l3', 'l2', 'l1', 'dir'],
        type: 'TEXTO_RELATO' as any,
        timestamp: new Date().toISOString(),
        geo: { lat: -23.5505, lng: -46.6333, accuracy: 10 },
        locationDetails: { bairro: 'Centro', cidade: 'São Paulo', uf: campaignConfig.state },
        context: 'RUA',
        content: 'Eleitorado local demonstra forte preocupação com infraestrutura básica.',
        voterInteraction: {
          foi_atendido: 'BEM',
          intencao_voto: 'EM_DUVIDA' as any,
          temas_mencionados: ['Segurança', 'Saúde', 'Infraestrutura'],
          sentimento: VoterSentiment.NEUTRO,
          principais_frases: 'As ruas estão abandonadas.',
          objecoes: ['Atraso em obras'],
          oportunidades: ['Promessa de pavimentação'],
          urgencia_followup: 'MEDIA',
          observacoes: ''
        }
      }
    ];
    setSubmissions(mockData);

    const fetchAI = async () => {
      const insight = await analyzeSubmissions(mockData, user.role);
      setAiInsight(insight);
      setLoading(false);
    };
    fetchAI();
  }, [user.role, campaignConfig.state]);

  const statsData = [
    { name: 'Positivo', value: 12 },
    { name: 'Neutro', value: 45 },
    { name: 'Negativo', value: 18 },
  ];

  const COLORS = ['#10b981', '#6366f1', '#ef4444'];

  const renderDirectorManagement = () => (
    <div className="space-y-6 mt-8">
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
            <button
              type="submit"
              disabled={operationSaving}
              className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {operationSaving ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-save"></i>}
              {operation ? 'Atualizar Operação' : 'Registrar Operação'}
            </button>
            {operationError && <p className="text-sm text-red-500">{operationError}</p>}
          </form>
        )}
      </div>

      {operation && (
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
              className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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

            <div className="pt-4 border-t border-slate-100 space-y-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Links ativos</p>
              {leaderInviteHistory.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhum convite ativo no momento.</p>
              ) : (
                leaderInviteHistory.slice(0, 6).map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50"
                  >
                    <div>
                      <p className="text-xs font-mono break-all">{invite.token}</p>
                      <p className="text-[11px] text-slate-500">
                        Validade: {formatInviteExpiration(invite.expires_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyActiveInvite(invite.token)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-white transition-colors"
                    >
                      {copiedInviteToken === invite.token ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <i className="fas fa-sitemap text-indigo-500"></i> Estrutura e Notas de Comando
            </h3>
            <div className="flex gap-2">
               <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">Ativos: 1.402</span>
            </div>
          </div>
          <div className="space-y-4">
            {[UserRole.L1, UserRole.L2, UserRole.L3, UserRole.SOLDIER].map(role => (
              <div key={role} className="p-4 bg-slate-50 rounded-xl border border-slate-100 group transition-all hover:border-indigo-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{role.replace('_', ' ')}</span>
                    <span className="text-xs font-bold text-slate-600">Densidade: 1 líder / 10 subordinados</span>
                  </div>
                  <div className="flex gap-1">
                    <button className="p-2 bg-white border rounded-lg hover:bg-indigo-50 text-indigo-600 text-xs shadow-sm transition-colors" title="Gerar Link">
                      <i className="fas fa-link"></i>
                    </button>
                    <button className="p-2 bg-white border rounded-lg hover:bg-indigo-50 text-indigo-600 text-xs shadow-sm transition-colors" title="Ver QR">
                      <i className="fas fa-qrcode"></i>
                    </button>
                  </div>
                </div>
                <textarea 
                  className="w-full bg-white border border-slate-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-300"
                  placeholder={`Instruções diretas para o nível ${role.toLowerCase()}...`}
                  value={hierarchyNotes.find(n => n.role === role)?.text || ""}
                  onChange={(e) => {
                    const newNotes = [...hierarchyNotes];
                    const idx = newNotes.findIndex(n => n.role === role);
                    if (idx > -1) newNotes[idx].text = e.target.value;
                    else newNotes.push({ role, text: e.target.value, updatedAt: new Date().toISOString() });
                    setHierarchyNotes(newNotes);
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <i className="fas fa-calendar-alt text-indigo-500"></i> Cronograma de Campanha
          </h3>
          
          <div className="mb-6">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Estado em Operação</label>
            <div className="grid grid-cols-6 md:grid-cols-9 gap-2">
              {Object.keys(STATE_METADATA).map(uf => (
                <button 
                  key={uf}
                  onClick={() => setCampaignConfig({...campaignConfig, state: uf})}
                  className={`p-2 rounded-lg text-[10px] font-black border transition-all ${
                    campaignConfig.state === uf 
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-600/30' 
                      : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-300'
                  }`}
                >
                  {uf}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Marcos de Operação</label>
            {campaignConfig.schedule.map((item, idx) => {
              const isElection = item.title.includes("ELEIÇÃO");
              return (
                <div key={idx} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${isElection ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-slate-50 border-slate-100'}`}>
                  <div className={`w-12 text-center flex flex-col items-center justify-center p-1 rounded-lg ${isElection ? 'bg-indigo-600 text-white' : 'bg-white border text-slate-600'}`}>
                    <span className="text-[10px] uppercase font-bold opacity-80">{item.date.split('-')[1] === '10' ? 'OUT' : 'AGO'}</span>
                    <span className="text-lg font-black leading-none">{item.date.split('-')[2]}</span>
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-bold ${isElection ? 'text-indigo-900' : 'text-slate-800'}`}>{item.title}</p>
                    <p className="text-[10px] text-slate-500">Status: Planejado</p>
                  </div>
                  <i className={`fas ${isElection ? 'fa-star text-indigo-500' : 'fa-check-circle text-slate-300'}`}></i>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

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
            className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
            {soldierInviteHistory.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhum convite disponível. Gere e compartilhe com seus soldados.</p>
            ) : (
              soldierInviteHistory.slice(0, 6).map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50"
                >
                  <div>
                    <p className="text-xs font-mono break-all">{invite.token}</p>
                    <p className="text-[11px] text-slate-500">
                      Validade: {formatInviteExpiration(invite.expires_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyActiveInvite(invite.token)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-white transition-colors"
                  >
                    {copiedInviteToken === invite.token ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );

  const selectedState = STATE_METADATA[campaignConfig.state];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
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
              <h4 className="font-bold mb-6 text-slate-800 flex items-center gap-2">
                <i className="fas fa-heart text-indigo-500"></i> Sentimento Regional
              </h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statsData} cx="50%" cy="50%" innerRadius={70} outerRadius={95} paddingAngle={10} dataKey="value">
                      {statsData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
              <h4 className="font-bold mb-6 text-slate-800 flex items-center gap-2">
                <i className="fas fa-chart-simple text-indigo-500"></i> Eficiência por Bairro
              </h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '15px', border: 'none' }} />
                    <Bar dataKey="value" fill="#6366f1" radius={[10, 10, 0, 0]} barSize={45} />
                  </BarChart>
                </ResponsiveContainer>
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
             
             {loading ? (
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
             ) : null}
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

      {user.role === UserRole.DIRECTOR && renderDirectorManagement()}
      {isLeaderRole && renderLeaderManagement()}
    </div>
  );
};

export default Dashboard;
