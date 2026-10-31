// Règles du mot de passe en direct : vert quand c'est bon, gris sinon. Exigé : longueur (et confirmation).
// Conseils : variété et phrase de passe, jamais bloquants.
import { Check, Circle, Lightbulb } from "lucide-react";
import { checkPassword, PASSWORD_MIN } from "../lib/password";
import { tx } from "../lib/i18n";
import { InfoNote } from "./InfoNote";

function Rule({ ok, children, tip }: Readonly<{ ok: boolean; children: React.ReactNode; tip?: boolean }>) {
  const Icon = ok ? Check : tip ? Lightbulb : Circle;
  return (
    <li className={`flex items-center gap-1.5 ${ok ? "text-ok" : "text-dim"}`}>
      <Icon size={13} aria-hidden className="shrink-0" />
      <span>{children}</span>
      <span className="sr-only">{ok ? tx("respecté") : tip ? tx("conseil") : tx("à respecter")}</span>
    </li>
  );
}

export function PasswordRules({ pw, again }: Readonly<{ pw: string; again?: string }>) {
  if (!pw && !again) return <InfoNote>{tx("{0} caractères minimum. Une phrase de plusieurs mots est facile à retenir et solide.", PASSWORD_MIN)}</InfoNote>;
  const c = checkPassword(pw, again);
  return (
    <ul className="flex flex-col gap-0.5 text-xs" aria-live="polite">
      <Rule ok={c.long}>{tx("{0} caractères minimum", PASSWORD_MIN)} <b className="tabular-nums">({pw.length}/{PASSWORD_MIN})</b></Rule>
      {c.same !== null && <Rule ok={c.same}>{tx("Les deux mots de passe sont identiques")}</Rule>}
      <Rule ok={c.words} tip>{tx("Conseil : une phrase de plusieurs mots")}</Rule>
    </ul>
  );
}
