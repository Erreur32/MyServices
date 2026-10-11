import { SkipForward } from "lucide-react";
import { tx } from "../lib/i18n";

/** The one "Skip" button of the app (Getting started steps, network search, machine cards): a bordered pill with an icon.
 *  `onDark`: the button sits on an already dark area (a tinted step card, a machine frame), where the usual dark fill would vanish,
 *  so it gets a lighter fill and a stronger edge to stay readable. `label` replaces the word (e.g. "Terminé"). */
export function SkipButton({ onClick, title, onDark = false, label, className = "" }: { onClick: () => void; title?: string; onDark?: boolean; label?: string; className?: string }) {
  const look = onDark
    ? "border-txt/70 bg-txt/10 text-txt hover:border-link hover:bg-link/20 hover:text-link"
    : "border-txt/50 bg-bg2 text-txt hover:border-link hover:bg-link/10 hover:text-link";
  return (
    <button type="button" onClick={onClick} title={title ?? tx("Passer cette étape : vous pourrez la refaire plus tard, ici ou dans les Réglages")}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold shadow-sm transition-colors ${look} ${className}`}>
      <SkipForward size={12} aria-hidden />{label ?? tx("Passer")}
    </button>
  );
}
