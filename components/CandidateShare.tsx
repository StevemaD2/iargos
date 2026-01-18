import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import SantinhoCard, { SantinhoLink } from './SantinhoCard';

type CandidateShareRecord = {
  nome?: string | null;
  estado?: string | null;
  candidate_name?: string | null;
  candidate_number?: string | null;
  candidate_party?: string | null;
  candidate_social_links?: SantinhoLink[] | null;
  candidate_other_links?: SantinhoLink[] | null;
  candidate_speech?: string | null;
  candidate_photo_url?: string | null;
  candidate_santinho_url?: string | null;
  candidate_highlights?: string[] | null;
  theme_primary_color?: string | null;
  theme_secondary_color?: string | null;
};

const CandidateShare: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<CandidateShareRecord | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'empty' | 'ready'>('loading');

  useEffect(() => {
    const fetchCandidate = async () => {
      if (!supabase || !slug) {
        setStatus('error');
        return;
      }
      setStatus('loading');
      const { data: operation, error } = await supabase
        .from('operacoes')
        .select(
          'nome, estado, candidate_name, candidate_number, candidate_party, candidate_social_links, candidate_speech, candidate_other_links, candidate_photo_url, candidate_highlights, candidate_santinho_url, theme_primary_color, theme_secondary_color'
        )
        .eq('slug', slug)
        .maybeSingle();

      if (error) {
        console.error('Candidate share fetch error', error);
        setStatus('error');
        return;
      }

      if (!operation) {
        setStatus('empty');
        return;
      }

      setData(operation as CandidateShareRecord);
      setStatus('ready');
    };

    fetchCandidate();
  }, [slug]);

  const socialLinks = useMemo(() => data?.candidate_social_links || [], [data]);
  const otherLinks = useMemo(() => data?.candidate_other_links || [], [data]);
  const highlights = useMemo(() => data?.candidate_highlights || [], [data]);
  const brandPrimary = data?.theme_primary_color || '#4338ca';
  const brandSecondary = data?.theme_secondary_color || '#0f172a';

  const renderContent = () => {
    if (status === 'loading') {
      return <p className="text-sm text-slate-200 animate-pulse">Carregando santinho digital...</p>;
    }
    if (status === 'error') {
      return (
        <p className="text-sm text-red-300">
          Não foi possível carregar o santinho. Verifique o link ou tente novamente mais tarde.
        </p>
      );
    }
    if (status === 'empty') {
      return <p className="text-sm text-slate-200">Nenhuma operação encontrada para este link.</p>;
    }
    if (!data) return null;

    return (
      <SantinhoCard
        name={data.candidate_name || data.nome}
        number={data.candidate_number}
        party={data.candidate_party}
        speech={data.candidate_speech}
        photoUrl={data.candidate_photo_url || data.candidate_santinho_url}
        santinhoUrl={data.candidate_santinho_url}
        highlights={highlights}
        socialLinks={socialLinks}
        otherLinks={otherLinks}
        operationName={data.nome}
        brandPrimary={brandPrimary}
        brandSecondary={brandSecondary}
      />
    );
  };

  const pageBackground =
    status === 'ready' && data
      ? `radial-gradient(circle at top, ${brandPrimary}55, ${brandSecondary})`
      : 'radial-gradient(circle at top, rgba(79,70,229,0.35), rgba(15,23,42,0.95))';

  return (
    <div
      className="min-h-screen text-white flex flex-col items-center justify-center px-4 py-10 overflow-y-auto"
      style={{ background: pageBackground }}
    >
      <div className="w-full flex flex-col items-center gap-6 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-white/70 font-semibold">Santinho digital</p>
        {renderContent()}
      </div>
    </div>
  );
};

export default CandidateShare;
