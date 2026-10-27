// The period of the history drawn in the figure tiles (24 h, 72 h, 7 days): one choice for the whole row, kept by this browser.
import { useState } from "react";
import { PERIODS, type Period } from "../lib/tileHistory";
import { tx } from "../lib/i18n";

const KEY = "ms.tiles.hours";

export const periodLabel = (h: Period) => (h === 168 ? tx("7 j") : `${h} h`);

function saved(): Period {
  try {
    const v = Number(localStorage.getItem(KEY));
    return PERIODS.find((p) => p === v) ?? 24;
  } catch { return 24; }
}

/** The period chosen, and how to change it (kept by this browser) */
export function usePeriod(): [Period, (p: Period) => void] {
  const [period, setPeriod] = useState<Period>(saved);
  const choose = (p: Period) => {
    setPeriod(p);
    try { localStorage.setItem(KEY, String(p)); } catch { /* storage refused: the choice lasts this visit */ }
  };
  return [period, choose];
}

export function PeriodSwitch({ value, onChange }: Readonly<{ value: Period; onChange: (p: Period) => void }>) {
  return (
    <fieldset className="m-0 inline-flex min-w-0 overflow-hidden rounded-lg border border-line bg-card p-0 text-xs">
      <legend className="sr-only">{tx("Période des cadres")}</legend>
      {PERIODS.map((p) => (
        <button key={p} type="button" aria-pressed={p === value} onClick={() => onChange(p)}
          className={`px-3 py-1 ${p === value ? "bg-link/15 font-semibold text-link" : "text-muted hover:text-txt"}`}>{periodLabel(p)}</button>
      ))}
    </fieldset>
  );
}
