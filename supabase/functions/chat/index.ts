import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Role = 'DIRETOR' | 'LIDER_N1' | 'LIDER_N2' | 'LIDER_N3' | 'SOLDADO';

type ChatAction =
  | 'getChatList'
  | 'getChatMessages'
  | 'getChatArchive'
  | 'sendMessage'
  | 'globalSearch';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(supabaseUrl, serviceKey);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const isLeaderRole = (role: Role) => role === 'LIDER_N1' || role === 'LIDER_N2' || role === 'LIDER_N3';

const toDateKey = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  return date.toISOString().slice(0, 10);
};

const buildDirectKey = (a: string, b: string) => {
  const [minId, maxId] = [a, b].sort();
  return `direct:${minId}:${maxId}`;
};

const buildGlobalKey = (operationId: string) => `global:${operationId}`;

const buildZoneKey = (zoneId: string) => `zone:${zoneId}`;

const fetchMembers = async (operationId: string) => {
  const { data, error } = await supabase
    .from('membros')
    .select('id, responsavel_id')
    .eq('operacao_id', operationId);
  if (error) throw error;
  return data || [];
};

const buildSubordinates = (leaderId: string, members: Array<{ id: string; responsavel_id: string | null }>) => {
  const byLeader = new Map<string, string[]>();
  members.forEach((member) => {
    if (!member.responsavel_id) return;
    const list = byLeader.get(member.responsavel_id) || [];
    list.push(member.id);
    byLeader.set(member.responsavel_id, list);
  });
  const result = new Set<string>();
  const stack = [leaderId];
  while (stack.length) {
    const current = stack.pop() as string;
    const children = byLeader.get(current) || [];
    children.forEach((id) => {
      if (!result.has(id)) {
        result.add(id);
        stack.push(id);
      }
    });
  }
  return result;
};

const buildLeaderChain = (memberId: string, members: Array<{ id: string; responsavel_id: string | null }>) => {
  const byId = new Map<string, string | null>();
  members.forEach((member) => {
    byId.set(member.id, member.responsavel_id || null);
  });
  const chain: string[] = [];
  let current: string | null = byId.get(memberId) || null;
  while (current) {
    chain.push(current);
    current = byId.get(current) || null;
  }
  return chain;
};

const fetchZoneLeaders = async (zoneId: string) => {
  const { data, error } = await supabase
    .from('zona_lideres')
    .select('lider_id')
    .eq('zona_id', zoneId);
  if (error) throw error;
  return (data || []).map((row) => row.lider_id);
};

const fetchZonesForLeaders = async (leaderIds: string[]) => {
  if (!leaderIds.length) return [] as string[];
  const { data, error } = await supabase
    .from('zona_lideres')
    .select('zona_id')
    .in('lider_id', leaderIds);
  if (error) throw error;
  const ids = new Set<string>();
  (data || []).forEach((row) => ids.add(row.zona_id));
  return [...ids];
};

const ensureChat = async (operationId: string, type: 'GLOBAL' | 'ZONAL' | 'DIRECT', chatKey: string, zoneId?: string | null) => {
  const { data, error } = await supabase
    .from('chats')
    .select('id, operacao_id, type, zone_id, chat_key, created_at')
    .eq('operacao_id', operationId)
    .eq('chat_key', chatKey)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: createError } = await supabase
    .from('chats')
    .insert({
      operacao_id: operationId,
      type,
      zone_id: zoneId || null,
      chat_key: chatKey
    })
    .select('id, operacao_id, type, zone_id, chat_key, created_at')
    .single();
  if (createError) throw createError;
  return created;
};

const ensureChatMembers = async (chatId: string, operationId: string, memberIds: string[]) => {
  const rows = memberIds.map((id) => ({ chat_id: chatId, operacao_id: operationId, membro_id: id }));
  const { error } = await supabase.from('chat_members').upsert(rows, { onConflict: 'chat_id,membro_id' });
  if (error) throw error;
};

