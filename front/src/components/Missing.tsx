// Home page (administrator), « Il manque »: sources not plugged in that would unlock a page or a follow-up. Each line leads to the settings
// section that fixes it. The number of notification channels is read once (alerts), the line waits for it.
import { ArrowRight, PlugZap } from "lucide-react";
import { useEffect, useState } from "react";
import { read, type Snapshot } from "../api";
import { tx } from "../lib/i18n";
import { missing } from "../lib/missing";
import type { AlertsState } from "../types";
import { InfoNote } from "./InfoNote";
import { Rich } from "./Rich";

const GO = "group/go inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-bg2/60 px-2.5 py-1 text-xs font-semibold text-muted no-underline transition-colors hover:border-link hover:bg-link/10 hover:text-link";

export function Missing({ snap }: Readonly<{ snap: Snapshot }>) {
  const [channels, setChannels] = useState<number | null>(null);
  useEffect(() => {
    read<AlertsState>("alerts").then((a) => setChannels(a.channels.length)).catch(() => setChannels(null));
  }, []);
  const items = missing(snap, channels);
  if (!items.length) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card/70 shadow-sm" aria-label={tx("Il manque")}>
      <div className="flex items-center gap-3 border-b border-line/60 bg-bg px-5 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-link/10 text-link"><PlugZap size={18} strokeWidth={1.75} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">{tx("Il manque")}</h2>
          <InfoNote>{tx("Ces sources débloqueraient une page ou un suivi. Rien d'obligatoire.")}</InfoNote>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-line/50 px-5 py-1 text-sm">
        {items.map((it) => (
          <li key={it.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
            <span className="min-w-0 flex-1 text-muted"><Rich text={it.text} /></span>
            <a href={`#${it.href}`} className={GO}>{it.action}<ArrowRight size={13} className="transition-transform group-hover/go:translate-x-0.5" aria-hidden /></a>
          </li>
        ))}
      </ul>
    </section>
  );
}
