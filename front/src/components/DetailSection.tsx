// Rubrique d'un détail déplié (Machines, Services, Santé) : bande de titre colorée avec icône et, à droite, une information
// (d'où viennent les données) ; puis les lignes « libellé / valeur », la colonne des libellés sur un fond teinté.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { TONES } from "../lib/tones";

export function DetailSection({ icon: Icon, title, tone, right, children }: { icon?: LucideIcon; title: string; tone: keyof typeof TONES; right?: ReactNode; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <section className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-line/60 border-l-4 text-xs ${t.box}`}>
      <h4 className={`flex flex-wrap items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ${t.head}`}>
        {Icon && <Icon size={13} aria-hidden />}{title}{right && <span className="ml-auto">{right}</span>}
      </h4>
      <dl className="mx-3 mb-3 mt-2 flex flex-col overflow-hidden rounded-md">{children}</dl>
    </section>
  );
}

/** Une ligne « libellé / valeur » ; rien quand la valeur est vide */
export function DetailRow({ k, title, children }: { k: string; title?: string; children?: ReactNode }) {
  if (children === undefined || children === null || children === false || children === "") return null;
  return <div className="flex gap-2"><dt className="w-24 shrink-0 truncate px-2 py-1 font-semibold text-muted" title={title}>{k}</dt><dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 break-words py-1">{children}</dd></div>;
}
