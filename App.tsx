
import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { User, UserRole } from './types';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import SubmissionForm from './components/SubmissionForm';
import LeaderFeed from './components/LeaderFeed';
import Sidebar from './components/Sidebar';
import { requestCurrentLocation } from './services/locationService';
import { recordMemberTimesheetEvent, updateMemberLastLocation } from './services/memberActivityService';
import CandidateShare from './components/CandidateShare';
import ChatPage from './components/ChatPage';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('iargos_user');
    return saved ? JSON.parse(saved) : null;
  });

  const handleLogin = (newUser: User) => {
    setUser(newUser);
    localStorage.setItem('iargos_user', JSON.stringify(newUser));
  };

  const handleLogout = async () => {
    const currentUser = user;
    if (currentUser && currentUser.role !== UserRole.DIRECTOR) {
      try {
        const location = await requestCurrentLocation().catch(() => null);
        await recordMemberTimesheetEvent(currentUser.id, 'LOGOUT', location);
        await updateMemberLastLocation(currentUser.id, location, new Date().toISOString());
      } catch (error) {
        console.warn('Falha ao registrar saída do membro', error);
      }
    }
    setUser(null);
    localStorage.removeItem('iargos_user');
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (!root.style.getPropertyValue('--iargos-brand-primary')) {
      root.style.setProperty('--iargos-brand-primary', '#4338ca');
    }
    if (!root.style.getPropertyValue('--iargos-brand-secondary')) {
      root.style.setProperty('--iargos-brand-secondary', '#0f172a');
    }
  }, []);

  useEffect(() => {
    if (!user || user.role === UserRole.DIRECTOR) return;
    let timer: number | null = null;

    const shouldPing = () => {
      try {
        const value = localStorage.getItem('iargos_last_location_ping');
        if (!value) return true;
        const last = Date.parse(value);
        if (Number.isNaN(last)) return true;
        return Date.now() - last >= 30 * 60 * 1000;
      } catch {
        return true;
      }
    };

    const pingIfNeeded = async () => {
      if (!shouldPing()) return;
      try {
        const location = await requestCurrentLocation().catch(() => null);
        await updateMemberLastLocation(user.id, location, new Date().toISOString());
      } catch (error) {
        console.warn('Falha ao atualizar localização periódica', error);
      }
    };

    pingIfNeeded();
    timer = window.setInterval(pingIfNeeded, 5 * 60 * 1000);

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [user]);

  const MainContent: React.FC = () => {
    const location = useLocation();
    const isChat = location.pathname === '/chat';
    return (
      <main className={`h-full min-h-0 bg-slate-50 ${isChat ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        <Routes>
          <Route path="/santinho/:slug" element={<CandidateShare />} />
          {!user ? (
            <>
              <Route path="/" element={<Login onLogin={handleLogin} initialMode="connect" lockMode />} />
              <Route path="/diretor" element={<Login onLogin={handleLogin} initialMode="director" lockMode />} />
              <Route path="/login" element={<Navigate to="/" />} />
              <Route path="*" element={<Navigate to="/" />} />
            </>
          ) : (
            <>
              <Route path="/" element={<Dashboard user={user} view="COMMAND" />} />
              <Route path="/estrutura" element={<Dashboard user={user} view="STRUCTURE" />} />
              <Route path="/cronograma" element={<Dashboard user={user} view="CRONOGRAMA" />} />
              <Route path="/configuracoes" element={<Dashboard user={user} view="SETTINGS" />} />
              <Route path="/financeiro" element={<Dashboard user={user} view="FINANCE" />} />
              <Route path="/team" element={<Dashboard user={user} view="TEAM" />} />
              <Route path="/minha-equipe" element={<Dashboard user={user} view="LEADER_TEAM" />} />
              <Route path="/eleitores" element={<Dashboard user={user} view="VOTERS" />} />
              <Route path="/report" element={<SubmissionForm user={user} />} />
              <Route path="/feed" element={<LeaderFeed user={user} />} />
              <Route path="/chat" element={<ChatPage user={user} />} />
              <Route path="*" element={<Navigate to="/" />} />
            </>
          )}
        </Routes>
      </main>
    );
  };

  return (
    <Router>
      <div className="flex h-screen" style={{ backgroundColor: 'var(--iargos-brand-secondary)' }}>
        {user && <Sidebar user={user} onLogout={handleLogout} />}
        <div className="flex-1 min-h-0">
          <MainContent />
        </div>
      </div>
    </Router>
  );
};

export default App;
