// Réglages → Machines → SSH & Agents : comment chaque machine est lue (agent PowerShell sur Windows, SSH sur Linux) et ce qui est lu par ce biais.
import type { Snapshot } from "../api";
import { Agents } from "./Agents";

export function SshAgents({ snap, focusIp }: { snap: Snapshot; focusIp?: string }) {
  return <Agents focusIp={focusIp} live={snap.data.machine_list || []} network={snap.data.network || []} statuses={snap.data.connectors || []} />;
}
