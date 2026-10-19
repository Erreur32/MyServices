// One figure of a state page (Backups, Security): a caption, the number in the colour of its state, a fact under it. Same tile on every page.
const COLOR = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

export function StatTile({ n, label, sub, tone }: Readonly<{ n: string | number; label: string; sub?: string; tone?: "ok" | "warn" | "bad" }>) {
  return (
    <div className="min-w-[8rem] flex-1 rounded-xl border border-line bg-card px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`font-mono text-xl font-bold ${tone ? COLOR[tone] : ""}`}>{n}</div>
      {sub && <div className="truncate text-xs text-dim" title={sub}>{sub}</div>}
    </div>
  );
}
