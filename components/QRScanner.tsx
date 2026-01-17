
import React, { useState } from 'react';
import { User } from '../types';

interface QRScannerProps {
  user: User;
}

const QRScanner: React.FC<QRScannerProps> = ({ user }) => {
  const [scanning, setScanning] = useState(false);
  const [success, setSuccess] = useState(false);

  const startScan = () => {
    setScanning(true);
    // Simulation: in a real app, use a library like html5-qrcode
    setTimeout(() => {
      setScanning(false);
      setSuccess(true);
    }, 2000);
  };

  return (
    <div className="max-w-md mx-auto p-6 mt-12">
      <div className="bg-white rounded-3xl shadow-xl border p-10 text-center">
        <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <i className="fas fa-link text-2xl"></i>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Vincular Superior</h2>
        <p className="text-slate-500 mb-8 text-sm">Escaneie o código gerado pelo seu líder para ingressar na rede de comando.</p>
        
        {success ? (
          <div className="bg-green-50 border border-green-200 p-6 rounded-2xl text-green-700 animate-bounce">
            <i className="fas fa-check-circle text-3xl mb-2"></i>
            <p className="font-bold">VÍNCULO ESTABELECIDO!</p>
            <p className="text-xs">Agora você faz parte do exército territorial.</p>
          </div>
        ) : scanning ? (
          <div className="relative w-full aspect-square bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center border-4 border-indigo-500">
            <div className="absolute inset-0 bg-[url('https://picsum.photos/400/400?grayscale')] opacity-30 grayscale blur-sm"></div>
            <div className="relative z-10 text-white flex flex-col items-center">
              <div className="w-48 h-48 border-2 border-indigo-400 rounded-lg relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-indigo-400 animate-[scan_2s_infinite]"></div>
              </div>
              <p className="mt-4 text-xs font-bold tracking-widest uppercase animate-pulse">Buscando QR Code...</p>
            </div>
          </div>
        ) : (
          <button 
            onClick={startScan}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-95"
          >
            ABRIR CÂMERA DO COMANDO
          </button>
        )}

        <style>{`
          @keyframes scan {
            0% { transform: translateY(0); }
            50% { transform: translateY(192px); }
            100% { transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
};

export default QRScanner;
