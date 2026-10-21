// Sous-onglets d'une section des Réglages (Notifications, Requêtes et journaux) : une rangée de boutons au-dessus du contenu.
import type { LucideIcon } from "lucide-react";
import { tx } from "../lib/i18n";

export function SubTabNav<P extends string>({ parts, part, onPick }: Readonly<{ parts: readonly (readonly [P, string, LucideIcon, string])[]; part: P; onPick: (p: P) => void }>) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label={tx("Catégorie")}>
      {parts.map(([id, label, Icon, hint]) => (
        <button key={id} type="button" onClick={() => onPick(id)} aria-current={part === id ? "page" : undefined} title={hint}
          className={`flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
            part === id ? "bg-card text-txt shadow-[inset_0_-1.5px_0_rgb(var(--link))]" : "text-muted hover:bg-bg2 hover:text-txt"}`}>
          <Icon size={15} strokeWidth={1.75} aria-hidden />{label}
        </button>
      ))}
    </nav>
  );
}
