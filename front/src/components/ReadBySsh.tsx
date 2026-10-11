import { useEffect, useState } from "react";
import { Plug, Server } from "lucide-react";
import { read, type Snapshot } from "../api";
import { Card, Dim } from "./ui";
import { StatusLine } from "./ssh";
import { quiet } from "../lib/forms";
import { appIcon } from "../lib/appIcons";
import { tx } from "../lib/i18n";
import type { ConnectorInstance, ConnectorsState } from "../types";

/** Ce que la collecte lit par SSH (AdGuard, Docker, process…) : pas de formulaire ici, le réglage est celui de la machine */
export function ReadBySsh({ snap }: { snap: Snapshot }) {
  const [instances, setInstances] = useState<ConnectorInstance[]>([]);   // les connecteurs qui ont leur formulaire dans Réglages → Connecteurs
  useEffect(() => { read<ConnectorsState>("connectors/settings").then((s) => setInstances(s.instances)).catch(() => undefined); }, []);
  const rows = (snap.data.connectors ?? []).filter((c) => !instances.some((i) => i.type === c.type && i.name === c.name));
  if (!rows.length) return null;
  const machines = snap.data.machine_list ?? [];
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Server size={16} />{tx("SSH Agent Actifs")} <Dim>· {rows.length}</Dim></h2>
      <p className="mb-3 text-sm text-muted">{tx("Pas de formulaire ici : ces lectures se règlent sur la machine (AdGuard, Docker, processus). Elles sont trouvées toutes seules quand la machine est lue par SSH.")}</p>
      <ul className="flex flex-col divide-y divide-line/60">
        {rows.map((c) => {
          const ip = c.ip || c.name, m = machines.find((x) => x.ip === ip);
          return (
            <li key={`${c.type}/${c.name}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-sm">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2">
                {appIcon([c.type]) ? <img src={appIcon([c.type])!} alt="" className="h-5 w-5" /> : <Plug size={16} className="text-muted" aria-hidden />}
              </span>
              <b className="capitalize">{c.type}</b><Dim>· {m?.name ?? c.name}</Dim>
              <span className="min-w-0 flex-1"><StatusLine s={c} /></span>
              {m && <a className={`${quiet} no-underline`} href={`#settings/machines/${m.ip}`}>{tx("Régler sur la machine")}</a>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
