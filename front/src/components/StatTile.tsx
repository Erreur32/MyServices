// One figure of a state page (Backups, Security): a caption, the number in the colour of its state, a fact under it. Same tile on every page.
import type { ReactNode } from "react";

export const COLOR = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

export function StatTile({ n, label, sub, hint, tone, small = false, children }: Readonly<{ n: string | number; label: string; sub?: string; hint?: string; tone?: "ok" | "warn" | "bad"; small?: boolean; children?: ReactNode }>) {   // hint: what the figure counts, on hover   // small: a row of figures sharing its line; children: under the fact (a small curve, a time)
  return (
    <div title={hint} className={`flex flex-1 flex-col rounded-xl border border-line bg-card ${hint ? "cursor-help" : ""} ${small ? "min-w-[6rem] px-2 py-1.5" : "min-w-[8rem] px-3 py-2.5"}`}>
      <div className={`${small ? "text-[11px]" : "text-xs"} text-muted`}>{label}</div>
      <div className={`font-mono font-bold ${small ? "text-base leading-tight" : "text-xl"} ${tone ? COLOR[tone] : ""}`}>{n}</div>
      {sub && <div className={`truncate ${small ? "text-[11px]" : "text-xs"} text-dim`} title={sub}>{sub}</div>}
      {children}
    </div>
  );
}
