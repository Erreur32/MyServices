// Agent, SSH or connector: which one to choose for a machine. The same rule as the server's (access_advice.py) and the README; shown in
// First steps (Read each machine) and in Settings › Machines (Access).
import { tx } from "../lib/i18n";
import { InfoNote } from "./InfoNote";

export function AccessChoice({ className = "" }: Readonly<{ className?: string }>) {
  return (
    <div className={`rounded-lg border border-link/50 bg-link/5 px-3 py-2 text-sm text-muted ${className}`}>
      <b className="text-txt">{tx("Lequel choisir ?")}</b>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li><b className="text-txt">{tx("Agent")}</b> {tx("(PC Windows, machine Linux) : la méthode conseillée. Il relit la machine chaque minute et l'envoie lui-même, sans clé SSH à ouvrir ; un PC souvent éteint se signale dès qu'il se rallume.")}</li>
        <li><b className="text-txt">SSH</b> {tx(": gardé pour ce que l'agent ne lit pas (sauvegardes, Proxmox ou ESXi, NPM, AdGuard), pour un Mac (pas d'agent macOS), ou si l'agent ne peut pas être installé.")}</li>
        <li><b className="text-txt">{tx("Connecteur")}</b> {tx("(Freebox, UniFi, Home Assistant, appli) : on n'y installe rien, MyServices lit l'outil.")}</li>
      </ul>
      <InfoNote className="mt-1">{tx("Agent et SSH peuvent tourner ensemble : la santé vient de l'agent tant qu'il répond, le SSH prend le relais s'il se tait et garde ses usages propres.")}</InfoNote>
    </div>
  );
}
