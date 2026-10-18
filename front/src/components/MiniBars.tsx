// A small bar chart: one bar per value, the tallest fills the height; the labels under the first and the last bar say what the axis is.
import { tx } from "../lib/i18n";

export function MiniBars({ values, color, label, from, to, titleOf }: Readonly<{ values: number[]; color: string; label: string; from: string; to: string; titleOf: (i: number, n: number) => string }>) {
  const max = Math.max(1, ...values);
  return (
    <div>
      <div className="flex h-14 items-end gap-0.5" role="img" aria-label={label}>
        {values.map((n, i) => (
          <span key={i} title={titleOf(i, n)} className={`flex-1 rounded-sm ${n ? color : "bg-line/60"}`} style={{ height: n ? `${Math.max(14, (n / max) * 100)}%` : "6%" }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-dim"><span>{from}</span><span>{tx("max {0}", max)}</span><span>{to}</span></div>
    </div>
  );
}
