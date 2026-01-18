
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { User, UserRole } from '../types';

interface SidebarProps {
  user: User;
  onLogout: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ user, onLogout }) => {
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Comando Central', icon: 'fa-gauge-high', roles: Object.values(UserRole) },
    { path: '/feed', label: 'Monitoramento', icon: 'fa-stream', roles: [UserRole.L3, UserRole.L2, UserRole.L1, UserRole.DIRECTOR] },
    { path: '/minha-equipe', label: 'Minha Equipe', icon: 'fa-people-line', roles: [UserRole.L3, UserRole.L2, UserRole.L1] },
    { path: '/team', label: 'Expansão de Equipe', icon: 'fa-users', roles: [UserRole.L3, UserRole.L2, UserRole.L1, UserRole.DIRECTOR] },
    { path: '/estrutura', label: 'Estrutura e Avisos', icon: 'fa-sitemap', roles: [UserRole.DIRECTOR] },
    { path: '/cronograma', label: 'Cronograma', icon: 'fa-calendar-alt', roles: [UserRole.DIRECTOR] },
    { path: '/financeiro', label: 'Controle e Financeiro', icon: 'fa-coins', roles: [UserRole.DIRECTOR] },
    { path: '/eleitores', label: 'Eleitores', icon: 'fa-person-booth', roles: [UserRole.SOLDIER, UserRole.L3, UserRole.L2, UserRole.L1, UserRole.DIRECTOR] },
    { path: '/configuracoes', label: 'Configurações', icon: 'fa-sliders', roles: [UserRole.DIRECTOR] },
    { path: '/report', label: 'Novo Registro', icon: 'fa-plus-circle', roles: [UserRole.SOLDIER, UserRole.L3] }
  ];

  const filteredItems = navItems.filter(item => item.roles.includes(user.role));

  const getCountdown = () => {
    const electionDay = new Date(new Date().getFullYear(), 9, 4); // Outubro é mês 9 (0-indexed)
    if (new Date() > electionDay) electionDay.setFullYear(electionDay.getFullYear() + 1);
    
    const diff = electionDay.getTime() - new Date().getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    const weeks = Math.floor(days / 7);
    return { days, weeks };
  };

  const { days, weeks } = getCountdown();

  return (
    <div className="w-64 bg-slate-900 text-white flex flex-col hidden md:flex shrink-0 border-r border-slate-800">
      <div className="p-6 border-b border-slate-800">
        <h1 className="text-xl font-black tracking-tight flex items-center gap-2 text-indigo-400">
          <i className="fas fa-shield-halved"></i> IARGOS
        </h1>
        <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-bold">{user.role.replace('_', ' ')}</p>
      </div>

      {/* Countdown Widget */}
      <div className="mx-4 mt-6 p-4 rounded-xl bg-indigo-600/10 border border-indigo-500/20">
        <div className="flex items-center gap-2 text-indigo-400 text-[10px] font-bold uppercase tracking-widest mb-2">
          <i className="fas fa-calendar-check"></i> Contagem Regressiva
        </div>
        <div className="text-xl font-black text-white leading-none">
          {days} <span className="text-xs font-normal text-indigo-300">dias</span>
        </div>
        <div className="text-xs text-indigo-400/80 mt-1 font-medium">
          ({weeks} semanas para a urna)
        </div>
      </div>
      
      <nav className="flex-1 p-4 space-y-1 mt-4">
        {filteredItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group ${
              location.pathname === item.path 
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' 
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <i className={`fas ${item.icon} w-5 text-center ${location.pathname === item.path ? 'text-white' : 'group-hover:text-indigo-400'}`}></i>
            <span className="font-semibold text-sm">{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-800 bg-slate-900/50 backdrop-blur">
        <div className="flex items-center gap-3 px-2 py-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center font-bold text-white shadow-inner">
            {user.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{user.name}</p>
            <p className="text-[10px] text-slate-500 truncate">Sessão Ativa</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-red-400 transition-colors text-sm font-medium"
        >
          <i className="fas fa-power-off text-xs"></i>
          <span>Encerrar Operação</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
