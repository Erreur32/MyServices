// A card that shows the same figures as a list or as a donut chart, the way MynetworK's analytics page does: a two-button switch in the header.
import { List, PieChart } from "lucide-react";
import { useState, type ReactNode } from "react";
import { tx } from "../lib/i18n";
import { Card } from "./ui";

export interface Slice { key: string; label: string; value: number; detail?: string }

// Written out in full so that Tailwind keeps them
const SEGMENT = ["stroke-warn", "stroke-bad", "stroke-link", "stroke-ok", "stroke-npm", "stroke-apache"];
const DOT = ["bg-warn", "bg-bad", "bg-link", "bg-ok", "bg-npm", "bg-apache"];
const SHOWN = 6;   // slices drawn; the others are added up as « other »
const R = 15.915;   // circumference 100: a slice of value v out of the total is v / total * 100 long

/** The biggest slices, the rest added up into one */
export function topSlices(rows: Slice[], other: string): Slice[] {
  const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= SHOWN) return sorted;
  const rest = sorted.slice(SHOWN - 1);
  return [...sorted.slice(0, SHOWN - 1), { key: "other", label: other, value: rest.reduce((n, r) => n + r.value, 0), detail: undefined }];
}

export function Donut({ rows }: Readonly<{ rows: Slice[] }>) {
  const slices = topSlices(rows, tx("autres"));
  const total = slices.reduce((n, s) => n + s.value, 0);
  if (!total) return null;
  const arcs = slices.map((s, i) => ({ s, i, from: slices.slice(0, i).reduce((n, p) => n + p.value, 0) / total * 100, len: s.value / total * 100 }));
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg viewBox="0 0 42 42" className="h-40 w-40 shrink-0 -rotate-90" role="img" aria-label={tx("Répartition : {0} au total", total)}>
        <circle cx="21" cy="21" r={R} fill="none" className="stroke-line/60" strokeWidth="6" />
        {arcs.map(({ s, i, from, len }) => (
          <circle key={s.key} cx="21" cy="21" r={R} fill="none" className={SEGMENT[i]} strokeWidth="6" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={-from}>
            <title>{`${s.label}: ${s.value}`}</title>
          </circle>
        ))}
      </svg>
      <ul className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        {slices.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2" title={s.detail}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[i]}`} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="whitespace-nowrap text-xs text-dim"><b className="text-txt">{s.value}</b> · {Math.round((s.value / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const BTN = "inline-flex items-center rounded-md p-1.5 text-muted hover:text-txt aria-pressed:bg-link/15 aria-pressed:text-link";

/** Title, switch list / donut, and the body: `list` as it was, or the donut of `rows` */
export function ChartToggle({ title, rows, list }: Readonly<{ title: string; rows: Slice[]; list: ReactNode }>) {
  const [chart, setChart] = useState(false);
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        <span className="inline-flex gap-0.5" role="group" aria-label={tx("Affichage")}>
          <button type="button" className={BTN} aria-pressed={!chart} title={tx("Liste")} onClick={() => setChart(false)}><List size={15} aria-hidden /></button>
          <button type="button" className={BTN} aria-pressed={chart} title={tx("Camembert")} onClick={() => setChart(true)}><PieChart size={15} aria-hidden /></button>
        </span>
      </div>
      {chart ? <Donut rows={rows} /> : list}
    </Card>
  );
}
