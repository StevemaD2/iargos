
import React, { useState, useEffect, useMemo } from 'react';
import {
  User,
  UserRole,
  SubmissionType,
  VoterSentiment,
  IntentionVoto,
  VoterInteraction,
  Submission
} from '../types';
import {
  createSubmission,
  fetchSubmissions,
  uploadSubmissionFiles,
  createSignedAttachmentUrl
} from '../services/submissionsService';
import { updateMemberLastLocation } from '../services/memberActivityService';

interface SubmissionFormProps {
  user: User;
}

const SubmissionForm: React.FC<SubmissionFormProps> = ({ user }) => {
  const [type, setType] = useState<SubmissionType>(SubmissionType.TEXTO_RELATO);
  const [context, setContext] = useState<'RUA' | 'DIGITAL' | 'MISTO'>('RUA');
  const [location, setLocation] = useState<GeolocationPosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState(user.operationState || '');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterContext, setFilterContext] = useState<string>('');
  const [filterMember, setFilterMember] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedattachments, setExpandedAttachments] = useState<Record<string, boolean>>({});
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, Record<string, string>>>({});
  const [attachmentLoading, setAttachmentLoading] = useState<Record<string, boolean>>({});
  const canCreate = user.role !== UserRole.DIRECTOR;
  const MAX_FILE_SIZE = 15 * 1024 * 1024;
  const ACCEPTED_TYPES = ['image/', 'audio/', 'video/'];
  
  // Interaction fields
  const [interaction, setInteraction] = useState<VoterInteraction>({
    foi_atendido: 'BEM',
    intencao_voto: IntentionVoto.EM_DUVIDA,
    sentimento: VoterSentiment.NEUTRO,
    principais_frases: '',
    objecoes: [],
    oportunidades: [],
    observacoes: '',
    temas_mencionados: [],
    urgencia_followup: 'MEDIA'
  });

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(pos),
      (err) => alert("Erro: GPS obrigatório para envio de dados em campo."),
      { enableHighAccuracy: true }
    );
  }, []);

  useEffect(() => {
    const loadSubmissions = async () => {
      if (!user.operationId) return;
      setSubmissionsLoading(true);
      setSubmissionsError(null);
      try {
        const data = await fetchSubmissions({
          operationId: user.operationId,
          memberId: user.role === UserRole.DIRECTOR ? undefined : user.id
        });
        setSubmissions(data);
      } catch (error) {
        console.error('Submissions fetch error', error);
        setSubmissionsError('Não foi possível carregar os registros.');
      } finally {
        setSubmissionsLoading(false);
      }
    };
    loadSubmissions();
  }, [user.operationId, user.role, user.id]);

  const availableMembers = useMemo(() => {
    if (user.role !== UserRole.DIRECTOR) return [];
    const names = new Map<string, string>();
    submissions.forEach((submission) => {
      if (submission.userId && submission.userName) {
        names.set(submission.userId, submission.userName);
      }
    });
    return Array.from(names.entries()).map(([id, name]) => ({ id, name }));
  }, [submissions, user.role]);

  const filteredSubmissions = useMemo(() => {
    return submissions.filter((submission) => {
      if (filterSearch) {
        const haystack = `${submission.content} ${submission.locationDetails?.bairro || ''} ${
          submission.locationDetails?.cidade || ''
        }`.toLowerCase();
        if (!haystack.includes(filterSearch.toLowerCase())) return false;
      }
      if (filterType && submission.type !== filterType) return false;
      if (filterContext && submission.context !== filterContext) return false;
      if (user.role === UserRole.DIRECTOR && filterMember && submission.userId !== filterMember) return false;
      if (dateFrom && submission.timestamp < `${dateFrom}T00:00:00`) return false;
      if (dateTo && submission.timestamp > `${dateTo}T23:59:59`) return false;
      return true;
    });
  }, [submissions, filterSearch, filterType, filterContext, filterMember, dateFrom, dateTo, user.role]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(event.target.files || []);
    if (!fileList.length) return;
    const invalid = fileList.find(
      (file) => file.size > MAX_FILE_SIZE || !ACCEPTED_TYPES.some((prefix) => file.type.startsWith(prefix))
    );
    if (invalid) {
      setFilesError('Apenas imagens, áudios ou vídeos até 15MB são permitidos no momento.');
      return;
    }
    setFilesError(null);
    setFiles(fileList);
  };

  const resetForm = () => {
    setContent('');
    setInteraction((prev) => ({ ...prev, principais_frases: '', observacoes: '' }));
    setFiles([]);
    setFileInputKey((prev) => prev + 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!user.operationId) {
      setFormError('Você precisa estar vinculado a uma operação para enviar relatos.');
      return;
    }
    if (!location) {
      setFormError('Aguardando precisão de GPS...');
      return;
    }
    setLoading(true);
    try {
      let attachments = [];
      if (files.length) {
        attachments = await uploadSubmissionFiles(user.operationId, user.id, files);
      }

      await updateMemberLastLocation(user.id, {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy: location.coords.accuracy
      });

      await createSubmission({
        operationId: user.operationId,
        memberId: user.id,
        memberName: user.name,
        type,
        context,
        content: content.trim(),
        interaction,
        location: {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          accuracy: location.coords.accuracy
        },
        locationDetails: {
          bairro: bairro.trim() || undefined,
          cidade: cidade.trim() || undefined,
          uf: uf.trim() || undefined
        },
        attachments
      });
      setSuccess(true);
      resetForm();
      setSubmissions((prev) => [
        {
          id: `local-${Date.now()}`,
          userId: user.id,
          userName: user.name,
          leaderChain: [],
          type,
          timestamp: new Date().toISOString(),
          geo: {
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            accuracy: location.coords.accuracy
          },
          locationDetails: {
            bairro: bairro.trim(),
            cidade: cidade.trim(),
            uf: uf.trim()
          },
          context,
          content: content.trim(),
          voterInteraction: interaction,
          attachments
        },
        ...prev
      ]);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error('Submission error', error);
      setFormError('Não foi possível enviar agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAttachments = async (submission: Submission) => {
    const isOpen = expandedattachments[submission.id];
    if (isOpen) {
      setExpandedAttachments((prev) => ({ ...prev, [submission.id]: false }));
      return;
    }
    setExpandedAttachments((prev) => ({ ...prev, [submission.id]: true }));
    if (!submission.attachments || !submission.attachments.length) return;
    if (attachmentUrls[submission.id]) return;
    setAttachmentLoading((prev) => ({ ...prev, [submission.id]: true }));
    try {
      const entries: Record<string, string> = {};
      await Promise.all(
        submission.attachments.map(async (attachment) => {
          const url = await createSignedAttachmentUrl(attachment.path);
          entries[attachment.id] = url;
        })
      );
      setAttachmentUrls((prev) => ({ ...prev, [submission.id]: entries }));
    } catch (error) {
      console.error('Attachment load error', error);
      setFormError('Não foi possível carregar os anexos agora.');
    } finally {
      setAttachmentLoading((prev) => ({ ...prev, [submission.id]: false }));
    }
  };

  const stats = useMemo(() => {
    const total = submissions.length;
    const withMedia = submissions.filter((item) => item.attachments && item.attachments.length > 0).length;
    return {
      total,
      withMedia,
      latest: submissions[0]?.timestamp
    };
  }, [submissions]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase">Operação</p>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Registros</h1>
          <p className="text-slate-500">
            {user.role === UserRole.DIRECTOR
              ? 'Visão completa dos relatos enviados pela operação.'
              : 'Acompanhe e envie relatos de campo com mídia e geolocalização.'}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase">Total</p>
            <p className="text-2xl font-black text-slate-900">{stats.total}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase">Com mídia</p>
            <p className="text-2xl font-black text-slate-900">{stats.withMedia}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase">Último envio</p>
            <p className="text-xs font-semibold text-slate-600">
              {stats.latest ? new Date(stats.latest).toLocaleString('pt-BR') : '--'}
            </p>
          </div>
        </div>
      </div>

      {canCreate && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 rounded-lg text-indigo-600">
              <i className="fas fa-microphone-lines text-xl"></i>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Novo registro</h2>
              <p className="text-sm text-slate-500">
                Precisão GPS: {location ? `${location.coords.accuracy.toFixed(1)}m` : 'Buscando...'}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Tipo de evidência</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as SubmissionType)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {Object.values(SubmissionType).map((t) => (
                    <option key={t} value={t}>
                      {t.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Contexto</label>
                <select
                  value={context}
                  onChange={(e) => setContext(e.target.value as 'RUA' | 'DIGITAL' | 'MISTO')}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="RUA">Presencial (Rua)</option>
                  <option value="DIGITAL">Digital (Redes Sociais)</option>
                  <option value="MISTO">Misto</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Relato / Conteúdo</label>
              <textarea
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[120px]"
                placeholder="Descreva o que aconteceu ou cole o link da postagem..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Bairro</label>
                <input
                  type="text"
                  value={bairro}
                  onChange={(e) => setBairro(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Centro"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Cidade</label>
                <input
                  type="text"
                  value={cidade}
                  onChange={(e) => setCidade(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="São Paulo"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">UF</label>
                <input
                  type="text"
                  value={uf}
                  onChange={(e) => setUf(e.target.value.toUpperCase())}
                  maxLength={2}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 uppercase"
                  placeholder="SP"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
              <h3 className="text-sm font-bold text-slate-900 border-b pb-2 flex items-center gap-2">
                <i className="fas fa-user-check text-indigo-500"></i> Interação
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Intenção de voto</label>
                  <select
                    value={interaction.intencao_voto}
                    onChange={(e) => setInteraction({ ...interaction, intencao_voto: e.target.value as any })}
                    className="w-full text-sm border-none bg-transparent focus:ring-0"
                  >
                    {Object.values(IntentionVoto).map((v) => (
                      <option key={v} value={v}>
                        {v.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sentimento</label>
                  <select
                    value={interaction.sentimento}
                    onChange={(e) => setInteraction({ ...interaction, sentimento: e.target.value as any })}
                    className="w-full text-sm border-none bg-transparent focus:ring-0"
                  >
                    {Object.values(VoterSentiment).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Frases / Citações</label>
                <textarea
                  placeholder="Ex: 'Prometeram e não cumpriram o asfalto...'"
                  className="w-full p-3 text-sm bg-white rounded-lg border border-slate-200 focus:ring-1 focus:ring-indigo-500"
                  rows={2}
                  value={interaction.principais_frases}
                  onChange={(e) => setInteraction({ ...interaction, principais_frases: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Anexos (foto, áudio ou vídeo)</label>
              <input
                key={fileInputKey}
                type="file"
                accept="image/*,audio/*,video/*"
                multiple
                onChange={handleFileChange}
                className="w-full rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm"
              />
              {filesError && <p className="text-xs text-red-600 mt-1">{filesError}</p>}
              {files.length > 0 && (
                <ul className="mt-2 text-sm text-slate-600 space-y-1">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="flex items-center justify-between">
                      <span>
                        {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== index))}
                        className="text-xs text-red-500 hover:text-red-600"
                      >
                        remover
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">{formError}</div>
            )}
            {success && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
                Registro enviado com sucesso!
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !location}
              className="w-full py-4 rounded-xl font-bold text-white transition-all shadow-lg flex items-center justify-center gap-3 disabled:opacity-60 bg-indigo-600 hover:bg-indigo-700"
            >
              {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-paper-plane"></i>}
              Enviar registro
            </button>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
        <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="text-[11px] font-bold text-slate-500 uppercase">Busca rápida</label>
                <input
                  type="text"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  placeholder="Conteúdo, bairro, cidade..."
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase">Tipo</label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Todos</option>
                  {Object.values(SubmissionType).map((item) => (
                    <option key={item} value={item}>
                      {item.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase">Contexto</label>
                <select
                  value={filterContext}
                  onChange={(e) => setFilterContext(e.target.value)}
                  className="mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Todos</option>
                  <option value="RUA">Rua</option>
                  <option value="DIGITAL">Digital</option>
                  <option value="MISTO">Misto</option>
                </select>
              </div>
              {user.role === UserRole.DIRECTOR && (
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase">Operador</label>
                  <select
                    value={filterMember}
                    onChange={(e) => setFilterMember(e.target.value)}
                    className="mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Todos</option>
                    {availableMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase">Data inicial</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase">Data final</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            {submissionsError && (
              <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">{submissionsError}</div>
            )}
          </div>

          <div className="space-y-3">
            {submissionsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <div key={`submission-skeleton-${item}`} className="h-32 bg-slate-100 rounded-2xl animate-pulse"></div>
                ))}
              </div>
            ) : filteredSubmissions.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 text-sm text-slate-500">
                Nenhum registro encontrado com os filtros atuais.
              </div>
            ) : (
              filteredSubmissions.map((submission) => (
                <div key={submission.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold text-indigo-600 uppercase flex items-center gap-2">
                        <i className="fas fa-file-alt"></i> {submission.type.replaceAll('_', ' ')}
                      </p>
                      <h3 className="text-lg font-semibold text-slate-900 mt-1 line-clamp-2">{submission.content}</h3>
                      <p className="text-[11px] text-slate-500 mt-2">
                        {new Date(submission.timestamp).toLocaleString('pt-BR')}
                        {user.role === UserRole.DIRECTOR && (
                          <span className="ml-2 font-bold text-slate-600">· {submission.userName}</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <p>{submission.context}</p>
                      <p>
                        {submission.locationDetails?.bairro || '--'} · {submission.locationDetails?.cidade || '--'}
                      </p>
                    </div>
                  </div>
                  {submission.voterInteraction?.principais_frases && (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-sm text-slate-600">
                      “{submission.voterInteraction.principais_frases}”
                    </div>
                  )}
                  {submission.attachments && submission.attachments.length > 0 && (
                    <div className="border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        onClick={() => handleToggleAttachments(submission)}
                        className="text-sm font-semibold text-indigo-600 hover:text-indigo-500 flex items-center gap-2"
                      >
                        <i className="fas fa-paperclip"></i>
                        {submission.attachments.length} anexo(s){' '}
                        {expandedattachments[submission.id] ? '· ocultar' : '· visualizar'}
                      </button>
                      {expandedattachments[submission.id] && (
                        <div className="mt-3 space-y-3">
                          {attachmentLoading[submission.id] && (
                            <p className="text-xs text-slate-500 flex items-center gap-2">
                              <i className="fas fa-spinner fa-spin"></i> Carregando arquivos...
                            </p>
                          )}
                          {attachmentUrls[submission.id] &&
                            submission.attachments.map((attachment) => {
                              const url = attachmentUrls[submission.id]?.[attachment.id];
                              if (!url) {
                                return (
                                  <div
                                    key={attachment.id}
                                    className="rounded-xl border border-slate-100 p-3 text-xs text-slate-500"
                                  >
                                    Preparando arquivo...
                                  </div>
                                );
                              }
                              if (attachment.kind === 'image') {
                                return (
                                  <div key={attachment.id} className="rounded-xl border border-slate-100 overflow-hidden">
                                    <img src={url} alt={attachment.name} className="w-full max-h-[240px] object-cover" />
                                  </div>
                                );
                              }
                              if (attachment.kind === 'audio') {
                                return (
                                  <div key={attachment.id} className="rounded-xl border border-slate-100 p-3 bg-slate-50">
                                    <p className="text-xs font-bold text-slate-600 mb-2">{attachment.name}</p>
                                    <audio controls src={url} className="w-full"></audio>
                                  </div>
                                );
                              }
                              if (attachment.kind === 'video') {
                                return (
                                  <div key={attachment.id} className="rounded-xl border border-slate-100 overflow-hidden">
                                    <video controls src={url} className="w-full max-h-[280px]"></video>
                                  </div>
                                );
                              }
                              return (
                                <a
                                  key={attachment.id}
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-xl border border-slate-100 p-3 bg-slate-50 text-sm text-indigo-600 hover:text-indigo-500"
                                >
                                  <i className="fas fa-download mr-2"></i> {attachment.name}
                                </a>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
    </div>
  );
};

export default SubmissionForm;
