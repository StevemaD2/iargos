
import React, { useState } from 'react';
import { User, UserRole } from '../types';

interface QRGeneratorProps {
  user: User;
}

const QRGenerator: React.FC<QRGeneratorProps> = ({ user }) => {
  const [copied, setCopied] = useState(false);
  
  const inviteData = {
    leaderId: user.id,
    leaderRole: user.role,
    timestamp: Date.now(),
    expires: Date.now() + 10 * 60 * 1000,
    signature: "IARGOS-SIG-" + Math.random().toString(36).substring(7).toUpperCase()
  };

  const qrData = JSON.stringify(inviteData);
  const inviteLink = `https://iargos.app/onboard?data=${btoa(qrData)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="max-w-xl mx-auto p-6 mt-8">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 p-8 text-center text-white">
           <h2 className="text-2xl font-black tracking-tight mb-2">Expansão de Equipe</h2>
           <p className="text-slate-400 text-sm max-w-xs mx-auto">Novos subordinados entrarão no nível de comando abaixo de <b>{user.role}</b>.</p>
        </div>

        <div className="p-10 text-center">
          <div className="bg-slate-50 p-8 rounded-2xl inline-block border-4 border-indigo-50 mb-8 relative">
             <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`} alt="QR Code" className="relative z-10" />
             <div className="absolute inset-0 border-2 border-indigo-600/10 animate-pulse pointer-events-none rounded-xl"></div>
          </div>

          <div className="space-y-6">
            <div className="flex flex-col gap-3">
              <button 
                onClick={handleCopy}
                className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-3 transition-all ${
                  copied ? 'bg-green-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-800 active:scale-95'
                }`}
              >
                <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`}></i>
                {copied ? 'LINK COPIADO!' : 'COPIAR LINK DE CONVITE'}
              </button>
              
              <div className="flex items-center gap-3 py-2">
                <div className="h-px bg-slate-200 flex-1"></div>
                <span className="text-[10px] font-black text-slate-400 uppercase">Ou envie por</span>
                <div className="h-px bg-slate-200 flex-1"></div>
              </div>

              <div className="flex gap-2">
                <button className="flex-1 py-3 bg-[#25D366] text-white rounded-xl font-bold flex items-center justify-center gap-2 text-sm">
                  <i className="fab fa-whatsapp"></i> WhatsApp
                </button>
                <button className="flex-1 py-3 bg-[#0088CC] text-white rounded-xl font-bold flex items-center justify-center gap-2 text-sm">
                  <i className="fab fa-telegram"></i> Telegram
                </button>
              </div>
            </div>

            <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-left">
              <div className="flex items-center gap-2 text-amber-600 mb-1">
                 <i className="fas fa-shield-halved text-xs"></i>
                 <span className="text-[10px] font-black uppercase">Segurança de Rede</span>
              </div>
              <p className="text-[11px] text-amber-800 leading-relaxed">Este convite expira em 10 minutos. O sistema validará a assinatura eletrônica e a geolocalização do operador no momento do aceite.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRGenerator;
