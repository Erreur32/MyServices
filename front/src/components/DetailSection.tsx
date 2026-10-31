// A section of the page of a machine: a plain card (it sits in a column of cards, never cut in two), a title with
// its icon in the colour of the section and, on the right, where its data come from; then « label / value » lines, the value never cut.
import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { TONES } from "../lib/tones";

export function DetailSection({ icon: Icon, title, tone, right, sec, children }: Readonly<{ sec?: string; icon?: LucideIcon; title: string; tone: keyof typeof TONES; right?: ReactNode; children: ReactNode }>) {
  return (
    <section data-sec={sec} className="mb-3 flex min-w-0 break-inside-avoid flex-col overflow-hidden rounded-xl border border-line bg-card text-sm shadow-sm">
      <h3 className="flex flex-wrap items-center gap-2 border-b border-line/60 bg-bg px-3 py-2 font-semibold">
        {Icon && <Icon size={16} aria-hidden className={TONES[tone].icon} />}{title}{right && <span className="ml-auto text-xs font-normal">{right}</span>}
      </h3>
      <dl className="flex flex-col gap-1 p-3">{children}</dl>
    </section>
  );
}

/** A « label / value » line; nothing when the value is empty. The value wraps (long paths, keys) instead of being cut;
 *  `wide`: a table of its own, the label above it and the table across the whole card */
export function DetailRow({ k, title, watch, wide = false, children }: Readonly<{ k: string; title?: string; watch?: string; wide?: boolean; children?: ReactNode }>) {
  if (children === undefined || children === null || children === false || children === "") return null;
  return (
    <div data-watch={watch} className={`grid gap-x-3 rounded-md py-0.5 ${wide ? "grid-cols-1 gap-y-1" : "grid-cols-[6.5rem_minmax(0,1fr)]"}`}>
      <dt className="text-muted" title={title}>{k}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** The long part of a section, folded under one line at its foot: the section keeps its height, nothing is lost */
export function DetailMore({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <details className="group -mx-3 border-t border-line/60 last:-mb-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-link hover:bg-bg2/60 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={13} className="transition-transform group-open:rotate-90" aria-hidden />{label}
      </summary>
      <div className="flex flex-col gap-1 px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}
