// Choix « Cartes / Tableau » d'un onglet, retenu d'une visite à l'autre (une clé de stockage par onglet).
import { LayoutGrid, Table2 } from "lucide-react";
import { useState } from "react";
import { tx } from "../lib/i18n";
import { ChipButton } from "./ui";

export type View = "cards" | "table";

export function useStoredView(key: string, fallback: View): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => { try { const v = localStorage.getItem(key); return v === "cards" || v === "table" ? v : fallback; } catch { return fallback; } });
  const pick = (v: View) => { setView(v); try { localStorage.setItem(key, v); } catch { /* stockage refusé : le choix ne dure que cette visite */ } };
  return [view, pick];
}

export function ViewToggle({ view, onPick }: Readonly<{ view: View; onPick: (v: View) => void }>) {
  return (
    <fieldset className="m-0 inline-flex gap-1.5 border-0 p-0" aria-label={tx("Affichage")}>
      {([["cards", tx("Cartes"), LayoutGrid], ["table", tx("Tableau"), Table2]] as const).map(([k, l, Icon]) => (
        <ChipButton key={k} on={view === k} mark={<Icon size={14} aria-hidden />} label={l} onClick={() => onPick(k)} />
      ))}
    </fieldset>
  );
}
