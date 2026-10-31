// A framed panel with a dark header strip (icon, title, count, optional extras) that opens and closes on a click anywhere on the header, except on
// a link or a button placed in it (lib/foldHeader.ts). The state is kept in this browser; the chevron button is the way in for the keyboard.
import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { FOLD_HEADER, foldHeaderProps } from "../lib/foldHeader";
import { tx } from "../lib/i18n";
import { useStoredFlag } from "../lib/storedFlag";
import { Count } from "./ui";

export function FoldPanel({ id, icon: Icon, title, count, tone = "off", extra, center, end, startFolded = false, pinned = false, children }: Readonly<{
  id?: string;   // where the state is remembered; none: back to startFolded on each visit
  icon: LucideIcon; title: string; count?: number; tone?: "off" | "warn" | "bad" | "ok"; extra?: ReactNode; center?: ReactNode; end?: ReactNode; startFolded?: boolean; pinned?: boolean; children: ReactNode;
}>) {
  const [stored, setFolded] = useStoredFlag(id && `myservices.panel.${id}.folded`, startFolded);
  const folded = stored && !pinned;   // pinned: the panel is the page (a sub-page of the side menu), always open
  const Chevron = folded ? ChevronDown : ChevronUp;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className={`flex flex-wrap items-center gap-2 bg-bg px-4 py-3 ${center ? "md:grid md:grid-cols-[1fr_minmax(0,32rem)_1fr]" : ""} ${folded ? "" : "border-b border-line/60"} ${pinned ? "" : FOLD_HEADER}`} {...(pinned ? {} : foldHeaderProps(() => setFolded(!folded)))}>
        <div className={center ? "flex min-w-0 items-center gap-2" : "contents"}>
          <Icon size={16} className="shrink-0 text-link" aria-hidden />
          <h2 className="whitespace-nowrap font-bold">{title}</h2>
          {count != null && <Count n={count} tone={tone} />}
          {extra}
        </div>
        {center && <div className="flex min-w-0 flex-1 items-center justify-center gap-3">{center}</div>}
        {end && <div className="ml-auto md:justify-self-end">{end}</div>}
        {!pinned && (
          <button type="button" className="ml-auto text-dim hover:text-txt" aria-expanded={!folded} onClick={() => setFolded(!folded)} title={folded ? tx("Déplier") : tx("Replier")}>
            <Chevron size={18} aria-hidden />
          </button>
        )}
      </div>
      {!folded && <div className="p-4">{children}</div>}
    </section>
  );
}
