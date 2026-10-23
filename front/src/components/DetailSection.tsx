// A section of the page of a machine: a plain card (it sits in a two-column wall of cards, never cut across two columns), a title with
// its icon in the colour of the section and, on the right, where its data come from; then « label / value » lines, the value never cut.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { TONES } from "../lib/tones";

export function DetailSection({ icon: Icon, title, tone, right, sec, children }: { sec?: string; icon?: LucideIcon; title: string; tone: keyof typeof TONES; right?: ReactNode; children: ReactNode }) {
  return (
    <section data-sec={sec} className="mb-4 flex min-w-0 break-inside-avoid flex-col overflow-hidden rounded-xl border border-line bg-card text-sm shadow-sm">
      <h3 className="flex flex-wrap items-center gap-2 border-b border-line/60 bg-bg px-4 py-2.5 text-[15px] font-semibold">
        {Icon && <Icon size={16} aria-hidden className={TONES[tone].icon} />}{title}{right && <span className="ml-auto text-xs font-normal">{right}</span>}
      </h3>
      <dl className="flex flex-col gap-1 px-4 py-3">{children}</dl>
    </section>
  );
}

/** A « label / value » line; nothing when the value is empty. The value wraps (long paths, keys) instead of being cut;
 *  `wide`: a table of its own, the label above it and the table across the whole card */
export function DetailRow({ k, title, watch, wide = false, children }: { k: string; title?: string; watch?: string; wide?: boolean; children?: ReactNode }) {
  if (children === undefined || children === null || children === false || children === "") return null;
  return (
    <div data-watch={watch} className={`grid gap-x-3 rounded-md py-0.5 ${wide ? "grid-cols-1 gap-y-1" : "grid-cols-[9.5rem_minmax(0,1fr)]"}`}>
      <dt className="text-muted" title={title}>{k}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
