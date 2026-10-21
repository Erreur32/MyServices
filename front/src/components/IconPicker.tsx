// Choix de l'icône d'une machine : seule l'icône utilisée est affichée ; un clic ouvre le panneau (recherche + trois familles).
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { MACHINE_ICONS, chosenIcon, type ChosenIcon } from "../lib/machineIcons";
import { searchHit } from "../lib/filter";
import { tx } from "../lib/i18n";
import { input } from "../lib/forms";

const FAMILIES: [ChosenIcon["family"], string][] = [["app", tx("Applis et services")], ["system", tx("Systèmes")], ["object", tx("Objets")]];

export function IconGlyph({ icon, size = 20 }: { icon: ChosenIcon; size?: number }) {
  return "file" in icon
    ? <img src={`${import.meta.env.BASE_URL}icons/${icon.file}.svg`} alt="" style={{ width: size, height: size }} />
    : <icon.Icon size={size - 3} className="text-muted" aria-hidden />;
}

export function IconPicker({ value, onPick, disabled, autoHint, auto }: {
  value?: string | null; onPick: (key: string | undefined) => void; disabled?: boolean; autoHint: string;
  /** aperçu de l'icône automatique (celle que la détection choisit), montré tant qu'aucune icône n'est choisie */
  auto?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false), [q, setQ] = useState("");
  const current = chosenIcon(value);
  const shown = useMemo(() => MACHINE_ICONS.filter((i) => searchHit(`${i.label} ${i.key}`, q)), [q]);
  const pick = (key?: string) => { onPick(key); setOpen(false); setQ(""); };
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} disabled={disabled} title={tx("Changer l'icône")}
        className="inline-flex items-center gap-2.5 rounded-lg border border-line bg-bg2/60 py-1.5 pl-2 pr-2.5 text-sm hover:border-link disabled:opacity-60">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-card">{current ? <IconGlyph icon={current} size={22} /> : auto ?? <span className="text-xs font-semibold text-dim">{tx("Auto")}</span>}</span>
        <span className="flex flex-col items-start leading-tight"><b className="font-semibold">{current ? current.label : tx("Automatique")}</b>
          <span className="text-xs text-dim">{current ? tx("choisie à la main") : autoHint}</span></span>
        <ChevronDown size={14} className={`text-dim transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line bg-card p-3 shadow-lg shadow-black/20">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input className={`${input} w-56`} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Chercher : Debian, NAS, caméra…")} aria-label={tx("Chercher une icône")} />
            <button type="button" onClick={() => pick(undefined)} aria-pressed={!value}
              className={`inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold ${!value ? "border-link bg-link/15 text-txt" : "border-line text-muted hover:border-link hover:text-txt"}`}>{tx("Automatique")}</button>
            <span className="text-xs text-dim">{shown.length} {tx("icônes")}</span>
          </div>
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1" role="radiogroup" aria-label={tx("Icône de la machine")}>
            {FAMILIES.map(([fam, name]) => {
              const list = shown.filter((i) => i.family === fam);
              return list.length ? (
                <div key={fam}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">{name}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((i) => (
                      <button key={i.key} type="button" role="radio" aria-checked={value === i.key} aria-label={i.label} title={i.label} onClick={() => pick(i.key)}
                        className={`grid h-9 w-9 place-items-center rounded-lg border ${value === i.key ? "border-link bg-link/15" : "border-line hover:border-link"}`}><IconGlyph icon={i} /></button>
                    ))}
                  </div>
                </div>
              ) : null;
            })}
            {shown.length === 0 && <p className="text-sm text-muted">{tx("Aucune icône pour cette recherche.")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
