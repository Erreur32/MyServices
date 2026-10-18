// Éléments de formulaire des Réglages (composants) ; classes, type Note et act() : lib/forms.ts.
import { Check, Copy, Plus, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { copyText } from "../lib/clipboard";
import { primary, type Note } from "../lib/forms";
import { Overlay } from "./Overlay";
import { tx } from "../lib/i18n";

/** Retour d'une action : message vert ou rouge sous le formulaire. */

/** Message d'un enregistrement : un succès disparaît au bout de 15 s ; une erreur s'ouvre en fenêtre par-dessus la page (on la voit où que l'on soit),
 *  puis reste affichée en rouge sous le formulaire une fois fermée. */
export function NoteLine({ note, inline = false }: { note: Note; inline?: boolean }) {   // inline : une petite ligne dans un titre, sans rien pousser en dessous
  const [gone, setGone] = useState<Note>(null), [closed, setClosed] = useState<Note>(null);
  useEffect(() => {
    if (!note?.ok) return;
    const t = setTimeout(() => setGone(note), 15_000);
    return () => clearTimeout(t);
  }, [note]);
  if (!note || (note.ok && !note.text) || gone === note) return null;
  const tone = note.ok ? "text-ok" : "text-bad";
  if (inline) return <output className={`text-xs font-normal ${tone}`}>{note.ok ? "✓" : "⚠"} {note.text}</output>;
  return (
    <>
      {!note.ok && closed !== note && (
        <Overlay title={<>⚠ {tx("Attention")}</>} onClose={() => setClosed(note)}>
          <p className="mt-3 text-sm text-bad">{note.text}</p>
          <div className="mt-4 flex justify-end"><button type="button" className={primary} onClick={() => setClosed(note)}>{tx("OK")}</button></div>
        </Overlay>
      )}
      <output className={`mt-2 block text-sm ${tone}`}>{note.ok ? "✓" : "⚠"} {note.text}</output>
    </>
  );
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  // label in one span: its parts (text, red « * », « (optional) ») stay on one line instead of one flex row each
  return <label className="flex flex-col gap-1 text-sm text-muted"><span>{label}</span>{children}</label>;
}


/** Étiquettes à créer et à retirer, gardées en un texte « a, b, c » (le rôle d'une machine) : Entrée ou virgule ajoute, × retire,
 *  Retour arrière retire la dernière. `suggestions` : étiquettes proposées en un clic (déjà présentes, elles disparaissent). */
export function TagInput({ value, onChange, label, suggestions = [], max = 200, placeholder }: {
  value: string; onChange: (v: string) => void; label: string; suggestions?: string[]; max?: number; placeholder?: string;
}) {
  const tags = value.split(",").map((t) => t.trim()).filter(Boolean);
  const [draft, setDraft] = useState("");
  const set = (next: string[]) => onChange(next.join(", ").slice(0, max));
  const add = (raw: string) => {
    const t = raw.replace(/,/g, " ").trim();
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) set([...tags, t]);
    setDraft("");
  };
  const free = suggestions.filter((s) => !tags.some((x) => x.toLowerCase() === s.toLowerCase()));
  return (
    <div className="flex flex-col gap-1 text-sm text-muted">
      <span>{label}</span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-bg2 px-2 py-1.5 focus-within:border-link">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md border border-line bg-card px-2 py-0.5 text-xs font-semibold text-txt">
            {t}
            <button type="button" onClick={() => set(tags.filter((x) => x !== t))} aria-label={tx("Retirer {0}", t)} className="text-dim hover:text-bad"><X size={12} aria-hidden /></button>
          </span>
        ))}
        <input value={draft} maxLength={40} placeholder={tags.length ? "" : placeholder} aria-label={label}
          className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 text-sm text-txt outline-none placeholder:text-dim"
          onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(draft); }
            else if (e.key === "Backspace" && !draft && tags.length) set(tags.slice(0, -1));
          }}
          onBlur={() => add(draft)} />
      </div>
      {free.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-dim">{tx("Suggestions :")}</span>
          {free.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-line px-2 py-0.5 text-xs text-muted hover:border-link hover:text-txt"><Plus size={11} aria-hidden />{s}</button>
          ))}
        </div>
      )}
    </div>
  );
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
      {/* copy icon inside the block, top right: the command gets the whole width */}
      <div className="relative">
        <pre className={`overflow-x-auto rounded-lg bg-bg2 py-2.5 pl-2.5 pr-11 font-mono text-xs ${oneLine ? "whitespace-pre" : "whitespace-pre-wrap break-all"}`}>{text}</pre>
        <button type="button" onClick={() => void copy()} title={note?.ok ? tx("copié") : tx("copier")} aria-label={note?.ok ? tx("copié") : tx("copier")}
          className={`absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-md border transition-colors ${note?.ok ? "border-ok/60 bg-ok/15 text-ok" : "border-line bg-card text-muted hover:border-link hover:text-txt"}`}>
          {note?.ok ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        </button>
      </div>
      {note && !note.ok && <NoteLine note={note} />}
    </div>
  );
}
