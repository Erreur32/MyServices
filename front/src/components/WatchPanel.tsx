// The « To watch » frame of a state page (Backups, Security, Services, Network): a header in the colour of its worst state (title,
// count, a hint on the right) that folds and unfolds on a click, the choice kept in this browser; the content is the page's own table.
// Nothing to watch: no frame at all.
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { FOLD_HEADER, foldHeaderProps } from "../lib/foldHeader";
import { WATCH_FRAME } from "../lib/forms";
import { tx } from "../lib/i18n";
import { useStoredFlag } from "../lib/storedFlag";
import { Badge } from "./ui";

export function WatchPanel({ id, tone, count, hint, children }: Readonly<{ id: string; tone: "ok" | "warn" | "bad"; count: number; hint: string; children: ReactNode }>) {
  const [folded, setFolded] = useStoredFlag(`myservices.watch.${id}.folded`, false);
  if (count === 0) return null;
  const Chevron = folded ? ChevronDown : ChevronUp;
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${WATCH_FRAME[tone]}`} aria-label={tx("À surveiller")}>
      <div className={`flex flex-wrap items-center gap-3 bg-bg px-4 py-3 ${folded ? "" : "border-b border-line/60"} ${FOLD_HEADER}`} {...foldHeaderProps(() => setFolded(!folded))}>
        <h2 className="font-bold">{tx("À surveiller")}</h2>
        <Badge tone={tone}>{count}</Badge>
        <span className="ml-auto text-xs text-dim">{hint}</span>
        <button type="button" className="text-dim hover:text-txt" aria-expanded={!folded} onClick={() => setFolded(!folded)} title={folded ? tx("Déplier") : tx("Replier")}>
          <Chevron size={18} aria-hidden />
        </button>
      </div>
      {!folded && children}
    </section>
  );
}
