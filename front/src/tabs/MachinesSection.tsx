// Réglages → Machines : deux sous-onglets, les machines et la façon dont chacune est lue (SSH & Agents).
import { useEffect, useState } from "react";
import { MonitorUp, Server, type LucideIcon } from "lucide-react";
import type { Snapshot } from "../api";
import { tx } from "../lib/i18n";
import { lastMachinesPart, rememberMachinesPart } from "../lib/settingsNav";
import { MachinesSettings } from "./MachinesSettings";
import { SshAgents } from "./SshAgents";

type Part = "machines" | "agents";
const PARTS: [Part, string, string, LucideIcon][] = [
  ["machines", tx("Machines"), tx("Les machines suivies et leurs réglages"), Server],
  ["agents", tx("SSH & Agents"), tx("Comment chaque machine est lue : agent PowerShell (Windows) ou SSH (Linux)"), MonitorUp],
];

export function MachinesSection({ snap }: { snap: Snapshot }) {
  const [, section, ip] = location.hash.split("/");   // #settings/agents/<ip> : « Installer l'agent » ; #settings/machines/<ip> : une machine ; sans adresse, on reprend le dernier sous-onglet
  const [part, setPart] = useState<Part>(() => ip && (section === "agents" || section === "machines") ? section
    : (PARTS.find(([id]) => id === lastMachinesPart())?.[0] ?? "machines"));
  useEffect(() => rememberMachinesPart(part), [part]);
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label={tx("Sous-onglets des machines")}>
        {PARTS.map(([id, label, hint, Icon]) => (
          <button key={id} type="button" onClick={() => setPart(id)} aria-current={part === id ? "page" : undefined} title={hint}
            className={`flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
              part === id ? "bg-card text-txt shadow-[inset_0_-1.5px_0_rgb(var(--link))]" : "text-muted hover:bg-bg2 hover:text-txt"}`}>
            <Icon size={15} strokeWidth={1.75} aria-hidden />{label}
          </button>
        ))}
      </nav>
      {part === "machines" ? <MachinesSettings snap={snap} focusIp={section === "machines" ? ip : undefined} /> : <SshAgents snap={snap} focusIp={section === "agents" ? ip : undefined} />}
    </div>
  );
}
