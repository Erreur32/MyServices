// A short explanation that is not part of the page's data: an icon in front, a tinted band with a coloured edge, so it reads as a hint
// and not as one more line of content. `warn` is for a caution (something is lost, locked out or sensitive): it stays. A hint carries a cross
// that hides it in this browser (lib/hints.ts); Appearance shows them all again.
import { Info, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { hideHint, hintId, textOf, useHints } from "../lib/hints";
import { tx } from "../lib/i18n";

const LOOK = {
  info: { box: "border-link/40 bg-link/5", edge: "border-l-link", icon: "text-link" },
  warn: { box: "border-warn/40 bg-warn/5", edge: "border-l-warn", icon: "text-warn" },
} as const;

export function InfoNote({ children, tone = "info", className = "" }: Readonly<{ children: ReactNode; tone?: keyof typeof LOOK; className?: string }>) {
  const look = LOOK[tone], Icon = tone === "warn" ? TriangleAlert : Info;
  const id = hintId(textOf(children));
  const { hidden } = useHints(id);
  if (tone === "info" && hidden) return null;
  return (
    <div role="note" className={`flex items-start gap-2 rounded-lg border border-l-4 px-3 py-2 text-xs leading-relaxed text-muted ${look.box} ${look.edge} ${className}`}>
      <Icon size={14} className={`mt-0.5 shrink-0 ${look.icon}`} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {tone === "info" && (
        <button type="button" onClick={() => hideHint(id)} aria-label={tx("Masquer cette note")} title={tx("Masquer cette note")} className="-mr-1 shrink-0 rounded p-0.5 text-dim hover:text-txt">
          <X size={13} aria-hidden />
        </button>
      )}
    </div>
  );
}
