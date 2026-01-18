
import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { supabase } from '../services/supabaseClient';
import { requestCurrentLocation } from '../services/locationService';
import { recordMemberTimesheetEvent } from '../services/memberActivityService';

interface LoginProps {
  onLogin: (user: User) => void;
  initialMode?: 'choice' | 'director' | 'connect';
  lockMode?: boolean;
}

const Login: React.FC<LoginProps> = ({ onLogin, initialMode = 'choice', lockMode = false }) => {
  type LoginMode = 'choice' | 'director' | 'connect';
  const resolveInitialMode = (value: typeof initialMode): LoginMode => {
    if (value === 'director') return 'director';
    if (value === 'connect') return 'connect';
    return 'choice';
  };

  const [mode, setMode] = useState<LoginMode>(() => resolveInitialMode(initialMode));
  const [directorUser, setDirectorUser] = useState('');
  const [directorPassword, setDirectorPassword] = useState('');
  const [directorLoading, setDirectorLoading] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectVariant, setConnectVariant] = useState<'first' | 'existing'>('first');
  const [status, setStatus] = useState<{ type: 'error' | 'info' | 'success'; message: string } | null>(null);
  const [connectToken, setConnectToken] = useState('');
  const [connectName, setConnectName] = useState('');
  const [connectPhone, setConnectPhone] = useState('');
  const [connectCpf, setConnectCpf] = useState('');
  const [connectPix, setConnectPix] = useState('');
  const [returnCpf, setReturnCpf] = useState('');

  useEffect(() => {
    setMode(resolveInitialMode(initialMode));
  }, [initialMode]);

  const switchMode = (nextMode: LoginMode) => {
    if (lockMode) return;
    setStatus(null);
    setConnectVariant('first');
    setConnectToken('');
    setConnectName('');
    setConnectPhone('');
    setConnectCpf('');
    setConnectPix('');
    setReturnCpf('');
    setMode(nextMode);
  };

  const handleConnectVariantChange = (variant: 'first' | 'existing') => {
    setConnectVariant(variant);
    setStatus(null);
  };

  const sanitizeCpf = (value: string) => value.replace(/\D/g, '');

  const captureGeoSnapshot = () => requestCurrentLocation().catch(() => null);

  const handleDirectorLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      setStatus({ type: 'error', message: 'Configure o Supabase URL/KEY no .env.local para continuar.' });
      return;
    }
    if (!directorUser.trim() || !directorPassword.trim()) {
      setStatus({ type: 'error', message: 'Informe usuário e senha.' });
      return;
    }

    const normalizedUser = directorUser.trim();
    const normalizedPassword = directorPassword.trim();

    setDirectorLoading(true);
    setStatus(null);
    try {
      const usernameFields = ['usuario', 'user', 'User'];
      let directorRow: any = null;
      let lastError: any = null;

      for (const field of usernameFields) {
        try {
          const response = await supabase
            .from('diretores')
            .select('*')
            .eq(field, normalizedUser)
            .maybeSingle();

          if (response.error) {
            if (response.error.code === '42703') {
              continue;
            }
            lastError = response.error;
            break;
          }

          if (response.data) {
            directorRow = response.data;
            break;
          }
        } catch (err) {
          lastError = err;
          break;
        }
      }

      if (lastError && !directorRow) {
        throw lastError;
      }

      if (!directorRow) {
        setStatus({ type: 'error', message: 'Usuário não encontrado.' });
        return;
      }

      const storedPassword =
        directorRow.senha ??
        directorRow.senha_hash ??
        directorRow.password ??
        directorRow.pass;

      if (!storedPassword) {
        setStatus({ type: 'error', message: 'Registro de diretor incompleto: falta senha.' });
        return;
      }

      if (storedPassword !== normalizedPassword) {
        setStatus({ type: 'error', message: 'Usuário ou senha inválidos.' });
        return;
      }

      let operationInfo: { id?: string; nome?: string; estado?: string } | null = null;
      try {
        const operationResponse = await supabase
          .from('operacoes')
          .select('id, nome, estado')
          .eq('diretor_id', directorRow.id || normalizedUser)
          .limit(1)
          .maybeSingle();

        if (operationResponse.error) {
          if (operationResponse.error.code !== 'PGRST116' && operationResponse.error.code !== '42703') {
            throw operationResponse.error;
          }
        } else {
          operationInfo = operationResponse.data;
        }
      } catch (operationError) {
        console.warn('Não foi possível recuperar os dados da operação do diretor.', operationError);
      }

      const directorName = directorRow.nome || directorRow.user || directorRow.usuario || 'Diretor';
      onLogin({
        id: directorRow.id || normalizedUser,
        name: directorName,
        role: UserRole.DIRECTOR,
        operationId: operationInfo?.id,
        operationName: operationInfo?.nome,
        operationState: operationInfo?.estado
      });
    } catch (error: any) {
      console.error('Supabase login error', error);
      setStatus({ type: 'error', message: 'Não foi possível validar as credenciais agora.' });
    } finally {
      setDirectorLoading(false);
    }
  };

  const extractInviteToken = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return '';
    try {
      const maybeUrl = new URL(trimmed);
      const fromUrl =
        maybeUrl.searchParams.get('token') ||
        maybeUrl.searchParams.get('code') ||
        maybeUrl.searchParams.get('data');
      if (fromUrl) return fromUrl;
      return maybeUrl.pathname.split('/').filter(Boolean).pop() || trimmed;
    } catch {
      return trimmed;
    }
  };

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      setStatus({ type: 'error', message: 'Configure o Supabase URL/KEY no .env.local para continuar.' });
      return;
    }
    const sanitizedCpf = sanitizeCpf(connectCpf);
    if (!connectToken.trim() || !connectName.trim() || !connectPhone.trim() || !sanitizedCpf || !connectPix.trim()) {
      setStatus({ type: 'error', message: 'Preencha todas as informações para conectar.' });
      return;
    }
    const token = extractInviteToken(connectToken);
    if (!token) {
      setStatus({ type: 'error', message: 'Token inválido. Verifique o link recebido.' });
      return;
    }

    const locationPromise = captureGeoSnapshot();
    setConnectLoading(true);
    setStatus(null);
    try {
      const fetchInvite = async (withJoin: boolean) => {
        const baseSelect =
          'id, token, tipo, operacao_id, expires_at, consumido_em, consumido_por, metadata, emitido_por';
        const selectClause = withJoin ? `${baseSelect}, operacoes(diretor_id)` : `${baseSelect}, diretor_id`;
        return supabase.from('convites').select(selectClause).eq('token', token).maybeSingle();
      };

      let inviteResponse = await fetchInvite(true);
      if (inviteResponse.error && inviteResponse.error.code === '42703') {
        inviteResponse = await fetchInvite(false);
      }

      if (inviteResponse.error) throw inviteResponse.error;

      const invite = inviteResponse.data;
      if (!invite) {
        setStatus({ type: 'error', message: 'Convite não encontrado.' });
        return;
      }

      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        setStatus({ type: 'error', message: 'Convite expirado. Solicite um novo link.' });
        return;
      }

      let metadata: Record<string, any> = {};
      if (invite.metadata) {
        if (typeof invite.metadata === 'string') {
          try {
            metadata = JSON.parse(invite.metadata);
          } catch {
            metadata = {};
          }
        } else {
          metadata = invite.metadata;
        }
      }

      const memberRole = (invite.tipo || '').toUpperCase();
      const resolvedRole = memberRole === 'LEADER' ? UserRole.L3 : UserRole.SOLDIER;
      const directorId = invite.operacoes?.diretor_id || invite.diretor_id || metadata?.diretor_id;

      if (!invite.operacao_id || !directorId) {
        setStatus({
          type: 'error',
          message: 'Convite incompleto. Gere novamente a partir do painel do seu superior.'
        });
        return;
      }

      const inviteTokenSignature = `${token}::${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;

      const payload: Record<string, any> = {
        operacao_id: invite.operacao_id,
        diretor_id: directorId,
        tipo: invite.tipo,
        nome: connectName.trim(),
        telefone: connectPhone.trim(),
        convite_token: inviteTokenSignature,
        cpf: sanitizedCpf,
        pix: connectPix.trim()
      };

      const responsavelId = metadata?.responsavel_id || invite.emitido_por;
      if (responsavelId) payload.responsavel_id = responsavelId;

      const memberResponse = await supabase
        .from('membros')
        .upsert(payload, { onConflict: 'operacao_id, cpf' })
        .select('id, nome, tipo, operacao_id, responsavel_id')
        .single();

      if (memberResponse.error) throw memberResponse.error;

      const member = memberResponse.data;
      if (!member) {
        setStatus({ type: 'error', message: 'Não foi possível registrar seu acesso. Tente novamente.' });
        return;
      }

      const operationId = member.operacao_id || payload.operacao_id;
      let operationDetails: { id?: string; nome?: string; estado?: string; diretor_id?: string } | null = null;
      if (operationId) {
        try {
          const operationResponse = await supabase
            .from('operacoes')
            .select('id, nome, estado, diretor_id')
            .eq('id', operationId)
            .maybeSingle();

          if (operationResponse.error) {
            if (operationResponse.error.code !== 'PGRST116') {
              throw operationResponse.error;
            }
          } else {
            operationDetails = operationResponse.data;
          }
        } catch (operationError) {
          console.warn('Não foi possível carregar a operação vinculada.', operationError);
        }
      }

      const loginLocation = await locationPromise;
      try {
        await recordMemberTimesheetEvent(member.id, 'LOGIN', loginLocation);
      } catch (timesheetError) {
        console.warn('Falha ao registrar ponto de entrada', timesheetError);
      }

      onLogin({
        id: member.id,
        name: member.nome,
        role: resolvedRole,
        leaderId:
          resolvedRole === UserRole.SOLDIER
            ? metadata?.responsavel_id || invite.emitido_por
            : operationDetails?.diretor_id,
        operationId,
        operationName: operationDetails?.nome,
        operationState: operationDetails?.estado
      });
    } catch (error: any) {
      console.error('Supabase invite error', error);
      if (error?.code === '23505') {
        setStatus({
          type: 'error',
          message: 'CPF já registrado nesta operação. Utilize a opção "Já sou registrado".'
        });
      } else {
        setStatus({ type: 'error', message: 'Não foi possível validar o convite agora.' });
      }
    } finally {
      setConnectLoading(false);
    }
  };

  const handleRegisteredLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      setStatus({ type: 'error', message: 'Configure o Supabase URL/KEY no .env.local para continuar.' });
      return;
    }
    const sanitizedCpf = sanitizeCpf(returnCpf);
    if (!sanitizedCpf) {
      setStatus({ type: 'error', message: 'Informe seu CPF para continuar.' });
      return;
    }

    const locationPromise = captureGeoSnapshot();
    setConnectLoading(true);
    setStatus(null);
    try {
      const memberResponse = await supabase
        .from('membros')
        .select('id, nome, tipo, operacao_id, responsavel_id')
        .eq('cpf', sanitizedCpf)
        .maybeSingle();

      if (memberResponse.error) throw memberResponse.error;
      const member = memberResponse.data;
      if (!member) {
        setStatus({ type: 'error', message: 'CPF não encontrado. Verifique os dígitos ou faça seu primeiro acesso.' });
        return;
      }

      let operationDetails: { id?: string; nome?: string; estado?: string; diretor_id?: string } | null = null;
      if ((member as any).operacoes) {
        operationDetails = (member as any).operacoes;
      } else if (member.operacao_id) {
        try {
          const opResp = await supabase
            .from('operacoes')
            .select('id, nome, estado, diretor_id')
            .eq('id', member.operacao_id)
            .maybeSingle();
          if (!opResp.error) {
            operationDetails = opResp.data;
          }
        } catch (opError) {
          console.warn('Falha ao ler operação vinculada ao membro', opError);
        }
      }

      const normalizedRole = (member.tipo || '').toUpperCase();
      let resolvedRole = UserRole.SOLDIER;
      if (normalizedRole.includes('LIDER_N1') || normalizedRole === 'L1') resolvedRole = UserRole.L1;
      else if (normalizedRole.includes('LIDER_N2') || normalizedRole === 'L2') resolvedRole = UserRole.L2;
      else if (normalizedRole.includes('LIDER_N3') || normalizedRole === 'L3' || normalizedRole === 'LEADER')
        resolvedRole = UserRole.L3;

      const loginLocation = await locationPromise;
      try {
        await recordMemberTimesheetEvent(member.id, 'LOGIN', loginLocation);
      } catch (timesheetError) {
        console.warn('Falha ao registrar ponto de entrada', timesheetError);
      }

      onLogin({
        id: member.id,
        name: member.nome,
        role: resolvedRole,
        leaderId: member.responsavel_id || undefined,
        operationId: member.operacao_id,
        operationName: operationDetails?.nome,
        operationState: operationDetails?.estado
      });
    } catch (error: any) {
      console.error('Login por CPF falhou', error);
      setStatus({ type: 'error', message: 'Não foi possível validar seu CPF agora.' });
    } finally {
      setConnectLoading(false);
    }
  };

  const renderStatus = () => {
    if (!status) return null;
    const colors =
      status.type === 'error'
        ? 'bg-red-500/10 border-red-500/30 text-red-200'
        : status.type === 'success'
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
        : 'bg-slate-500/10 border-slate-500/30 text-slate-200';

    return (
      <div className={`mt-3 p-3 text-sm font-medium rounded-xl border ${colors}`}>
        {status.message}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
        <div className="text-white space-y-6">
          <img src="/logo.png" alt="iArgos" className="max-w-xs w-full drop-shadow-2xl" />
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-indigo-400 font-semibold">Operação Eleitoral</p>
            <h1 className="text-4xl md:text-5xl font-black mt-3 leading-tight">Rede Integrada de Direção, Liderança e Campo</h1>
          </div>
          <p className="text-slate-400 text-base leading-relaxed">
            Apenas diretores podem iniciar uma nova operação. Líderes e Soldados são integrados através de links ou QR Codes
            emitidos pelo comando imediatamente superior.
          </p>
          <div className="flex gap-4 text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full"></span> Conexão Segura
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-indigo-500 rounded-full"></span> Monitoramento 24/7
            </div>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-md shadow-2xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <i className="fas fa-fingerprint text-indigo-400"></i>
              Autenticação
            </h2>
            {mode !== 'choice' && !lockMode && (
              <button onClick={() => switchMode('choice')} className="text-xs text-slate-400 hover:text-white transition-colors">
                Alterar opção
              </button>
            )}
          </div>

          {mode === 'choice' && !lockMode && (
            <div className="space-y-3">
              <button
                onClick={() => switchMode('director')}
                className="w-full p-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-semibold flex items-center justify-between transition-colors"
              >
                <span className="flex items-center gap-3">
                  <i className="fas fa-crown text-xl"></i> Diretor
                </span>
                <i className="fas fa-chevron-right text-sm"></i>
              </button>
              <button
                onClick={() => switchMode('connect')}
                className="w-full p-4 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-semibold flex items-center justify-between transition-colors border border-white/10"
              >
                <span className="flex items-center gap-3">
                  <i className="fas fa-link text-xl"></i> Conectar
                </span>
                <i className="fas fa-chevron-right text-sm"></i>
              </button>
            </div>
          )}

          {mode === 'director' && (
            <form className="space-y-4" onSubmit={handleDirectorLogin}>
              <div>
                <label className="text-xs uppercase font-bold text-slate-400">Usuário</label>
                <input
                  type="text"
                  value={directorUser}
                  onChange={(e) => setDirectorUser(e.target.value)}
                  className="w-full mt-2 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="codinome.diretor"
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="text-xs uppercase font-bold text-slate-400">Senha</label>
                <input
                  type="password"
                  value={directorPassword}
                  onChange={(e) => setDirectorPassword(e.target.value)}
                  className="w-full mt-2 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
              <button
                type="submit"
                disabled={directorLoading}
                className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {directorLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-door-open"></i>}
                Acessar Comando
              </button>
              {renderStatus()}
            </form>
          )}

          {mode === 'connect' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleConnectVariantChange('first')}
                  className={`py-3 rounded-2xl font-semibold flex items-center justify-center gap-2 border ${
                    connectVariant === 'first'
                      ? 'bg-white text-slate-900 border-white'
                      : 'bg-white/5 text-white border-white/10'
                  }`}
                >
                  <i className="fas fa-user-plus"></i> Primeiro Acesso
                </button>
                <button
                  type="button"
                  onClick={() => handleConnectVariantChange('existing')}
                  className={`py-3 rounded-2xl font-semibold flex items-center justify-center gap-2 border ${
                    connectVariant === 'existing'
                      ? 'bg-white text-slate-900 border-white'
                      : 'bg-white/5 text-white border-white/10'
                  }`}
                >
                  <i className="fas fa-id-card"></i> Já Sou Registrado
                </button>
              </div>

              {connectVariant === 'first' ? (
                <form className="space-y-4" onSubmit={handleConnect}>
                  <div>
                    <label className="text-xs uppercase font-bold text-slate-400">Link ou Código</label>
                    <input
                      type="text"
                      value={connectToken}
                      onChange={(e) => setConnectToken(e.target.value)}
                      className="w-full mt-2 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                      placeholder="cole aqui o token recebido"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs uppercase font-bold text-slate-400">Nome Completo</label>
                      <input
                        type="text"
                        value={connectName}
                        onChange={(e) => setConnectName(e.target.value)}
                        className="w-full mt-2 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="Seu nome"
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase font-bold text-slate-400">Telefone</label>
                      <input
                        type="tel"
                        value={connectPhone}
                        onChange={(e) => setConnectPhone(e.target.value)}
                        className="w-full mt-2 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs uppercase font-bold text-slate-400">CPF</label>
                      <input
                        type="text"
                        value={connectCpf}
                        onChange={(e) => setConnectCpf(e.target.value)}
                        className="w-full mt-2 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="Apenas números"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">Apenas números, sem pontos ou traços.</p>
                    </div>
                    <div>
                      <label className="text-xs uppercase font-bold text-slate-400">Chave PIX</label>
                      <input
                        type="text"
                        value={connectPix}
                        onChange={(e) => setConnectPix(e.target.value)}
                        className="w-full mt-2 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="CPF, telefone ou e-mail"
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] text-slate-400">
                      O link identifica automaticamente se você é Líder ou Soldado. Apenas confirme seus dados.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={connectLoading}
                    className="w-full py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {connectLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-link"></i>}
                    Registrar acesso
                  </button>
                </form>
              ) : (
                <form className="space-y-4" onSubmit={handleRegisteredLogin}>
                  <div>
                    <label className="text-xs uppercase font-bold text-slate-400">CPF</label>
                    <input
                      type="text"
                      value={returnCpf}
                      onChange={(e) => setReturnCpf(e.target.value)}
                      className="w-full mt-2 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                      placeholder="Digite apenas números"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Este é o método oficial de acesso para membros já cadastrados.
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={connectLoading}
                    className="w-full py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {connectLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-unlock"></i>}
                    Entrar com CPF
                  </button>
                </form>
              )}
              {renderStatus()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
