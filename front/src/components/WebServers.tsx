// Machine page, « Software and services »: one table of what runs there, a row per software with its container, domains, ports and path.
// Data: machine.web and machine.containers (webservers.py), and the hosts of NPM.
import { useMemo, useState } from "react";
import type { Host, Machine, WebServer } from "../types";
import { appIcon, appIconByText } from "../lib/appIcons";
import { useSort } from "../lib/filter";
import { tx } from "../lib/i18n";
import { matchesFilter, softwareRows, type SoftwareFilter, type SoftwareRow } from "../lib/softwareRows";
import { Dot } from "./marks";
import { Dim, Td, Th } from "./ui";

const MODE: Record<WebServer["mode"], [string, string, string]> = {   // label, colours, tooltip
  docker: ["Docker", "border-link/45 text-link", tx("Tourne dans un conteneur Docker")],
  service: [tx("service"), "border-ok/45 text-ok", tx("Service systemd actif sur la machine")],
  binary: [tx("binaire"), "border-warn/55 text-warn", tx("Process qui écoute sans service systemd ni conteneur : lancé à la main ou par un script, à vérifier")],
};
/** Short label of how a web server runs (also used in the tooltips of the Machines table) */
export const modeLabel = (mode: WebServer["mode"]) => MODE[mode][0];

const Icon = ({ src }: { src: string | null }) => src ? <img src={src} alt="" className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" aria-hidden />;

const PORTS_SHOWN = 3;
const portList = (ps: number[]) => ps.map((p) => `:${p}`).join(" ");

const sortKey = (r: SoftwareRow, key: string): string | number => {
  switch (key) {
    case "name": return r.name.toLowerCase();
    case "mode": return r.mode;
    case "box": return r.box.toLowerCase();
    case "domain": return r.domains[0] ?? "~";
    case "ports": return r.ports[0] ?? Number.MAX_SAFE_INTEGER;
    case "path": return r.paths[0] ?? "~";
    default: return r.order;
  }
};

/** First value and « +N », the whole list in the tooltip */
function Firsts({ items, className = "" }: Readonly<{ items: string[]; className?: string }>) {
  if (!items.length) return <Dim>-</Dim>;
  return <span className="flex min-w-0 gap-1" title={items.join("\n")}><span className={`truncate ${className}`}>{items[0]}</span>{items.length > 1 && <span className="shrink-0 text-dim">+{items.length - 1}</span>}</span>;
}

/** What a web server forwards to when no site of NPM says it: the hosts of an NPM, the vhosts of Apache / nginx, the app behind a relay */
function Forwards({ r, proxies }: Readonly<{ r: SoftwareRow; proxies: number }>) {
  const w = r.web;
  if (w?.key === "npm" && proxies) return <span className="text-dim">{tx("{0} hôte(s) proxy", proxies)}</span>;
  if (r.paths.length) return <Firsts items={r.paths} className="text-muted" />;
  if (w?.vhosts) return <span className="text-dim">{tx("{0} vhost(s)", w.vhosts)}</span>;
  if (w?.behind) return <span className="text-muted" title={w.target ?? undefined}>{w.behind.name ?? w.behind.addr}</span>;
  return <Dim>-</Dim>;
}

