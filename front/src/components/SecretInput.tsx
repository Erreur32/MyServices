// Champ secret (mot de passe, jeton) avec un œil : montre ce qui est tapé ; pour une valeur déjà enregistrée (jamais renvoyée à la
// page), l'œil demande le mot de passe du compte puis va la chercher (route « reveal », notée dans le journal d'audit).
// « new-password » and the data-*ignore attributes: browsers ignore « off » on password fields and would fill in a remembered (old) token.
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { input } from "../lib/forms";
import { tx } from "../lib/i18n";

export function SecretInput({ value, onChange, kept, reveal, placeholder, className = input, autoComplete = "new-password" }: Readonly<{
  className?: string; value: string; onChange: (v: string) => void; kept?: boolean; reveal?: (password: string) => Promise<string>; placeholder?: string; autoComplete?: string;
}>) {
  const [shown, setShown] = useState(false);
  const [asking, setAsking] = useState(false), [pw, setPw] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const eye = () => {
    if (!shown && !value && kept && reveal) { setAsking(!asking); setError(""); return; }
    setShown(!shown);
  };
  const fetchIt = async () => {
    setBusy(true);
    try {
      onChange(await reveal!(pw));
      setShown(true); setAsking(false); setPw(""); setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex flex-col gap-1.5">
      <span className="relative flex">
        <input className={`${className} pr-10`} type={shown ? "text" : "password"} autoComplete={autoComplete} spellCheck={false}
          data-1p-ignore data-lpignore="true" data-bwignore value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={eye} className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-dim hover:bg-bg2 hover:text-txt"
          title={shown ? tx("Masquer") : !value && kept && reveal ? tx("Afficher la valeur enregistrée (mot de passe du compte demandé)") : tx("Afficher")}
          aria-label={shown ? tx("Masquer") : tx("Afficher")} aria-pressed={shown}>
          {shown ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
        </button>
      </span>
      {asking && (
        <span className="flex flex-wrap items-center gap-2 rounded-lg border border-link/40 bg-link/5 p-2 text-xs text-muted">
          {tx("Votre mot de passe, pour afficher la valeur enregistrée :")}
          <input className={`${input} w-44 py-1`} type="password" autoComplete="current-password" value={pw} autoFocus
            onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (pw) void fetchIt(); } }} />
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-link bg-link/15 px-2 py-1 font-semibold text-txt disabled:opacity-50"
            disabled={!pw || busy} onClick={() => void fetchIt()}>{busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Eye size={12} aria-hidden />}{tx("Afficher")}</button>
          {error && <span className="text-bad">{error}</span>}
        </span>
      )}
    </span>
  );
}
