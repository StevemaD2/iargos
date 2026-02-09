import { supabase } from './supabaseClient';
import { User, UserRole } from '../types';

export type ChatAction =
  | 'getChatList'
  | 'getChatMessages'
  | 'getChatArchive'
  | 'sendMessage'
  | 'globalSearch';

export interface ChatRequestBase {
  action: ChatAction;
  operacao_id: string;
  member_id?: string;
  role: UserRole;
}

const invokeChat = async <T>(body: Record<string, unknown>) => {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.functions.invoke('chat', { body });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Falha no chat.');
  return data.data as T;
};

const buildBase = (user: User, action: ChatAction): ChatRequestBase => ({
  action,
  operacao_id: user.operationId || '',
  member_id: user.role === UserRole.DIRECTOR ? (user.memberId || undefined) : user.id,
  role: user.role
});

export const getChatList = async (user: User) => {
  if (!user.operationId) throw new Error('Operação inválida.');
  return invokeChat<any[]>({
    ...buildBase(user, 'getChatList')
  });
};

export const getChatMessages = async (user: User, chatId: string, limit = 50) => {
  if (!user.operationId) throw new Error('Operação inválida.');
  return invokeChat<any[]>({
    ...buildBase(user, 'getChatMessages'),
    chat_id: chatId,
    limit
  });
};

export const getChatArchive = async (user: User, chatId: string, limit = 100) => {
  if (!user.operationId) throw new Error('Operação inválida.');
  return invokeChat<any[]>({
    ...buildBase(user, 'getChatArchive'),
    chat_id: chatId,
    limit
  });
};

export const sendChatMessage = async (
  user: User,
  payload: { chatId?: string; chatType?: 'GLOBAL' | 'ZONAL' | 'DIRECT'; zoneId?: string; targetMemberId?: string; content: string }
) => {
  if (!user.operationId) throw new Error('Operação inválida.');
  return invokeChat<any>({
    ...buildBase(user, 'sendMessage'),
    sender_name: user.role === UserRole.DIRECTOR ? 'Diretor' : user.name,
    director_id: user.role === UserRole.DIRECTOR ? user.id : undefined,
    chat_id: payload.chatId,
    chat_type: payload.chatType,
    zone_id: payload.zoneId,
    target_member_id: payload.targetMemberId,
    content: payload.content
  });
};

export const globalChatSearch = async (user: User, term: string) => {
  if (!user.operationId) throw new Error('Operação inválida.');
  return invokeChat<any[]>({
    ...buildBase(user, 'globalSearch'),
    term
  });
};
