// Réglages → Machines : une seule page. Chaque machine a sa fenêtre (Identité, Options, Accès avec SSH et agent) ; les liens
// #settings/agents/<ip> (anciens et ceux des autres onglets) ouvrent la fenêtre de la machine sur l'onglet Accès.
import type { Snapshot } from "../api";
import { MachinesSettings } from "./MachinesSettings";

export function MachinesSection({ snap }: Readonly<{ snap: Snapshot }>) {
  const [, section, ip] = location.hash.split("/");   // #settings/machines/<ip> : une machine ; #settings/agents/<ip> : son onglet Accès
  return <MachinesSettings snap={snap} focusIp={ip} focusTab={section === "agents" ? "access" : undefined} />;
}
