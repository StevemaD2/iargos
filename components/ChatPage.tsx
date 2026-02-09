import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User, UserRole } from '../types';
import { supabase } from '../services/supabaseClient';
import {
  getChatArchive,
  getChatList,
  getChatMessages,
  globalChatSearch,
  sendChatMessage
} from '../services/chatService';

type ChatItem = {
  id: string;
  type: 'GLOBAL' | 'ZONAL' | 'DIRECT';
  zone_id?: string | null;
  chat_key: string;
  created_at: string;
  last_message?: { content?: string | null; created_at?: string | null } | null;
};

type ChatMessage = {
  id: string;
  chat_id: string;
  sender_id?: string | null;
  sender_name?: string | null;
  sender_role?: string | null;
  content: string;
  created_at: string;
};

type MemberRow = {
  id: string;
  nome: string;
  tipo: string;
  responsavel_id: string | null;
};

const isLeaderRole = (role: UserRole) => [UserRole.L1, UserRole.L2, UserRole.L3].includes(role);

const formatTime = (value?: string | null) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (value?: string | null) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('pt-BR');
};

const ChatPage: React.FC<{ user: User }> = ({ user }) => {
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatItem | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [archive, setArchive] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const [tab, setTab] = useState<'live' | 'archive'>('live');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [directTarget, setDirectTarget] = useState('');
  const [creatingDirect, setCreatingDirect] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const isDirector = user.role === UserRole.DIRECTOR;

  const memberMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((member) => map.set(member.id, member.nome));
    return map;
  }, [members]);

  const allowedDirectMembers = useMemo(() => {
    if (!user.operationId) return [];
    if (user.role === UserRole.DIRECTOR) return members;

    if (isLeaderRole(user.role)) {
      const byLeader = new Map<string, string[]>();
      members.forEach((member) => {
        if (!member.responsavel_id) return;
        const list = byLeader.get(member.responsavel_id) || [];
        list.push(member.id);
        byLeader.set(member.responsavel_id, list);
      });
      const set = new Set<string>();
      const stack = [user.id];
      while (stack.length) {
        const current = stack.pop() as string;
        const children = byLeader.get(current) || [];
        children.forEach((id) => {
          if (!set.has(id)) {
            set.add(id);
            stack.push(id);
          }
        });
      }
      return members.filter((member) => set.has(member.id));
    }

    const byId = new Map<string, string | null>();
    members.forEach((member) => byId.set(member.id, member.responsavel_id));
    const chain: string[] = [];
    let current = byId.get(user.id) || null;
    while (current) {
      chain.push(current);
      current = byId.get(current) || null;
    }
    return members.filter((member) => chain.includes(member.id));
  }, [members, user.id, user.operationId, user.role]);

  const loadMembers = useCallback(async () => {
    if (!supabase || !user.operationId) return;
    const { data, error: memberError } = await supabase
      .from('membros')
      .select('id, nome, tipo, responsavel_id')
      .eq('operacao_id', user.operationId);
    if (memberError) {
      console.warn('Erro ao carregar membros para o chat', memberError);
      return;
    }
    setMembers((data || []) as MemberRow[]);
  }, [user.operationId]);

  const loadChatList = useCallback(async () => {
    if (!user.operationId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getChatList(user);
      setChats(data as ChatItem[]);
      if (!selectedChat && data.length) {
        setSelectedChat(data[0] as ChatItem);
      }
    } catch (err) {
      console.error('Chat list error', err);
      setError('Não foi possível carregar os chats.');
    } finally {
      setLoading(false);
    }
  }, [user, selectedChat]);

  const loadMessages = useCallback(async () => {
    if (!selectedChat) {
      setMessages([]);
      setArchive([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getChatMessages(user, selectedChat.id, 80);
      setMessages((data as ChatMessage[]).reverse());
      if (tab === 'archive' && selectedChat.type !== 'DIRECT' && (user.role === UserRole.DIRECTOR || isLeaderRole(user.role))) {
        const archived = await getChatArchive(user, selectedChat.id, 120);
        setArchive((archived as ChatMessage[]).reverse());
      }
    } catch (err) {
      console.error('Chat messages error', err);
      setError('Não foi possível carregar as mensagens.');
    } finally {
      setLoading(false);
    }
  }, [selectedChat, tab, user]);

  useEffect(() => {
    loadMembers();
    loadChatList();
  }, [loadMembers, loadChatList]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!selectedChat) {
      setMobileView('list');
    } else {
      setMobileView('chat');
    }
  }, [selectedChat]);

  useEffect(() => {
    if (!selectedChat) return;
    const timer = window.setInterval(() => {
      getChatMessages(user, selectedChat.id, 1)
        .then((latest) => {
          const latestId = (latest as ChatMessage[])[0]?.id;
          const currentId = messages[messages.length - 1]?.id;
          if (latestId && latestId !== currentId) {
            loadMessages();
          }
        })
        .catch(() => {
          // ignore polling errors
        });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [selectedChat, loadMessages, messages, user]);

  const handleSend = async () => {
    const content = messageDraft.trim();
    if (!content || !selectedChat) return;
    setCreatingDirect(true);
    try {
      const message = await sendChatMessage(user, { chatId: selectedChat.id, content });
      setMessages((prev) => [...prev, message as ChatMessage]);
      setMessageDraft('');
    } catch (err) {
      console.error('Send chat error', err);
      setError('Não foi possível enviar a mensagem.');
    } finally {
      setCreatingDirect(false);
    }
  };

  const handleCreateDirect = async () => {
    if (!directTarget) return;
    setCreatingDirect(true);
    try {
      const message = await sendChatMessage(user, {
        chatType: 'DIRECT',
        targetMemberId: directTarget,
        content: 'Início da conversa.'
      });
      setMessageDraft('');
      await loadChatList();
      const createdChatId = (message as ChatMessage).chat_id;
      if (createdChatId) {
        setSelectedChat({ id: createdChatId } as ChatItem);
      }
    } catch (err) {
      console.error('Direct chat error', err);
      setError('Não foi possível iniciar conversa agora.');
    } finally {
      setCreatingDirect(false);
    }
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setSearchLoading(true);
    try {
      const results = await globalChatSearch(user, searchTerm.trim());
      setSearchResults(results as ChatMessage[]);
    } catch (err) {
      console.error('Chat search error', err);
      setError('Não foi possível buscar no chat.');
    } finally {
      setSearchLoading(false);
    }
  };

  const resolveDirectChatLabel = (chat: ChatItem) => {
    const key = chat.chat_key || '';
    if (!key.startsWith('direct:')) return 'Chat Direto';
    const parts = key.replace('direct:', '').split(':');
    if (isDirector && parts[0] === 'director') {
      const targetId = parts[1];
      return memberMap.get(targetId) || 'Chat Direto';
    }
    const currentId = user.memberId || user.id;
    const otherId = parts.find((id) => id && id !== currentId);
    if (!otherId) return 'Chat Direto';
    return memberMap.get(otherId) || 'Chat Direto';
  };

  const isDirectWithCurrent = (chat: ChatItem) => {
    if (chat.type !== 'DIRECT') return false;
    const key = chat.chat_key || '';
    if (!key.startsWith('direct:')) return false;
    const parts = key.replace('direct:', '').split(':');
    if (isDirector) {
      return parts[0] === 'director';
    }
    const currentId = user.memberId || user.id;
    return parts.includes(currentId);
  };

  const renderChatTitle = (chat: ChatItem) => {
    if (chat.type === 'GLOBAL') return 'Geral';
    if (chat.type === 'ZONAL') return `Grupo ${chat.zone_id?.slice(0, 6) || ''}`;
    return resolveDirectChatLabel(chat);
  };

  const activeMessages = tab === 'archive' ? archive : messages;
  const showArchive = selectedChat && selectedChat.type !== 'DIRECT' && (user.role === UserRole.DIRECTOR || isLeaderRole(user.role));
  const canWriteToChat = selectedChat
    ? selectedChat.type !== 'DIRECT' || isDirectWithCurrent(selectedChat)
    : false;

  const myChats = useMemo(() => {
    if (!isDirector) return chats;
    return chats.filter((chat) => chat.type !== 'DIRECT' || isDirectWithCurrent(chat));
  }, [chats, isDirector]);

  const otherChats = useMemo(() => {
    if (!isDirector) return [];
    return chats.filter((chat) => chat.type === 'DIRECT' && !isDirectWithCurrent(chat));
  }, [chats, isDirector]);

  return (
    <div className="p-4 lg:p-6 h-full min-h-0 overflow-hidden">
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 h-full min-h-0 overflow-hidden">
        <div
          className={`w-full lg:w-80 bg-white border border-slate-200 rounded-2xl p-4 min-h-0 flex flex-col overflow-hidden ${
            mobileView === 'list' ? 'flex' : 'hidden'
          } lg:flex`}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-black text-slate-900">Chats</h2>
            <button
              onClick={loadChatList}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold"
            >
              Atualizar
            </button>
          </div>

          {(user.role === UserRole.DIRECTOR || isLeaderRole(user.role)) && (
            <div className="mb-4">
              <label className="text-[10px] uppercase text-slate-400 font-bold">Busca geral</label>
              <div className="flex gap-2 mt-2">
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs"
                  placeholder="Buscar no chat..."
                />
                <button
                  onClick={handleSearch}
                  className="text-xs px-3 py-2 bg-indigo-600 text-white rounded-lg font-bold"
                  disabled={searchLoading}
                >
                  {searchLoading ? '...' : 'Buscar'}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="mt-3 max-h-40 overflow-y-auto text-xs text-slate-600 space-y-2">
                  {searchResults.map((result) => (
                    <div key={result.id} className="border border-slate-100 rounded-lg p-2">
                      <p className="font-semibold text-slate-800">
                        {result.sender_role === 'DIRETOR'
                          ? 'Diretor'
                          : result.sender_name || (result.sender_id ? memberMap.get(result.sender_id) : null) || 'Operador'}
                      </p>
                      <p className="text-[10px] text-slate-400">{formatDate(result.created_at)}</p>
                      <p>{result.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mb-4">
            <label className="text-[10px] uppercase text-slate-400 font-bold">Novo 1:1</label>
            <div className="flex gap-2 mt-2">
              <select
                value={directTarget}
                onChange={(e) => setDirectTarget(e.target.value)}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs"
              >
                <option value="">Selecione alguém</option>
                {allowedDirectMembers.map((member) => (
                  <option key={member.id} value={member.id}>{member.nome}</option>
                ))}
              </select>
              <button
                onClick={handleCreateDirect}
                className="text-xs px-3 py-2 bg-slate-900 text-white rounded-lg font-bold"
                disabled={!directTarget || creatingDirect}
              >
                {creatingDirect ? '...' : 'Abrir'}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
            {loading && chats.length === 0 ? (
              <div className="text-xs text-slate-500">Carregando chats...</div>
            ) : chats.length === 0 ? (
              <div className="text-xs text-slate-500">Nenhum chat disponível.</div>
            ) : (
              <>
                {isDirector && (
                  <p className="text-[10px] uppercase text-slate-400 font-bold mt-2">Minhas Conversas</p>
                )}
                {(isDirector ? myChats : chats).map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => {
                      setSelectedChat(chat);
                      setTab('live');
                      setMobileView('chat');
                    }}
                    className={`w-full text-left border rounded-xl p-3 transition ${
                      selectedChat?.id === chat.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className="text-sm font-bold text-slate-900">{renderChatTitle(chat)}</p>
                    {chat.last_message?.content && (
                      <p className="text-xs text-slate-500 truncate">
                        {chat.last_message.content}
                      </p>
                    )}
                    {chat.last_message?.created_at && (
                      <p className="text-[10px] text-slate-400 mt-1">{formatTime(chat.last_message.created_at)}</p>
                    )}
                  </button>
                ))}
                {isDirector && otherChats.length > 0 && (
                  <>
                    <p className="text-[10px] uppercase text-slate-400 font-bold mt-4">Outras Conversas</p>
                    {otherChats.map((chat) => (
                      <button
                        key={chat.id}
                        onClick={() => {
                          setSelectedChat(chat);
                          setTab('live');
                          setMobileView('chat');
                        }}
                        className={`w-full text-left border rounded-xl p-3 transition ${
                          selectedChat?.id === chat.id
                            ? 'border-amber-400 bg-amber-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <p className="text-sm font-bold text-slate-900">{renderChatTitle(chat)}</p>
                        <p className="text-[10px] text-amber-600 font-bold">Somente leitura</p>
                        {chat.last_message?.content && (
                          <p className="text-xs text-slate-500 truncate">
                            {chat.last_message.content}
                          </p>
                        )}
                        {chat.last_message?.created_at && (
                          <p className="text-[10px] text-slate-400 mt-1">{formatTime(chat.last_message.created_at)}</p>
                        )}
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div
          className={`flex-1 bg-white border border-slate-200 rounded-2xl p-4 lg:p-6 min-h-0 flex flex-col overflow-hidden ${
            mobileView === 'chat' ? 'flex' : 'hidden'
          } lg:flex`}
        >
          <div className="flex items-center gap-3 mb-4 lg:hidden">
            <button
              onClick={() => setMobileView('list')}
              className="text-xs px-3 py-2 rounded-lg bg-slate-100 text-slate-700 font-bold"
            >
              Voltar
            </button>
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Conversas</p>
          </div>
          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </div>
          )}
          {!selectedChat ? (
            <div className="text-sm text-slate-500">Selecione um chat para começar.</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl font-black text-slate-900">{renderChatTitle(selectedChat)}</h3>
                  <p className="text-xs text-slate-500">
                    {selectedChat.type === 'DIRECT' ? 'Conversa direta' : 'Canal de coordenação'}
                  </p>
                </div>
                {showArchive && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setTab('live')}
                      className={`text-xs px-3 py-2 rounded-lg font-bold ${
                        tab === 'live' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      Atual
                    </button>
                    <button
                      onClick={() => setTab('archive')}
                      className={`text-xs px-3 py-2 rounded-lg font-bold ${
                        tab === 'archive' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      Histórico
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 border border-slate-100 rounded-2xl p-4 bg-slate-50">
                {loading && activeMessages.length === 0 ? (
                  <div className="text-xs text-slate-500">Carregando mensagens...</div>
                ) : activeMessages.length === 0 ? (
                  <div className="text-xs text-slate-500">Nenhuma mensagem ainda.</div>
                ) : (
                  activeMessages.map((message) => {
                    const isDirectorMessage = message.sender_role === 'DIRETOR';
                    const isMine =
                      user.role === UserRole.DIRECTOR
                        ? isDirectorMessage
                        : message.sender_id === (user.memberId || user.id);
                    return (
                      <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm leading-tight ${
                          isMine
                            ? 'bg-indigo-600 text-white'
                            : isDirectorMessage
                              ? 'bg-amber-100 border border-amber-200 text-amber-900'
                              : 'bg-white border border-slate-200 text-slate-800'
                        }`}>
                          <div className="flex items-center justify-between gap-3 text-[10px] font-bold opacity-80 mb-1">
                            <span>
                              {message.sender_role === 'DIRETOR'
                                ? 'Diretor'
                                : message.sender_name || (message.sender_id ? memberMap.get(message.sender_id) : null) || 'Operador'}
                            </span>
                            <span className="opacity-70">{formatTime(message.created_at)}</span>
                          </div>
                          <p className="text-sm leading-snug">{message.content}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {isDirector && selectedChat && selectedChat.type === 'DIRECT' && !isDirectWithCurrent(selectedChat) && (
                <div className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  Conversa de terceiros: somente leitura.
                </div>
              )}

              <div className="mt-4 flex gap-3 shrink-0">
                <textarea
                  value={messageDraft}
                  onChange={(e) => setMessageDraft(e.target.value)}
                  placeholder="Digite sua mensagem..."
                  className="flex-1 border border-slate-200 rounded-xl px-4 py-3 text-sm resize-none"
                  disabled={!canWriteToChat || creatingDirect}
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!messageDraft.trim() || creatingDirect || !canWriteToChat}
                  className="px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm"
                >
                  Enviar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
