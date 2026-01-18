import React from 'react';

export type SantinhoLink = { label?: string | null; url: string };

export interface SantinhoCardProps {
  name?: string | null;
  number?: string | null;
  party?: string | null;
  speech?: string | null;
  photoUrl?: string | null;
  santinhoUrl?: string | null;
  highlights?: string[] | null;
  socialLinks?: SantinhoLink[] | null;
  otherLinks?: SantinhoLink[] | null;
  operationName?: string | null;
  brandPrimary: string;
  brandSecondary: string;
}

const SantinhoCard: React.FC<SantinhoCardProps> = ({
  name,
  number,
  party,
  speech,
  photoUrl,
  santinhoUrl,
  highlights,
  socialLinks,
  otherLinks,
  operationName,
  brandPrimary,
  brandSecondary
}) => {
  const formattedSocial = (socialLinks || []).filter((link) => Boolean(link?.url?.trim()));
  const formattedExtras = (otherLinks || []).filter((link) => Boolean(link?.url?.trim()));
  const listHighlights = (highlights || []).filter(Boolean);
  const heroStyle: React.CSSProperties = photoUrl
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.8)), url(${photoUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }
    : {
        backgroundImage: `linear-gradient(180deg, ${brandPrimary}, ${brandSecondary})`
      };

  return (
    <div
      className="w-full max-w-sm rounded-[36px] shadow-2xl overflow-hidden bg-white flex flex-col"
      style={{ border: `8px solid ${brandPrimary}` }}
    >
      <div className="relative min-h-[360px] sm:min-h-[420px]" style={heroStyle}>
        <div className="absolute inset-0 flex flex-col justify-between p-5">
          {name && (
            <span className="inline-flex max-w-full px-4 py-2 rounded-2xl bg-black/45 text-white text-3xl font-black tracking-tight leading-tight">
              {name}
            </span>
          )}
          <div className="flex flex-col gap-2 items-start">
            {party && (
              <span className="inline-block px-3 py-1 rounded-full bg-black/40 text-white text-xs font-semibold uppercase tracking-widest">
                {party}
              </span>
            )}
            {number && (
              <div className="px-4 py-2 rounded-2xl bg-black/65">
                <p className="text-6xl sm:text-7xl font-black text-white tracking-tight leading-none">{number}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5 flex-1 bg-white">
        {speech && (
          <div>
            <p className="text-[11px] uppercase font-bold text-slate-400 tracking-widest mb-1">Discurso</p>
            <p className="text-sm text-slate-700 leading-relaxed">{speech}</p>
          </div>
        )}

        {listHighlights.length > 0 && (
          <div>
            <p className="text-[11px] uppercase font-bold text-slate-400 tracking-widest mb-1">Feitos importantes</p>
            <ul className="space-y-1 text-sm text-slate-600">
              {listHighlights.map((highlight, index) => (
                <li key={`santinho-highlight-${index}`} className="flex items-start gap-2">
                  <span className="mt-1 text-slate-400">•</span>
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {formattedSocial.length > 0 && (
          <div>
            <p className="text-[11px] uppercase font-bold text-slate-400 tracking-widest mb-2">Redes oficiais</p>
            <div className="flex flex-wrap gap-2">
              {formattedSocial.map((link, index) => (
                <a
                  key={`social-${index}`}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-full border border-slate-200 text-xs font-semibold text-slate-700 hover:border-slate-400"
                >
                  {link.label || link.url}
                </a>
              ))}
            </div>
          </div>
        )}

        {formattedExtras.length > 0 && (
          <div>
            <p className="text-[11px] uppercase font-bold text-slate-400 tracking-widest mb-2">Outros materiais</p>
            <div className="flex flex-col gap-2">
              {formattedExtras.map((link, index) => (
                <a
                  key={`extra-${index}`}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-slate-400"
                >
                  {link.label || link.url}
                </a>
              ))}
            </div>
          </div>
        )}

        {santinhoUrl && (
          <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50">
            <p className="text-[11px] uppercase font-bold text-slate-400 tracking-widest mb-1">Arte oficial</p>
            <a
              href={santinhoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold text-slate-700 hover:text-slate-900"
            >
              Baixar santinho digital
            </a>
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
          <span className="truncate">{operationName || name || ''}</span>
          <a
            href="https://iargoscamp.iagentes.com"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-slate-600 hover:text-slate-900"
          >
            Powered by IARGOS
          </a>
        </div>
      </div>
    </div>
  );
};

export default SantinhoCard;
