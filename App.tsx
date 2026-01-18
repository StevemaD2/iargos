
import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { User, UserRole, Submission } from './types';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import SubmissionForm from './components/SubmissionForm';
import QRScanner from './components/QRScanner';
import LeaderFeed from './components/LeaderFeed';
import Sidebar from './components/Sidebar';
import { requestCurrentLocation } from './services/locationService';
import { recordMemberTimesheetEvent } from './services/memberActivityService';
import CandidateShare from './components/CandidateShare';

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

  return (
    <Router>
      <div className="flex min-h-screen" style={{ backgroundColor: 'var(--iargos-brand-secondary)' }}>
        {user && <Sidebar user={user} onLogout={handleLogout} />}
        <main className="flex-1 overflow-y-auto bg-slate-50">
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
                <Route path="/eleitores" element={<Dashboard user={user} view="VOTERS" />} />
                <Route path="/report" element={<SubmissionForm user={user} />} />
                <Route path="/onboard" element={<QRScanner user={user} />} />
                <Route path="/feed" element={<LeaderFeed user={user} />} />
                <Route path="*" element={<Navigate to="/" />} />
              </>
            )}
          </Routes>
        </main>
      </div>
    </Router>
  );
};

export default App;