function SoftwareLine({ r, proxies }: Readonly<{ r: SoftwareRow; proxies: number }>) {
  const [mode, cls, tip] = MODE[r.mode];
  const open = portList(r.ports.slice(0, PORTS_SHOWN)), hidden = r.ports.length - PORTS_SHOWN;
  return (
    <tr className={`even:bg-bg/50 ${r.up ? "" : "opacity-55"}`} title={r.status}>
      <Td><span className="flex min-w-0 items-center gap-2"><Dot tone={r.up ? "ok" : "off"} /><Icon src={r.web ? appIcon([r.web.label]) : appIconByText(r.name, r.image ?? "")} /><b className="truncate font-medium" title={r.name}>{r.name}</b></span></Td>
      <Td className="whitespace-nowrap"><span className={`rounded border px-1.5 text-xs ${cls}`} title={tip}>{mode}</span></Td>
      <Td className="truncate font-mono text-xs text-muted"><span title={r.image ?? r.box}>{r.box}</span></Td>
      <Td><Firsts items={r.domains} className="text-link" /></Td>
      <Td className="truncate font-mono text-xs">
        <span title={portList(r.ports)}>{open || (r.localPorts.length ? "" : "-")}{hidden > 0 && <span className="text-dim"> +{hidden}</span>}</span>
        {r.localPorts.length > 0 && <span className="text-dim"> {r.localPorts.map((p) => `127.0.0.1:${p}`).join(" ")}</span>}
        {r.hostNet && <span className="ml-1.5 rounded border border-dashed border-line px-1 font-sans text-[11px] text-dim" title={tx("Réseau de l'hôte : pas de port publié, le port vient de sa configuration")}>{tx("réseau hôte")}</span>}
      </Td>
      <Td className="truncate text-xs"><Forwards r={r} proxies={proxies} />{!!r.web?.vhosts_unreadable && <span className="ml-1.5 text-warn">{tx("{0} illisible(s)", r.web.vhosts_unreadable)}</span>}</Td>
    </tr>
  );
}

/** Everything that runs on the machine in one table, filtered by kind and sorted by any column */
export function SoftwareTable({ m, hosts, npmIps }: Readonly<{ m: Machine; hosts: Host[]; npmIps?: Record<string, string> }>) {
  const rows = useMemo(() => softwareRows(m, hosts), [m, hosts]);
  const [filter, setFilter] = useState<SoftwareFilter>("all");
  const shown = useMemo(() => rows.filter((r) => matchesFilter(r, filter)), [rows, filter]);
  const sort = useSort(shown, sortKey, "order");
  if (!rows.length) return null;
  const mine = new Set(Object.entries(npmIps ?? {}).filter(([, ip]) => ip === m.ip).map(([n]) => n));
  const proxies = hosts.filter((r) => r.type === "proxy" && r.npm && mine.has(r.npm)).length;
  const boxes = m.containers ?? [], up = boxes.filter((c) => c.up).length, alone = rows.filter((r) => r.alone).length;
  const count = (f: SoftwareFilter) => rows.filter((r) => matchesFilter(r, f)).length;
  const FILTERS: [SoftwareFilter, string][] = [["all", tx("Tout")], ["web", tx("Serveurs web")], ["docker", tx("Conteneurs")], ["alone", tx("Sans service")]];
  return (
    <div className="-mx-3 -mb-3 mt-1 border-t border-line/60">
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        {FILTERS.filter(([f]) => count(f) > 0).map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`rounded-md border px-2 py-0.5 text-xs font-medium ${filter === f ? "border-link text-link" : "border-line text-muted hover:border-link hover:text-txt"}`}>{label} <span className="tabular-nums">{count(f)}</span></button>
        ))}
        {boxes.length > 0 && <span className="ml-auto text-xs text-dim">{[tx("{0} en cours", up), boxes.length - up ? tx("{0} arrêté(s)", boxes.length - up) : "", alone ? tx("{0} sans service", alone) : ""].filter(Boolean).join(" · ")}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] table-fixed border-collapse text-sm">
          <thead><tr>
            <Th k="name" sort={sort} className="w-[19%]">{tx("Logiciel")}</Th><Th k="mode" sort={sort} className="w-[7%]">{tx("Type")}</Th><Th k="box" sort={sort} className="w-[16%]">{tx("Conteneur")}</Th>
            <Th k="domain" sort={sort} className="w-[19%]">{tx("Domaine")}</Th><Th k="ports" sort={sort} className="w-[17%]">{tx("Ports")}</Th><Th k="path" sort={sort}>{tx("Chemin")}</Th>
          </tr></thead>
          <tbody>{sort.sorted.map((r) => <SoftwareLine key={r.key} r={r} proxies={proxies} />)}</tbody>
        </table>
      </div>
    </div>
  );
}
