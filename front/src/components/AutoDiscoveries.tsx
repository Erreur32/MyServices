// Settings → Tasks and schedules: discoveries that no scheduled task covers (redetect the machines, the /home/backup folder once,
// other backup folders by hand). Those a task runs (services, new services, connectors, network search, backup cron) are told on
// that task's row instead (DISCOVERED_BY), so nothing is listed twice.
import { Hand } from "lucide-react";
import type { Snapshot } from "../api";
import { Action, MODE, Title, useDiscoveries, when, type DiscoveryItem } from "./DiscoveryCard";
import { Badge, Card, Count } from "./ui";
import { tx } from "../lib/i18n";
import { InfoNote } from "./InfoNote";

/** Task -> the discoveries it runs (discoveries.py ids) */
export const DISCOVERED_BY: Record<string, string[]> = { collect: ["services", "new", "connectors"], netscan: ["network"], backups: ["cron"] };
const COVERED = new Set(Object.values(DISCOVERED_BY).flat());

/** One row: icon, what it is and why, then mode and dates on one line; the button on the right */
function ManualRow({ x, reload, machines }: Readonly<{ x: DiscoveryItem; reload: () => void; machines: Snapshot["data"]["machine_list"] }>) {
  const m = MODE[x.mode], last = when(x.last), next = when(x.next);
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 md:flex-nowrap">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2 text-muted" title={m.hint}><m.Icon size={15} aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm"><Title x={x} machines={machines} /></div>
        <p className="mt-0.5 text-xs text-muted">{x.what}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim">
          <Badge tone={m.tone} title={m.hint}>{m.label}</Badge>
          {x.note && <span>{x.note}</span>}
          {last && <span>{tx("dernière")} <span className="tabular-nums text-muted">{last}</span></span>}
          {next && <span>{tx("prochaine")} <span className="tabular-nums text-muted">{next}</span></span>}
        </div>
      </div>
      {x.action && <div className="flex shrink-0 md:pt-1">{<Action a={x.action} reload={reload} />}</div>}
    </li>
  );
}

export function AutoDiscoveries({ machines }: Readonly<{ machines: Snapshot["data"]["machine_list"] }>) {
  const [disc, reload] = useDiscoveries();
  const items = (disc?.items ?? []).filter((x) => x.state !== "todo" && x.state !== "suggest" && x.id !== "hosts" && !x.muted && x.running !== false
    && !COVERED.has(x.id) && !x.id.startsWith("connector:"));
  if (!items.length) return null;
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Hand size={16} aria-hidden />{tx("Recherches sans horaire")} <Count n={items.length} /></h2>
      <InfoNote>{tx("Rien à faire au quotidien. À utiliser seulement après un changement : nouvelle appli, système réinstallé, autre dossier de sauvegarde.")}</InfoNote>
      <ul className="mt-2 flex flex-col divide-y divide-line/60">{items.map((x) => <ManualRow key={x.id} x={x} reload={reload} machines={machines} />)}</ul>
    </Card>
  );
}
