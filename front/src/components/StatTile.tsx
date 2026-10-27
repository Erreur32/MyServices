// One figure of a state page (Backups, Security): a caption, the number in the colour of its state, a fact under it. Same tile on every page.
import type { ReactNode } from "react";

export const COLOR = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

type TileProps = Readonly<{
  n: string | number; label: string; sub?: string; hint?: string; tone?: "ok" | "warn" | "bad"; small?: boolean; children?: ReactNode;
  aside?: ReactNode;   // right of the figure (a small curve)
  onClick?: () => void; pressed?: boolean;   // a tile that filters the list under it
}>;

export function StatTile({ n, label, sub, hint, tone, small = false, children, aside, onClick, pressed }: TileProps) {   // hint: what the figure counts, on hover   // small: a row of figures sharing its line; children: under the fact (a small curve, a time)
  const figure = <div className={`font-mono font-bold ${small ? "text-base leading-tight" : "text-xl"} ${tone ? COLOR[tone] : ""}`}>{n}</div>;
  const body = (
    <>
      <div className={`${small ? "text-[11px]" : "text-xs"} text-muted`}>{label}</div>
      {aside ? <div className="flex items-end justify-between gap-4">{figure}{aside}</div> : figure}
      {sub && <div className={`truncate ${small ? "text-[11px]" : "text-xs"} text-dim`} title={sub}>{sub}</div>}
      {children}
    </>
  );
  const frame = `flex flex-1 flex-col rounded-xl border bg-card ${small ? "min-w-[6rem] px-2 py-1.5" : "min-w-[8rem] px-3 py-2.5"}`;
  if (onClick)
    return (
      <button type="button" onClick={onClick} aria-pressed={pressed} title={hint} className={`${frame} text-left hover:border-link ${pressed ? "border-link ring-1 ring-link/50" : "border-line"}`}>{body}</button>
    );
  return <div title={hint} className={`${frame} border-line ${hint ? "cursor-help" : ""}`}>{body}</div>;
}
