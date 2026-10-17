// Enregistrer l'accès SSH d'une machine déjà suivie : même appel que le réglage « Lecture par SSH » de sa carte (Réglages → Machines),
// utilisé aussi par la fenêtre de l'assistant. L'alias vient du guide SSH (compte, clé, commande à lancer sur la machine).
import { read, send } from "../api";
import type { MachinesSettings } from "../types";
import { pokeScan } from "./scan";

export async function saveSshAlias(ip: string, alias: string): Promise<void> {
  const st = await read<MachinesSettings>("machines/settings");
  const machine = { ...(st.machines[ip] ?? { name: ip }), os: undefined, ssh: alias, health: undefined };
  await send("PUT", `machines/settings/${ip}`, { machine, process: !!st.process_hosts[ip], extra: [] });
  void send("POST", `machines/settings/${ip}/refresh`).then(pokeScan, () => undefined);   // seule cette machine est relue, tout de suite
}
