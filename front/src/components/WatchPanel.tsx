// The « To watch » frame of a state page (Backups, Security, Services, Network): a header in the colour of its worst state (title,
// count, a hint on the right) that folds and unfolds on a click, the choice kept in this browser; the content is the page's own table.
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { FOLD_HEADER, foldHeaderProps } from "../lib/foldHeader";
import { WATCH_FRAME } from "../lib/forms";
import { tx } from "../lib/i18n";
import { useStoredFlag } from "../lib/storedFlag";
import { Badge } from "./ui";

export function WatchPanel({ id, tone, count, hint, children }: Readonly<{ id: string; tone: "ok" | "warn" | "bad"; count: number; hint: string; children: ReactNode }>) {
  const [stored, setFolded] = useStoredFlag(`myservices.watch.${id}.folded`, false);
  const empty = count === 0;   // nothing to watch: a green zero, the frame stays shut (nothing to unfold), no alert colour
  const folded = empty || stored, shown = empty ? "ok" : tone;
  const Chevron = folded ? ChevronDown : ChevronUp;
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${WATCH_FRAME[shown]}`} aria-label={tx("À surveiller")}>
      <div className={`flex flex-wrap items-center gap-3 bg-bg px-4 py-3 ${folded ? "" : "border-b border-line/60"} ${empty ? "" : FOLD_HEADER}`} {...(empty ? {} : foldHeaderProps(() => setFolded(!stored)))}>
        <h2 className="font-bold">{tx("À surveiller")}</h2>
        <Badge tone={shown}>{count}</Badge>
        <span className="ml-auto text-xs text-dim">{empty ? tx("rien à signaler") : hint}</span>
        {!empty && (
          <button type="button" className="text-dim hover:text-txt" aria-expanded={!folded} onClick={() => setFolded(!stored)} title={folded ? tx("Déplier") : tx("Replier")}>
            <Chevron size={18} aria-hidden />
          </button>
        )}
      </div>
      {!folded && children}
    </section>
  );
}
