
import React from 'react';
import { User, Submission, SubmissionType, VoterSentiment } from '../types';

interface LeaderFeedProps {
  user: User;
}

const LeaderFeed: React.FC<LeaderFeedProps> = ({ user }) => {
  // Mock feed data
  const feed: Submission[] = [
    {
      id: '1',
      userId: 's1',
      userName: 'Carlos Soldado',
      leaderChain: [],
      type: SubmissionType.AUDIO_ELEITOR,
      timestamp: '2023-10-27T10:00:00Z',
      geo: { lat: 0, lng: 0, accuracy: 0 },
      locationDetails: { bairro: 'Jardins', cidade: 'São Paulo', uf: 'SP' },
      context: 'RUA',
      content: 'Gravação de áudio do eleitor sobre falta de creches.',
      voterInteraction: {
        foi_atendido: 'BEM',
        intencao_voto: 'JA_TEM_CANDIDATO' as any,
        temas_mencionados: ['Educação'],
        sentimento: VoterSentiment.NEUTRO,
        principais_frases: 'As creches estão lotadas.',
        objecoes: [],
        oportunidades: [],
        urgencia_followup: 'MEDIA',
        observacoes: ''
      }
    },
    {
      id: '2',
      userId: 's2',
      userName: 'Ana Soldada',
      leaderChain: [],
      type: SubmissionType.OCORRENCIA,
      timestamp: '2023-10-27T10:15:00Z',
      geo: { lat: 0, lng: 0, accuracy: 0 },
      locationDetails: { bairro: 'Periferia Sul', cidade: 'São Paulo', uf: 'SP' },
      context: 'RUA',
      content: 'Ameaça de oposição no posto de panfletagem.',
      voterInteraction: {
        foi_atendido: 'MAL',
        intencao_voto: 'REJEITA_NOSSO' as any,
        temas_mencionados: ['Segurança'],
        sentimento: VoterSentiment.NEGATIVO,
        principais_frases: 'Aqui vocês não entram.',
        objecoes: [],
        oportunidades: [],
        urgencia_followup: 'ALTA',
        observacoes: ''
      }
    }
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
        <i className="fas fa-tower-broadcast text-indigo-600"></i>
        Fluxo de Monitoramento
      </h2>

      <div className="space-y-4">
        {feed.map(sub => (
          <div key={sub.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
            <div className="p-4 bg-slate-50 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center font-bold">
                  {sub.userName.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">{sub.userName}</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-tighter">
                    {sub.locationDetails.bairro} • {new Date(sub.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
              <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                sub.type === SubmissionType.OCORRENCIA ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-600'
              }`}>
                {sub.type.replace('_', ' ')}
              </span>
            </div>
            
            <div className="p-5">
              <p className="text-slate-700 text-sm mb-4 leading-relaxed">{sub.content}</p>
              
              {sub.voterInteraction && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Intenção</p>
                    <p className="text-xs font-semibold">{sub.voterInteraction.intencao_voto.replace('_', ' ')}</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Sentimento</p>
                    <p className={`text-xs font-bold ${
                      sub.voterInteraction.sentimento === VoterSentiment.POSITIVO ? 'text-green-600' : 
                      sub.voterInteraction.sentimento === VoterSentiment.NEGATIVO ? 'text-red-600' : 'text-slate-600'
                    }`}>
                      {sub.voterInteraction.sentimento}
                    </p>
                  </div>
                </div>
              )}

              {sub.voterInteraction?.urgencia_followup === 'ALTA' && (
                <div className="mt-4 flex items-center gap-2 text-red-600 text-xs font-bold bg-red-50 p-2 rounded border border-red-100">
                  <i className="fas fa-exclamation-triangle"></i>
                  REQUER ATENÇÃO IMEDIATA DO LÍDER
                </div>
              )}
            </div>
            
            <div className="p-3 bg-slate-50 border-t flex justify-end gap-2">
              <button className="text-xs px-3 py-1.5 font-bold text-slate-600 hover:bg-white rounded border border-transparent hover:border-slate-200 transition-all">
                Ignorar
              </button>
              <button className="text-xs px-3 py-1.5 font-bold bg-indigo-600 text-white rounded shadow-sm hover:bg-indigo-700 transition-all">
                Escalar para N2
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LeaderFeed;
