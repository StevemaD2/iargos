
import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { User, UserRole, Submission } from './types';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import SubmissionForm from './components/SubmissionForm';
import QRScanner from './components/QRScanner';
import QRGenerator from './components/QRGenerator';
import LeaderFeed from './components/LeaderFeed';
import Sidebar from './components/Sidebar';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('iargos_user');
    return saved ? JSON.parse(saved) : null;
  });

  const handleLogin = (newUser: User) => {
    setUser(newUser);
    localStorage.setItem('iargos_user', JSON.stringify(newUser));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('iargos_user');
  };

  return (
    <Router>
      <div className="flex min-h-screen bg-slate-50">
        {user && <Sidebar user={user} onLogout={handleLogout} />}
        <main className="flex-1 overflow-y-auto">
          <Routes>
            {!user ? (
              <>
                <Route path="/login" element={<Login onLogin={handleLogin} />} />
                <Route path="*" element={<Navigate to="/login" />} />
              </>
            ) : (
              <>
                <Route path="/" element={<Dashboard user={user} />} />
                <Route path="/report" element={<SubmissionForm user={user} />} />
                <Route path="/onboard" element={<QRScanner user={user} />} />
                <Route path="/team" element={<QRGenerator user={user} />} />
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
