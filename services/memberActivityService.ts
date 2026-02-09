import { supabase } from './supabaseClient';
import { GeoPoint } from './locationService';

export type TimesheetSession = {
  loginAt: string;
  loginLocation: GeoPoint | null;
  logoutAt?: string;
  logoutLocation?: GeoPoint | null;
};

export type TimesheetDay = {
  date: string;
  sessions: TimesheetSession[];
};

export type TimesheetData = {
  days: TimesheetDay[];
};

export const normalizeTimesheet = (value: any): TimesheetData => {
  if (!value || typeof value !== 'object') {
    return { days: [] };
  }
  const days = Array.isArray(value.days) ? value.days : [];
  return {
    days: days
      .map((day: any) => ({
        date: typeof day?.date === 'string' ? day.date : '',
        sessions: Array.isArray(day?.sessions)
          ? day.sessions.map((session: any) => ({
              loginAt: typeof session?.loginAt === 'string' ? session.loginAt : '',
              loginLocation: session?.loginLocation || null,
              logoutAt: typeof session?.logoutAt === 'string' ? session.logoutAt : undefined,
              logoutLocation: session?.logoutLocation || null
            }))
          : []
      }))
      .filter((day: TimesheetDay) => Boolean(day.date))
  };
};

const ensureDayEntry = (timesheet: TimesheetData, dateKey: string): TimesheetDay => {
  let dayEntry = timesheet.days.find((day) => day.date === dateKey);
  if (!dayEntry) {
    dayEntry = { date: dateKey, sessions: [] };
    timesheet.days.push(dayEntry);
  }
  return dayEntry;
};

export const recordMemberTimesheetEvent = async (
  memberId: string,
  action: 'LOGIN' | 'LOGOUT',
  location: GeoPoint | null
) => {
  if (!memberId || !supabase) return;

  const { data, error } = await supabase.from('membros').select('folhaponto').eq('id', memberId).maybeSingle();
  if (error) throw error;

  const timesheet = normalizeTimesheet(data?.folhaponto);
  const now = new Date();
  const nowIso = now.toISOString();
  const dateKey = nowIso.slice(0, 10);
  const dayEntry = ensureDayEntry(timesheet, dateKey);

  if (action === 'LOGIN') {
    dayEntry.sessions.push({
      loginAt: nowIso,
      loginLocation: location
    });
  } else {
    const openSession = [...dayEntry.sessions].reverse().find((session) => !session.logoutAt);
    if (openSession) {
      openSession.logoutAt = nowIso;
      openSession.logoutLocation = location;
    } else {
      dayEntry.sessions.push({
        loginAt: nowIso,
        loginLocation: null,
        logoutAt: nowIso,
        logoutLocation: location
      });
    }
  }

  const { error: updateError } = await supabase.from('membros').update({ folhaponto: timesheet }).eq('id', memberId);
  if (updateError) throw updateError;
};

export const updateMemberDailyRate = async (memberId: string, value: number | null) => {
  if (!memberId || !supabase) return;
  const { error } = await supabase.from('membros').update({ valordiaria: value }).eq('id', memberId);
  if (error) throw error;
};

export const updateMemberLastLocation = async (
  memberId: string,
  location: GeoPoint | null,
  timestamp?: string
) => {
  if (!memberId || !supabase || !location) return;
  const resolvedTimestamp = timestamp || new Date().toISOString();
  const payload = {
    last_location: {
      lat: location.lat,
      lng: location.lng,
      accuracy: (location as any).accuracy
    },
    last_location_at: resolvedTimestamp
  };
  const { error } = await supabase.from('membros').update(payload).eq('id', memberId);
  if (error) throw error;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('iargos_last_location_ping', resolvedTimestamp);
    } catch {
      // ignore storage failures
    }
  }
};
