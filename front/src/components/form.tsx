// Éléments de formulaire des Réglages (composants) ; classes, type Note et act() : lib/forms.ts.
import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { copyText } from "../lib/clipboard";
import { button, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

/** Retour d'une action : message vert ou rouge sous le formulaire. */

export function NoteLine({ note }: { note: Note }) {
  if (!note || (note.ok && !note.text)) return null;
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
export function Copyable({ text, oneLine = false }: { text: string; oneLine?: boolean }) {
  const [note, setNote] = useState<Note>(null);
  const copy = async () => {
    const ok = await copyText(text);
    setNote({ ok, text: ok ? tx("Copié dans le presse-papiers") : tx("Copie impossible : sélectionner le texte et le copier à la main") });
    setTimeout(() => setNote(null), ok ? 2500 : 6000);
  };
  return (
    <div>
      <div className="flex items-start gap-2">
        <pre className={`min-w-0 flex-1 overflow-x-auto rounded-lg bg-bg2 p-2.5 font-mono text-xs ${oneLine ? "whitespace-pre" : "whitespace-pre-wrap break-all"}`}>{text}</pre>
        <button type="button" onClick={() => void copy()}
          className={note?.ok ? `${button} border-ok bg-ok/15 text-ok` : primary}>
          {note?.ok ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{note?.ok ? tx("copié") : tx("copier")}
        </button>
      </div>
      <NoteLine note={note} />
    </div>
  );
}
