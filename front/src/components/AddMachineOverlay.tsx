// « Ajouter une machine » from the Machines tab: the same four-step assistant as Réglages → Machines et accès, in a window.
import { useEffect, useState } from "react";
import { read } from "../api";
import { tx } from "../lib/i18n";
import type { MachinesSettings as State } from "../types";
import { AddMachine } from "./AddMachine";
import { Overlay } from "./Overlay";

export function AddMachineOverlay({ onClose }: Readonly<{ onClose: () => void }>) {
  const [st, setSt] = useState<State | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => { read<State>("machines/settings").then(setSt).catch(() => setFailed(true)); }, []);
  return (
    <Overlay medium title={tx("Ajouter une machine")} onClose={onClose}>
      <div className="mt-3">
        {st ? <AddMachine st={st} onDone={onClose} onCancel={onClose} /> : <p className="text-sm text-muted">{failed ? tx("Réglages des machines illisibles pour l'instant.") : tx("Chargement…")}</p>}
      </div>
    </Overlay>
  );
}
