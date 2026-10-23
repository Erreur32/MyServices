// Réglages → Machines et accès : ajout, détection, accès par défaut et la liste des machines (MachinesSettings). Les anciens liens vers une machine
// (#settings/machines/<ip>, #settings/agents/<ip>) ouvrent sa page (#machines/<ip>, onglet Accès pour « agents »), où ses réglages vivent désormais.
import { useEffect } from "react";
import type { Snapshot } from "../api";
import { machineSettingsRedirect } from "../lib/machineHash";
import { MachinesSettings, machinesPart } from "./MachinesSettings";

export function MachinesSection({ snap }: Readonly<{ snap: Snapshot }>) {
  const to = machineSettingsRedirect(location.hash);
  useEffect(() => { if (to) location.replace(`#${to}`); }, [to]);
  if (to) return null;
  return <MachinesSettings snap={snap} part={machinesPart(location.hash.split("/")[2])} />;
}
