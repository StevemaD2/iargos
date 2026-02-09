
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User, Submission, SubmissionType, UserRole, VoterSentiment } from '../types';
import { fetchOperationSubmissions } from '../services/submissionsService';
import { supabase } from '../services/supabaseClient';

interface LeaderFeedProps {
  user: User;
}

const LeaderFeed: React.FC<LeaderFeedProps> = ({ user }) => {
  const [feed, setFeed] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [filterContext, setFilterContext] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [nextRefreshIn, setNextRefreshIn] = useState(300);
  const isLeader = [UserRole.L1, UserRole.L2, UserRole.L3].includes(user.role);

  const resolveLeaderTeamIds = useCallback(async (): Promise<Set<string>> => {
    const team = new Set<string>();
    if (!supabase || !user.operationId) return team;
    const { data, error: membersError } = await supabase
      .from('membros')
      .select('id, responsavel_id')
      .eq('operacao_id', user.operationId);
    if (membersError) {
      console.error('Erro ao carregar cadeia de liderança', membersError);
      return team;
    }
    const byLeader = new Map<string, string[]>();
    (data || []).forEach((row: any) => {
      if (!row.responsavel_id) return;
      const list = byLeader.get(row.responsavel_id) || [];
      list.push(row.id);
      byLeader.set(row.responsavel_id, list);
    });
    const stack = [user.id];
    while (stack.length) {
      const leaderId = stack.pop() as string;
      const children = byLeader.get(leaderId) || [];
      children.forEach((id) => {
        if (!team.has(id)) {
          team.add(id);
          stack.push(id);
        }
      });
    }
    return team;
  }, [user.id, user.operationId]);

  const refreshFeed = useCallback(async () => {
    if (!user.operationId) {
      setFeed([]);
      return;
    }
    if (user.role === UserRole.SOLDIER) {
      setFeed([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOperationSubmissions(user.operationId);
      let scoped = data;
      if (isLeader) {
        const teamIds = await resolveLeaderTeamIds();
        scoped = data.filter((item) => teamIds.has(item.userId));
      }
      setFeed(scoped);
      setNextRefreshIn(300);
    } catch (err) {
      console.error('Erro ao carregar monitoramento', err);
      setError('Não foi possível carregar o monitoramento agora.');
    } finally {
      setLoading(false);
    }
  }, [user.operationId, user.role, isLeader, resolveLeaderTeamIds]);

  useEffect(() => {
    refreshFeed();
  }, [refreshFeed]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setNextRefreshIn((current) => {
        if (current <= 1) {
          refreshFeed();
          return 300;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [refreshFeed]);

  const filteredFeed = useMemo(() => {
    const term = filterSearch.trim().toLowerCase();
    return feed
      .filter((item) => {
        if (filterType && item.type !== filterType) return false;
        if (filterContext && item.context !== filterContext) return false;
        if (term) {
          const haystack = `${item.content} ${item.userName} ${item.locationDetails?.bairro || ''} ${
            item.locationDetails?.cidade || ''
          }`.toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [feed, filterType, filterContext, filterSearch]);

  const visibleFeed = useMemo(() => filteredFeed.slice(0, pageSize), [filteredFeed, pageSize]);
  const formatCountdown = (value: number) => {
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (user.role === UserRole.SOLDIER) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Fluxo de Monitoramento</h2>
        <p className="text-sm text-slate-500">Seu perfil não possui acesso ao monitoramento.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <i className="fas fa-tower-broadcast text-indigo-600"></i>
            Fluxo de Monitoramento
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              Atualiza em <span className="font-bold">{formatCountdown(nextRefreshIn)}</span>
            </span>
            <button
              onClick={refreshFeed}
              className="text-xs px-3 py-2 font-bold bg-indigo-600 text-white rounded-lg shadow-sm hover:bg-indigo-700 transition-all"
            >
              Atualizar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Buscar por texto, bairro ou operador"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
          >
            <option value="">Todos os tipos</option>
            {Object.values(SubmissionType).map((type) => (
              <option key={type} value={type}>{type.replace('_', ' ')}</option>
            ))}
          </select>
          <select
            value={filterContext}
            onChange={(e) => setFilterContext(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
          >
            <option value="">Todos os contextos</option>
            <option value="RUA">Rua</option>
            <option value="DIGITAL">Digital</option>
            <option value="MISTO">Misto</option>
          </select>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
          >
            <option value={10}>10 cards</option>
            <option value={20}>20 cards</option>
            <option value={50}>50 cards</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Carregando monitoramento...</div>
      ) : visibleFeed.length === 0 ? (
        <div className="text-sm text-slate-500">Nenhum registro encontrado.</div>
      ) : (
        <div className="space-y-4">
        {visibleFeed.map(sub => (
          <div key={sub.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
            <div className="p-4 bg-slate-50 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center font-bold">
                  {sub.userName.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">{sub.userName}</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-tighter">
                    {sub.locationDetails.bairro || 'Sem bairro'} • {new Date(sub.timestamp).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
              <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                sub.type === SubmissionType.OCORRENCIA ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-600'
              }`}>
                {sub.type.replace('_', ' ')}
              </span>
            </div>
            
            <div className="p-5">
              <p className="text-slate-700 text-sm mb-4 leading-relaxed">{sub.content}</p>
              
              {sub.voterInteraction && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Intenção</p>
                    <p className="text-xs font-semibold">{sub.voterInteraction.intencao_voto.replace('_', ' ')}</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Sentimento</p>
                    <p className={`text-xs font-bold ${
                      sub.voterInteraction.sentimento === VoterSentiment.POSITIVO ? 'text-green-600' : 
                      sub.voterInteraction.sentimento === VoterSentiment.NEGATIVO ? 'text-red-600' : 'text-slate-600'
                    }`}>
                      {sub.voterInteraction.sentimento}
                    </p>
                  </div>
                </div>
              )}

              {sub.voterInteraction?.urgencia_followup === 'ALTA' && (
                <div className="mt-4 flex items-center gap-2 text-red-600 text-xs font-bold bg-red-50 p-2 rounded border border-red-100">
                  <i className="fas fa-exclamation-triangle"></i>
                  REQUER ATENÇÃO IMEDIATA DO LÍDER
                </div>
              )}
            </div>
            
            <div className="p-3 bg-slate-50 border-t flex justify-end gap-2">
              <button className="text-xs px-3 py-1.5 font-bold text-slate-600 hover:bg-white rounded border border-transparent hover:border-slate-200 transition-all">
                Ignorar
              </button>
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
};

export default LeaderFeed;