const fetchChatById = async (chatId: string) => {
  const { data, error } = await supabase
    .from('chats')
    .select('id, operacao_id, type, zone_id, chat_key, created_at')
    .eq('id', chatId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const getAccessibleChats = async (operationId: string, memberId: string | null, role: Role) => {
  const isDirector = role === 'DIRETOR';
  const leaderRole = isLeaderRole(role);

  const chats: any[] = [];

  if (isDirector) {
    const { data, error } = await supabase
      .from('chats')
      .select('id, operacao_id, type, zone_id, chat_key, created_at')
      .eq('operacao_id', operationId);
    if (error) throw error;
    return data || [];
  }

  if (!memberId) return [];

  const globalChat = await ensureChat(operationId, 'GLOBAL', buildGlobalKey(operationId));
  chats.push(globalChat);

  const members = await fetchMembers(operationId);

  if (leaderRole) {
    const leaderZones = await fetchZonesForLeaders([memberId]);
    for (const zoneId of leaderZones) {
      const chat = await ensureChat(operationId, 'ZONAL', buildZoneKey(zoneId), zoneId);
      chats.push(chat);
    }

    const { data: directChats, error } = await supabase
      .from('chat_members')
      .select('chats(id, operacao_id, type, zone_id, chat_key, created_at)')
      .eq('membro_id', memberId);
    if (error) throw error;
    (directChats || []).forEach((row: any) => {
      if (row.chats && row.chats.type === 'DIRECT') chats.push(row.chats);
    });
  } else {
    const leaderChain = buildLeaderChain(memberId, members);
    const zones = await fetchZonesForLeaders(leaderChain);
    for (const zoneId of zones) {
      const chat = await ensureChat(operationId, 'ZONAL', buildZoneKey(zoneId), zoneId);
      chats.push(chat);
    }

    const { data: directChats, error } = await supabase
      .from('chat_members')
      .select('chats(id, operacao_id, type, zone_id, chat_key, created_at)')
      .eq('membro_id', memberId);
    if (error) throw error;
    (directChats || []).forEach((row: any) => {
      if (row.chats && row.chats.type === 'DIRECT') chats.push(row.chats);
    });
  }

  const unique = new Map<string, any>();
  chats.forEach((chat) => unique.set(chat.id, chat));
  return [...unique.values()];
};

const canAccessChat = async (chat: any, operationId: string, memberId: string | null, role: Role) => {
  if (!chat || chat.operacao_id !== operationId) return false;
  if (role === 'DIRETOR') return true;
  if (!memberId) return false;

  if (chat.type === 'DIRECT') {
    const { data, error } = await supabase
      .from('chat_members')
      .select('membro_id')
      .eq('chat_id', chat.id)
      .eq('membro_id', memberId)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }

  if (chat.type === 'GLOBAL') return true;

  if (chat.type === 'ZONAL') {
    const zoneId = chat.zone_id;
    if (!zoneId) return false;
    if (isLeaderRole(role)) {
      const zones = await fetchZonesForLeaders([memberId]);
      return zones.includes(zoneId);
    }
    const members = await fetchMembers(operationId);
    const leaderChain = buildLeaderChain(memberId, members);
    const zones = await fetchZonesForLeaders(leaderChain);
    return zones.includes(zoneId);
  }

  return false;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  const action = payload?.action as ChatAction | undefined;
  const operationId = payload?.operacao_id as string | undefined;
  const memberId = payload?.member_id as string | undefined;
  const role = payload?.role as Role | undefined;

  if (!action || !operationId || !role) {
    return json(400, { ok: false, error: 'Missing action/operacao_id/role' });
  }

  if (role !== 'DIRETOR' && !memberId) {
    return json(400, { ok: false, error: 'member_id required for this role' });
  }

  if (memberId) {
    const { data: memberRow, error } = await supabase
      .from('membros')
      .select('id, operacao_id')
      .eq('id', memberId)
      .maybeSingle();
    if (error) return json(500, { ok: false, error: error.message });
    if (!memberRow || memberRow.operacao_id !== operationId) {
      return json(403, { ok: false, error: 'member/operacao mismatch' });
    }
  }

  try {
    if (action === 'getChatList') {
      const chats = await getAccessibleChats(operationId, memberId || null, role);
      const chatIds = chats.map((chat) => chat.id);
      let lastMessages: Record<string, any> = {};
      if (chatIds.length) {
        const { data: latest, error } = await supabase
          .from('chat_messages')
          .select('chat_id, content, created_at, sender_id, sender_name, sender_role')
          .in('chat_id', chatIds)
          .order('created_at', { ascending: false });
        if (error) throw error;
        (latest || []).forEach((row) => {
          if (!lastMessages[row.chat_id]) {
            lastMessages[row.chat_id] = row;
          }
        });
      }
      const enriched = chats.map((chat) => ({
        ...chat,
        last_message: lastMessages[chat.id] || null
      }));
      return json(200, { ok: true, data: enriched });
    }

    if (action === 'getChatMessages') {
      const chatId = payload?.chat_id as string | undefined;
      if (!chatId) return json(400, { ok: false, error: 'chat_id required' });
      const chat = await fetchChatById(chatId);
      if (!chat) return json(404, { ok: false, error: 'chat not found' });
      const allowed = await canAccessChat(chat, operationId, memberId || null, role);
      if (!allowed) return json(403, { ok: false, error: 'not allowed' });

      const limit = Number(payload?.limit || 50);
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, chat_id, operacao_id, sender_id, sender_name, sender_role, content, attachments, created_at')
        .eq('chat_id', chatId)
        .eq('operacao_id', operationId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return json(200, { ok: true, data: data || [] });
    }

    if (action === 'getChatArchive') {
      const chatId = payload?.chat_id as string | undefined;
      if (!chatId) return json(400, { ok: false, error: 'chat_id required' });
      if (!isLeaderRole(role) && role !== 'DIRETOR') {
        return json(403, { ok: false, error: 'archive only for leaders/director' });
      }
      const chat = await fetchChatById(chatId);
      if (!chat) return json(404, { ok: false, error: 'chat not found' });
      if (chat.type === 'DIRECT') {
        return json(400, { ok: false, error: 'direct chat has no archive' });
      }
      const allowed = await canAccessChat(chat, operationId, memberId || null, role);
      if (!allowed) return json(403, { ok: false, error: 'not allowed' });

      const limit = Number(payload?.limit || 100);
      const { data, error } = await supabase
        .from('chat_messages_archive')
        .select('id, chat_id, operacao_id, sender_id, sender_name, sender_role, content, attachments, created_at')
        .eq('chat_id', chatId)
        .eq('operacao_id', operationId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return json(200, { ok: true, data: data || [] });
    }

    if (action === 'sendMessage') {
      const content = (payload?.content || '').toString().trim();
      const chatId = payload?.chat_id as string | undefined;
      const chatType = payload?.chat_type as 'GLOBAL' | 'ZONAL' | 'DIRECT' | undefined;
      const zoneId = payload?.zone_id as string | undefined;
      const targetMemberId = payload?.target_member_id as string | undefined;
      const senderName = (payload?.sender_name || '').toString().trim();
      const directorId = payload?.director_id ? payload.director_id.toString() : null;

      if (!content) return json(400, { ok: false, error: 'content required' });

      let chat: any = null;

      if (chatId) {
        chat = await fetchChatById(chatId);
        if (!chat) return json(404, { ok: false, error: 'chat not found' });
      } else if (chatType === 'DIRECT') {
        if (!targetMemberId) return json(400, { ok: false, error: 'target_member_id required' });
        if (role === 'DIRETOR') {
          const directKey = `direct:director:${targetMemberId}`;
          chat = await ensureChat(operationId, 'DIRECT', directKey, null);
          await ensureChatMembers(chat.id, operationId, [targetMemberId]);
        } else {
          if (!memberId) return json(400, { ok: false, error: 'member_id required' });
          const directKey = buildDirectKey(memberId, targetMemberId);
          chat = await ensureChat(operationId, 'DIRECT', directKey, null);
          await ensureChatMembers(chat.id, operationId, [memberId, targetMemberId]);
        }
      } else if (chatType === 'GLOBAL') {
        chat = await ensureChat(operationId, 'GLOBAL', buildGlobalKey(operationId), null);
      } else if (chatType === 'ZONAL') {
        if (!zoneId) return json(400, { ok: false, error: 'zone_id required' });
        chat = await ensureChat(operationId, 'ZONAL', buildZoneKey(zoneId), zoneId);
      } else {
        return json(400, { ok: false, error: 'chat_id or chat_type required' });
      }

      const allowed = await canAccessChat(chat, operationId, memberId || null, role);
      if (!allowed) return json(403, { ok: false, error: 'not allowed' });

      if (!memberId && role !== 'DIRETOR') {
        return json(403, { ok: false, error: 'member_id required to send' });
      }

      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          chat_id: chat.id,
          operacao_id: operationId,
          sender_id: role === 'DIRETOR' ? null : memberId,
          sender_name: role === 'DIRETOR' ? (senderName || 'Diretor') : null,
          sender_role: role === 'DIRETOR' ? 'DIRETOR' : null,
          content,
          attachments: payload?.attachments || null
        })
        .select('id, chat_id, operacao_id, sender_id, sender_name, sender_role, content, attachments, created_at')
        .single();
      if (error) throw error;
      return json(200, { ok: true, data });
    }

    if (action === 'globalSearch') {
      if (!isLeaderRole(role) && role !== 'DIRETOR') {
        return json(403, { ok: false, error: 'search only for leaders/director' });
      }
      const term = (payload?.term || '').toString().trim();
      if (!term) return json(400, { ok: false, error: 'term required' });

      const accessibleChats = await getAccessibleChats(operationId, memberId || null, role);
      const chatIds = accessibleChats.map((chat) => chat.id);
      if (!chatIds.length) return json(200, { ok: true, data: [] });

      const { data, error } = await supabase
        .from('chat_messages_all')
        .select('id, chat_id, operacao_id, sender_id, sender_name, sender_role, content, attachments, created_at')
        .eq('operacao_id', operationId)
        .in('chat_id', chatIds)
        .ilike('content', `%${term}%`)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return json(200, { ok: true, data: data || [] });
    }

    return json(400, { ok: false, error: 'unknown action' });
  } catch (error: any) {
    console.error('Chat function error', error);
    return json(500, { ok: false, error: error?.message || 'unexpected error' });
  }
});
