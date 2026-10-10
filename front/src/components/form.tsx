// Éléments de formulaire des Réglages (composants) ; classes, type Note et act() : lib/forms.ts.
import { useState, type ReactNode } from "react";
import { quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

/** Retour d'une action : message vert ou rouge sous le formulaire. */

export function NoteLine({ note }: { note: Note }) {
  if (!note) return null;
  return <p role="status" className={`mt-2 text-sm ${note.ok ? "text-ok" : "text-bad"}`}>{note.ok ? "✓" : "⚠"} {note.text}</p>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1 text-sm text-muted">{label}{children}</label>;
}


/** Interrupteur on / off (role="switch") */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${on ? "border-ok/60 bg-ok/70" : "border-line bg-bg2"}`}>
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

/** Texte à copier (clé, commande) avec son bouton */
export function Copyable({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-bg2 p-2.5 font-mono text-xs">{text}</pre>
      <button type="button" className={quiet} onClick={() => void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
        {done ? tx("copié") : tx("copier")}
      </button>
    </div>
  );
}
