import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { quiet } from "../lib/forms";
import { tx } from "../lib/i18n";

/** Fenêtre par-dessus la page : se ferme avec Échap, le bouton ou un clic à côté */
export function Overlay({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-start overflow-y-auto bg-black/60 p-4 sm:place-items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl rounded-2xl border border-line bg-card p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold">{title}</h2>
          <button type="button" className={quiet} onClick={onClose} aria-label={tx("Fermer")}><X size={14} />{tx("Fermer")}</button>
        </div>
        {children}
      </div>
    </div>
  );
}
