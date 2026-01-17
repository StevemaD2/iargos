
import React, { useState, useEffect } from 'react';
import { User, SubmissionType, VoterSentiment, IntentionVoto } from '../types';

interface SubmissionFormProps {
  user: User;
}

const SubmissionForm: React.FC<SubmissionFormProps> = ({ user }) => {
  const [type, setType] = useState<SubmissionType>(SubmissionType.TEXTO_RELATO);
  const [location, setLocation] = useState<GeolocationPosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  
  // Interaction fields
  const [interaction, setInteraction] = useState({
    foi_atendido: 'BEM',
    intencao_voto: IntentionVoto.EM_DUVIDA,
    sentimento: VoterSentiment.NEUTRO,
    principais_frases: '',
    observacoes: ''
  });

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(pos),
      (err) => alert("Erro: GPS obrigatório para envio de dados em campo."),
      { enableHighAccuracy: true }
    );
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) {
      alert("Aguardando precisão de GPS...");
      return;
    }
    setLoading(true);
    // Simulate API call
    setTimeout(() => {
      setLoading(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    }, 1500);
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-2xl shadow-sm border p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-indigo-100 rounded-lg text-indigo-600">
            <i className="fas fa-file-signature text-xl"></i>
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Novo Registro de Campo</h2>
            <p className="text-sm text-slate-500">Operador: {user.name} • Precisão GPS: {location ? `${location.coords.accuracy.toFixed(1)}m` : 'Buscando...'}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Tipo de Evidência</label>
              <select 
                value={type} 
                onChange={(e) => setType(e.target.value as SubmissionType)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {Object.values(SubmissionType).map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Contexto</label>
              <select className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                <option value="RUA">Presencial (Rua)</option>
                <option value="DIGITAL">Digital (Redes Sociais)</option>
                <option value="MISTO">Misto</option>
              </select>
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b pb-2 flex items-center gap-2">
              <i className="fas fa-user-check text-indigo-500"></i> Interação com Eleitor
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Intenção de Voto</label>
                <select 
                  value={interaction.intencao_voto}
                  onChange={(e) => setInteraction({...interaction, intencao_voto: e.target.value as any})}
                  className="w-full text-sm border-none bg-transparent focus:ring-0"
                >
                  {Object.values(IntentionVoto).map(v => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sentimento</label>
                <select 
                  value={interaction.sentimento}
                  onChange={(e) => setInteraction({...interaction, sentimento: e.target.value as any})}
                  className="w-full text-sm border-none bg-transparent focus:ring-0"
                >
                  {Object.values(VoterSentiment).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Frases / Citações do Eleitor</label>
              <textarea 
                placeholder="Ex: 'Prometeram e não cumpriram o asfalto...'"
                className="w-full p-3 text-sm bg-white rounded-lg border border-slate-200 focus:ring-1 focus:ring-indigo-500"
                rows={2}
                value={interaction.principais_frases}
                onChange={(e) => setInteraction({...interaction, principais_frases: e.target.value})}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Relato / Conteúdo</label>
            <textarea 
              required
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[120px]"
              placeholder="Descreva o que aconteceu ou o link da postagem..."
              value={interaction.observacoes}
              onChange={(e) => setInteraction({...interaction, observacoes: e.target.value})}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !location}
            className={`w-full py-4 rounded-xl font-bold text-white transition-all shadow-lg flex items-center justify-center gap-3 ${
              !location ? 'bg-slate-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 active:transform active:scale-95'
            }`}
          >
            {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-paper-plane"></i>}
            {success ? 'ENVIADO COM SUCESSO!' : 'SINCRONIZAR COM COMANDO'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default SubmissionForm;
