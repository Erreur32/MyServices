// Settings → Tasks and schedules: the discoveries that run by themselves (services, new services, network search, backups…), one
// aligned row each with its mode, last and next time. Read from GET /discoveries, shared with the bell and Discovery.
import { Check } from "lucide-react";
import type { Snapshot } from "../api";
import { Action, MODE, Title, useDiscoveries, when, type DiscoveryItem } from "./DiscoveryCard";
import { Badge, Card, Count } from "./ui";
import { tx } from "../lib/i18n";

/** Something that runs by itself: aligned columns (icon, what it is, mode, last and next time, button), so the list reads as a table */
function AutoRow({ x, reload, machines }: { x: DiscoveryItem; reload: () => void; machines: Snapshot["data"]["machine_list"] }) {
  const m = MODE[x.mode], last = when(x.last), next = when(x.next);
  const sub = "col-start-2 md:col-start-auto";
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 py-3 md:grid-cols-[2rem_minmax(0,1fr)_8.5rem_12.5rem_10rem] md:items-center">
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${m.tone === "ok" ? "bg-ok/10 text-ok" : "bg-bg2 text-muted"}`} title={m.hint}><m.Icon size={15} aria-hidden /></span>
      <div className="min-w-0">
        <div className="text-sm"><Title x={x} machines={machines} /></div>
        <p className="mt-0.5 text-xs text-muted">{x.what}</p>
        {x.note && <p className="mt-0.5 text-xs text-dim">{x.note}</p>}
      </div>
      <span className={sub}><Badge tone={m.tone} title={m.hint}>{m.label}</Badge></span>
      <dl className={`${sub} grid grid-cols-[auto_1fr] gap-x-2 text-xs tabular-nums`}>
        <dt className="text-dim">{tx("dernière")}</dt><dd className="text-muted">{last ?? "-"}</dd>
        <dt className="text-dim">{tx("prochaine")}</dt><dd className="text-muted">{next ?? "-"}</dd>
      </dl>
      <div className={`${sub} flex flex-wrap gap-1.5 md:justify-end`}>{x.action && <Action a={x.action} reload={reload} />}</div>
    </li>
  );
}

/** What runs by itself: everything that is neither to do, nor suggested, nor forgotten (a stopped container is shown in Discovery) */
export function AutoDiscoveries({ machines }: { machines: Snapshot["data"]["machine_list"] }) {
  const [disc, reload] = useDiscoveries();
  const items = (disc?.items ?? []).filter((x) => x.state !== "todo" && x.state !== "suggest" && x.id !== "hosts" && !x.muted && x.running !== false);
  if (!items.length) return null;
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Check size={16} className="text-ok" aria-hidden />{tx("Ce qui tourne tout seul")} <Count n={items.length} /></h2>
      <p className="text-sm text-muted">{tx("Recherches de MyServices pour compléter ce qu'il sait : rien à faire, pour information.")}</p>
      <ul className="mt-2 flex flex-col divide-y divide-line/60">{items.map((x) => <AutoRow key={x.id} x={x} reload={reload} machines={machines} />)}</ul>
    </Card>
  );
}
