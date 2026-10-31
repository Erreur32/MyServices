// Machines › Untracked devices: one list of what the network search and the tools see, with « Follow » and « Hide ».
import { useMemo, useState } from "react";
import type { Device, DeviceGroup } from "../lib/devices";
import { ipNum } from "../lib/format";
import { useSort } from "../lib/filter";
import { primary, quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import { tagsOf } from "../lib/netScan";
import { Badge, Cards, Count, Dim, Table, Th } from "./ui";

const FILTER = "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-sm font-semibold text-link hover:border-link aria-pressed:border-link aria-pressed:bg-link/15 aria-pressed:text-txt";
const SMALL = "px-2 py-0.5 text-xs";

const groups = (): [DeviceGroup, string][] => [["look", tx("À regarder")], ["plain", tx("Objets simples")], ["off", tx("Hors ligne")], ["hidden", tx("Cachés")]];

function keyOf(d: Device, key: string): string | number {
  if (key === "name") return d.name.toLowerCase();
  if (key === "state") return Number(!d.online);
  if (key === "seen") return d.seen.join();
  return d.ip ? ipNum(d.ip) : Number.MAX_SAFE_INTEGER;
}

interface Actions { busy: string | null; onFollow: (d: Device) => void; onHide: (d: Device) => void; onBring: (d: Device) => void }

function Offers({ d, fresh }: Readonly<{ d: Device; fresh?: Set<string> }>) {
  const tags = tagsOf(d.host).map((t) => t.label);
  if (d.detail) tags.push(d.detail);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {tags.map((t) => <Badge key={t} tone="off">{t}</Badge>)}
      {tags.length === 0 && <Dim>{tx("Rien d'ouvert")}</Dim>}
      {!!d.ip && fresh?.has(d.ip) && <Badge tone="warn">{tx("nouvelle")}</Badge>}
    </span>
  );
}

function RowActions({ d, busy, onFollow, onHide, onBring }: Readonly<{ d: Device } & Actions>) {
  if (!d.ip) return null;
  const off = busy === d.ip;
  if (d.group === "hidden") return <button type="button" className={`${quiet} ${SMALL}`} disabled={off} onClick={() => onBring(d)}>{tx("Reprendre")}</button>;
  return (
    <span className="flex justify-end gap-1.5">
      <button type="button" className={`${primary} ${SMALL}`} disabled={off} title={tx("Ajouter aux machines suivies (relevé et santé lancés)")} onClick={() => onFollow(d)}>{tx("Suivre")}</button>
      <button type="button" className={`${quiet} ${SMALL}`} disabled={off} title={tx("Ne plus le proposer, ni dans la cloche")} onClick={() => onHide(d)}>{tx("Cacher")}</button>
    </span>
  );
}

const State = ({ d }: Readonly<{ d: Device }>) => <Badge tone={d.online ? "ok" : "off"}>{d.online ? tx("en ligne") : tx("hors ligne")}</Badge>;
const Name = ({ d }: Readonly<{ d: Device }>) => (d.name ? <b className="text-txt">{d.name}</b> : <i className="text-dim">{tx("sans nom")}</i>);

export function UnlinkedDevices({ devices, fresh, ...actions }: Readonly<{ devices: Device[]; fresh?: Set<string> } & Actions>) {
  const [group, setGroup] = useState<DeviceGroup>("look");
  const shown = useMemo(() => devices.filter((d) => d.group === group), [devices, group]);
  const sort = useSort(shown, keyOf, "ip");
  return (
    <>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={tx("Filtrer les appareils")}>
        {groups().map(([id, label]) => <button key={id} type="button" className={FILTER} aria-pressed={group === id} onClick={() => setGroup(id)}>{label}<Count n={devices.filter((d) => d.group === id).length} /></button>)}
      </div>
      {shown.length === 0 ? <Dim>{tx("Aucun appareil ici.")}</Dim> : <>
        <Table head={<>
          <Th k="state" sort={sort}>{tx("État")}</Th><Th k="name" sort={sort}>{tx("Appareil")}</Th><Th k="ip" sort={sort}>IP</Th>
          <Th>{tx("Ce qu'il propose")}</Th><Th k="seen" sort={sort}>{tx("Vu par")}</Th><Th><span className="sr-only">{tx("Actions")}</span></Th>
        </>}>
          {sort.sorted.map((d) => (
            <tr key={d.key} className="even:bg-bg/50">
              <td className="px-3 py-1.5"><State d={d} /></td>
              <td className="px-3 py-1.5"><Name d={d} /></td>
              <td className="px-3 py-1.5 font-mono text-xs text-muted">{d.ip}</td>
              <td className="px-3 py-1.5"><Offers d={d} fresh={fresh} /></td>
              <td className="px-3 py-1.5 text-muted">{d.seen.join(", ")}</td>
              <td className="px-3 py-1.5 text-right"><RowActions d={d} {...actions} /></td>
            </tr>
          ))}
        </Table>
        <Cards>
          {sort.sorted.map((d) => (
            <div key={d.key} className="flex flex-col gap-1.5 rounded-xl border border-line bg-card p-3 text-sm">
              <span className="flex flex-wrap items-center gap-2"><State d={d} /><Name d={d} /><span className="font-mono text-xs text-muted">{d.ip}</span></span>
              <Offers d={d} fresh={fresh} />
              <RowActions d={d} {...actions} />
            </div>
          ))}
        </Cards>
      </>}
      <p className="text-xs text-dim">{tx("Un appareil caché n'est plus proposé, ni dans la cloche ; « Reprendre » le ramène.")}</p>
    </>
  );
}
