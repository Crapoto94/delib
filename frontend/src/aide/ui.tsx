import { ReactNode } from 'react';
import { AlertTriangle, Info, Lightbulb, ShieldAlert, type LucideIcon } from 'lucide-react';

export type Acces = 'tous' | 'scc' | 'admin';

export type Section = { id: string; titre: string; bloc: ReactNode };

export type Article = {
  code: string;
  titre: string;
  resume: string;
  Icone: LucideIcon;
  acces: Acces;
  intro: ReactNode;
  sections: Section[];
};

export const Intro = ({ children }: { children: ReactNode }) => <p className="mb-4 text-[15px] leading-relaxed text-slate-700">{children}</p>;

export const P = ({ children }: { children: ReactNode }) => <p className="mb-3 leading-relaxed text-slate-700">{children}</p>;

export const Liste = ({ children, numerotee }: { children: ReactNode; numerotee?: boolean }) => (
  <ul className={`mb-4 space-y-1.5 pl-5 leading-relaxed text-slate-700 ${numerotee ? 'list-decimal' : 'list-disc'}`}>{children}</ul>
);

export const Li = ({ children }: { children: ReactNode }) => <li>{children}</li>;

export const SousTitre = ({ children }: { children: ReactNode }) => <h3 className="mb-2 mt-5">{children}</h3>;

export const Procedure = ({ children }: { children: ReactNode }) => <ol className="mb-4 space-y-3">{children}</ol>;

export function Etape({ n, titre, children }: { n: number; titre: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white">{n}</span>
      <div>
        <div className="font-semibold text-slate-800">{titre}</div>
        {children && <div className="mt-0.5 text-[13px] leading-relaxed text-slate-600">{children}</div>}
      </div>
    </li>
  );
}

const TONS: Record<string, { box: string; titre: string; Icone: LucideIcon }> = {
  info: { box: 'border-action/30 bg-action/5', titre: 'text-action', Icone: Info },
  astuce: { box: 'border-ok/30 bg-ok-bg', titre: 'text-ok-text', Icone: Lightbulb },
  attention: { box: 'border-warn/30 bg-warn-bg', titre: 'text-warn', Icone: AlertTriangle },
  danger: { box: 'border-ko/30 bg-ko-bg', titre: 'text-ko', Icone: ShieldAlert },
};

export function Encadre({ type = 'info', titre, children }: { type?: 'info' | 'astuce' | 'attention' | 'danger'; titre: string; children: ReactNode }) {
  const t = TONS[type];
  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 ${t.box}`}>
      <div className={`mb-1 flex items-center gap-2 text-[13px] font-bold ${t.titre}`}><t.Icone className="h-4 w-4 shrink-0" />{titre}</div>
      <div className="text-[13px] leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

export function Schema({ legende, children }: { legende?: string; children: ReactNode }) {
  return (
    <figure className="mb-4 overflow-x-auto rounded-lg border border-line bg-slate-50 p-4">
      {children}
      {legende && <figcaption className="mt-3 text-[12px] leading-relaxed text-mute">{legende}</figcaption>}
    </figure>
  );
}

export function Flux({ etapes }: { etapes: string[] }) {
  return (
    <div className="flex flex-col gap-1 md:flex-row md:flex-wrap md:items-center">
      {etapes.map((e, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="rounded border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-primary">{e}</span>
          {i < etapes.length - 1 && <span aria-hidden className="rotate-90 px-1 text-mute md:rotate-0">→</span>}
        </div>
      ))}
    </div>
  );
}

export function Tableau({ entetes, lignes }: { entetes: ReactNode[]; lignes: ReactNode[][] }) {
  return (
    <div className="mb-4 overflow-x-auto rounded-lg border border-line">
      <table className="w-full">
        <thead><tr>{entetes.map((e, i) => <th key={i}>{e}</th>)}</tr></thead>
        <tbody>{lignes.map((l, i) => <tr key={i}>{l.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export const BoutonUI = ({ children }: { children: ReactNode }) => (
  <span className="whitespace-nowrap rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[12px] font-semibold text-slate-700">{children}</span>
);

export const Cle = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-slate-300 bg-slate-50 px-1 text-[12px]">{children}</kbd>;

export const Terme = ({ children }: { children: ReactNode }) => <b className="text-slate-800">{children}</b>;

export const DefListe = ({ items }: { items: [ReactNode, ReactNode][] }) => (
  <dl className="mb-4 divide-y divide-line rounded-lg border border-line">
    {items.map(([t, d], i) => (
      <div key={i} className="grid gap-1 px-4 py-3 md:grid-cols-[12rem_1fr] md:gap-4">
        <dt className="font-semibold text-slate-800">{t}</dt>
        <dd className="text-[13px] leading-relaxed text-slate-600">{d}</dd>
      </div>
    ))}
  </dl>
);
