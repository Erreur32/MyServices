// Choix parmi quelques options, en boutons-icônes (plutôt qu'un menu déroulant) : une icône ou un logo, un libellé, un seul choix possible.
import type { ReactNode } from "react";

export interface IconOption<V extends string> { value: V; label: string; icon: ReactNode; hint?: string }

export function IconChoice<V extends string>({ value, options, onPick, label, disabled }: Readonly<{
  value: V; options: IconOption<V>[]; onPick: (v: V) => void; label: string; disabled?: boolean;
}>) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={disabled} title={o.hint ?? o.label} onClick={() => onPick(o.value)}
          className={`flex min-w-[6.5rem] flex-col items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors disabled:opacity-50 ${value === o.value
            ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>
          <span className="grid h-8 w-8 place-items-center">{o.icon}</span>{o.label}
        </button>
      ))}
    </div>
  );
}
