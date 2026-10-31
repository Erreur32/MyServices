// Choix « Cartes / Tableau » d'un onglet, retenu d'une visite à l'autre (une clé de stockage par onglet).
import { LayoutGrid, Table2 } from "lucide-react";
import { useState } from "react";
import { tx } from "../lib/i18n";

export type View = "cards" | "table";

export function useStoredView(key: string, fallback: View): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => { try { const v = localStorage.getItem(key); return v === "cards" || v === "table" ? v : fallback; } catch { return fallback; } });
  const pick = (v: View) => { setView(v); try { localStorage.setItem(key, v); } catch { /* stockage refusé : le choix ne dure que cette visite */ } };
  return [view, pick];
}

export function ViewToggle({ view, onPick }: Readonly<{ view: View; onPick: (v: View) => void }>) {
  return (
    <span className="inline-flex rounded-lg border border-line bg-card p-0.5" role="group" aria-label={tx("Affichage")}>
      {([["cards", tx("Cartes"), LayoutGrid], ["table", tx("Tableau"), Table2]] as const).map(([k, l, Icon]) => (
        <button key={k} type="button" onClick={() => onPick(k)} aria-pressed={view === k} title={l}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${view === k ? "bg-link/15 text-txt" : "text-muted hover:text-txt"}`}><Icon size={14} aria-hidden />{l}</button>
      ))}
    </span>
  );
}
