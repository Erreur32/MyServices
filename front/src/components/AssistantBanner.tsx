// Bandeau de l'accueil (administrateur) : l'assistant de démarrage n'est pas fini. Disparaît quand il l'est, ou quand on le ferme (par navigateur).
import { Rocket, X } from "lucide-react";
import { useEffect, useState } from "react";
import { read } from "../api";
import { STEPS, isFinished, type AssistantProgress } from "../lib/assistant";
import { tx } from "../lib/i18n";
import { primary } from "../lib/forms";

const OFF = "myservices-assistant-banner-off";
const isOff = (): boolean => { try { return localStorage.getItem(OFF) === "1"; } catch { return false; } };

export function AssistantBanner() {
  const [state, setState] = useState<AssistantProgress | null | undefined>(undefined), [off, setOff] = useState(isOff);
  useEffect(() => { read<{ state: AssistantProgress | null }>("assistant").then((r) => setState(r.state)).catch(() => setState(undefined)); }, []);
  if (off || state === undefined || isFinished(state)) return null;   // undefined : pas encore lu (ou illisible) ; fini : plus rien à proposer
  const n = state ? new Set([...state.done, ...state.skipped]).size : 0;
  return (
    <aside className="flex flex-wrap items-center gap-3 rounded-2xl border border-link/40 bg-link/5 px-4 py-3" aria-label={tx("Assistant de démarrage")}>
      <Rocket size={18} className="shrink-0 text-link" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-muted">
        <b className="text-txt">{tx("Assistant de démarrage")}</b>{" · "}
        {n > 0 ? tx("{0} étapes sur {1} faites ou passées", n, STEPS.length) : tx("configurez MyServices pas à pas, en quelques minutes")}
      </p>
      <a href="#assistant" className={`${primary} no-underline`}>{n > 0 ? tx("Continuer") : tx("Commencer")}</a>
      <button type="button" aria-label={tx("Fermer")} title={tx("Fermer")} className="rounded-lg p-1.5 text-dim hover:bg-bg2 hover:text-txt"
        onClick={() => { try { localStorage.setItem(OFF, "1"); } catch { /* navigation privée : tant pis */ } setOff(true); }}><X size={16} aria-hidden /></button>
    </aside>
  );
}
