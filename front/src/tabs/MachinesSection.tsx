// Réglages → Machines : une seule page. Chaque machine a sa fenêtre (Identité, Options, Accès avec SSH et agent) ; les liens
// #settings/agents/<ip> (anciens et ceux des autres onglets) ouvrent la fenêtre de la machine sur l'onglet Accès.
import { SlidersHorizontal } from "lucide-react";
import type { Snapshot } from "../api";
import { FoldPanel } from "../components/FoldPanel";
import { tx } from "../lib/i18n";
import { HealthSwitch } from "./SystemSettings";
import { MachinesSettings } from "./MachinesSettings";

export function MachinesSection({ snap }: Readonly<{ snap: Snapshot }>) {
  const [, section, ip] = location.hash.split("/");   // #settings/machines/<ip> : une machine ; #settings/agents/<ip> : son onglet Accès
  return (
    <div className="flex flex-col gap-4">
      <MachinesSettings snap={snap} focusIp={ip} focusTab={section === "agents" ? "access" : undefined} />
      <FoldPanel id="machines-advanced" icon={SlidersHorizontal} title={tx("Avancé")} startFolded>
        <HealthSwitch />
      </FoldPanel>
    </div>
  );
}
