// A framed panel with a dark header strip (icon, title, count, optional extras) that opens and closes on a click anywhere on the header, except on
// a link or a button placed in it (lib/foldHeader.ts). The state is kept in this browser; the chevron button is the way in for the keyboard.
import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { FOLD_HEADER, foldHeaderProps } from "../lib/foldHeader";
import { tx } from "../lib/i18n";
import { useStoredFlag } from "../lib/storedFlag";
import { Count } from "./ui";

export function FoldPanel({ id, icon: Icon, title, count, tone = "off", extra, startFolded = false, children }: Readonly<{
  id: string; icon: LucideIcon; title: string; count?: number; tone?: "off" | "warn" | "bad" | "ok"; extra?: ReactNode; startFolded?: boolean; children: ReactNode;
}>) {
  const [folded, setFolded] = useStoredFlag(`myservices.panel.${id}.folded`, startFolded);
  const Chevron = folded ? ChevronDown : ChevronUp;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className={`flex flex-wrap items-center gap-2 bg-bg px-4 py-3 ${folded ? "" : "border-b border-line/60"} ${FOLD_HEADER}`} {...foldHeaderProps(() => setFolded(!folded))}>
        <Icon size={16} className="text-link" aria-hidden />
        <h2 className="font-bold">{title}</h2>
        {count != null && <Count n={count} tone={tone} />}
        {extra}
        <button type="button" className="ml-auto text-dim hover:text-txt" aria-expanded={!folded} onClick={() => setFolded(!folded)} title={folded ? tx("Déplier") : tx("Replier")}>
          <Chevron size={18} aria-hidden />
        </button>
      </div>
      {!folded && <div className="p-4">{children}</div>}
    </section>
  );
}
