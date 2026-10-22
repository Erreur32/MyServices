// Machine page, « Software and services »: its web servers (Docker, service or binary), the path of each site (NPM → relay → app)
// and every container of the machine, with or without a service. Data: machine.web and machine.containers (webservers.py).
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { Host, Machine, MachineContainer, Service, WebServer } from "../types";
import { appIcon, appIconByText, serviceIcon } from "../lib/appIcons";
import { useStoredFlag } from "../lib/storedFlag";
import { tx } from "../lib/i18n";
import { Dot } from "./marks";
import { Dim } from "./ui";

const MODE: Record<WebServer["mode"], [string, string, string]> = {   // label, colours, tooltip
  docker: ["Docker", "border-link/45 text-link", tx("Tourne dans un conteneur Docker")],
  service: [tx("service"), "border-ok/45 text-ok", tx("Service systemd actif sur la machine")],
  binary: [tx("binaire"), "border-warn/55 text-warn", tx("Process qui écoute sans service systemd ni conteneur : lancé à la main ou par un script, à vérifier")],
};
/** Short label of how a web server runs (also used in the tooltips of the Machines table) */
export const modeLabel = (mode: WebServer["mode"]) => MODE[mode][0];
const PATHS_SHOWN = 5;

const Icon = ({ src }: { src: string | null }) => src ? <img src={src} alt="" className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" aria-hidden />;
const ports = (ps: number[]) => ps.length ? ps.map((p) => `:${p}`).join(" ") : "-";

/** Small titled block inside the section: a header line (title, counts, optional action) and its content */
function Sub({ title, count, action, children }: Readonly<{ title: string; count?: string; action?: React.ReactNode; children?: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 px-2.5 text-xs">
        <b className="font-semibold uppercase tracking-wide text-muted">{title}</b>
        {count && <span className="text-dim">{count}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </div>
  );
}

/** What a web server forwards to: the app behind a relay, the proxy hosts of an NPM, the vhosts of Apache / nginx */
function Sends({ w, proxies }: Readonly<{ w: WebServer; proxies: number }>) {
  if (w.behind) {
    const b = w.behind;
    return <span className="inline-flex items-center gap-1.5" title={w.target ?? undefined}><Icon src={appIconByText(b.name, b.image)} />{b.name ? <b className="font-medium">{b.name}</b> : null}<span className="font-mono text-[11px] text-dim">{b.addr}</span></span>;
  }
  if (w.key === "npm") return proxies ? <span className="text-dim">{tx("{0} hôte(s) proxy", proxies)}</span> : <Dim>-</Dim>;
  if (w.vhosts) return <span className="text-dim">{tx("{0} vhost(s)", w.vhosts)}{w.vhosts_unreadable ? <span className="text-warn"> · {tx("{0} illisible(s)", w.vhosts_unreadable)}</span> : null}</span>;
  return <Dim>-</Dim>;
}

/** Web servers of the machine, one line each: software, how it runs, where it listens, what it forwards to */
export function WebServersTable({ m, hosts, npmIps }: Readonly<{ m: Machine; hosts: Host[]; npmIps?: Record<string, string> }>) {
  const web = m.web ?? [];
  if (!web.length) return null;
  const mine = new Set(Object.entries(npmIps ?? {}).filter(([, ip]) => ip === m.ip).map(([n]) => n));
  const proxies = hosts.filter((r) => r.type === "proxy" && r.npm && mine.has(r.npm)).length;
  return (
    <Sub title={tx("Serveurs web")} count={String(web.length)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-dim">
            <th className="w-4 px-2 py-1" /><th className="px-2 py-1 font-semibold">{tx("Logiciel")}</th><th className="px-2 py-1 font-semibold">{tx("Tourne en")}</th>
            <th className="px-2 py-1 font-semibold">{tx("Écoute")}</th><th className="px-2 py-1 font-semibold">{tx("Envoie vers")}</th>
          </tr></thead>
          <tbody className="[&>tr:nth-child(even)]:bg-bg/50">
            {web.map((w) => {
              const [mode, cls, tip] = MODE[w.mode];
              return (
                <tr key={`${w.key}/${w.mode}/${w.name}`} className="align-middle">
                  <td className="px-2 py-1.5"><Dot tone={!w.up ? "bad" : w.mode === "binary" ? "warn" : "ok"} /></td>
                  <td className="whitespace-nowrap px-2 py-1.5"><span className="inline-flex items-center gap-2"><Icon src={appIcon([w.label])} /><b className="font-medium">{w.label}</b>{!w.up && <span className="text-xs text-bad">{tx("arrêté")}</span>}</span></td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className={`inline-flex items-center gap-1 rounded border px-1.5 text-xs ${cls}`} title={tip}>{mode} · <span className="font-mono">{w.name}</span></span>
                    {w.host_net && <span className="ml-1.5 rounded border border-dashed border-line px-1 text-[11px] text-dim" title={tx("Réseau de l'hôte : pas de port publié, le port vient de sa configuration")}>{tx("réseau hôte")}</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{ports(w.ports)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs"><Sends w={w} proxies={proxies} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Sub>
  );
}

const hopUp = (r: Host, s: Service) => s.kind === "docker" ? !s.state || /^(?:up|running)/i.test(s.state) : r.backend?.up !== false;

function Hop({ icon, name, port, down }: Readonly<{ icon: string | null; name: string; port?: string | number; down?: boolean }>) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 ${down ? "border-bad/60 bg-bad/10 text-bad" : "border-line bg-bg2"}`}>
      <Icon src={icon} /><span>{name}</span>{port != null && <span className="font-mono text-[11px] text-dim">{port}</span>}{down && <span className="text-[11px]">{tx("arrêté")}</span>}
    </span>
  );
}

/** Each site served by this machine through NPM: domain, NPM, the service it reaches (an Anubis relay…), and what runs behind it */
export function SitePaths({ m, hosts }: Readonly<{ m: Machine; hosts: Host[] }>) {
  const [all, setAll] = useState(false);
  const rows = hosts.filter((r) => r.type === "proxy" && r.domains.length && r.service?.name && (r.host_ip || r.ip) === m.ip)
    .sort((a, b) => Number(!a.service?.behind) - Number(!b.service?.behind) || a.domains[0].localeCompare(b.domains[0]));
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, PATHS_SHOWN);
  const npmIcon = appIcon(["Nginx Proxy Manager"]);
  return (
    <Sub title={tx("Chemin des sites")} count={rows.length > PATHS_SHOWN && !all ? tx("{0} domaines · {1} montrés", rows.length, PATHS_SHOWN) : tx("{0} domaine(s)", rows.length)}
      action={rows.length > PATHS_SHOWN ? <button type="button" className="text-xs font-semibold text-link hover:underline" onClick={() => setAll(!all)}>{all ? tx("réduire") : tx("tout voir")}</button> : undefined}>
      <ul className="flex flex-col text-xs [&>li:nth-child(even)]:bg-bg/50">
        {shown.map((r) => {
          const s = r.service!, b = s.behind;
          return (
            <li key={String(r.id)} className="flex flex-wrap items-center gap-1.5 rounded px-2.5 py-1.5">
              <span className="min-w-40 font-semibold text-link">🌐 {r.domains[0]}</span>
              <Hop icon={npmIcon} name={r.npm || "NPM"} />
              <span className="text-dim" aria-hidden>→</span>
              <Hop icon={serviceIcon(r)} name={s.name!} port={r.port ? `:${r.port}` : undefined} down={!hopUp(r, s)} />
              {b && <><span className="text-dim" aria-hidden>→</span><Hop icon={appIconByText(b.name, b.image)} name={b.name ?? b.addr} port={b.name ? b.addr : undefined} /></>}
            </li>
          );
        })}
      </ul>
    </Sub>
  );
}

/** Every container of the machine, even those no service points to; folded by default (remembered in this browser) */
export function ContainerList({ m, hosts }: Readonly<{ m: Machine; hosts: Host[] }>) {
  const [folded, setFolded] = useStoredFlag("myservices.machine.containers.folded", true);
  const list = m.containers ?? [];
  if (!list.length) return null;
  const byName = new Map<string, Set<string>>();   // container -> the domains (or ports) of the services it runs, read once
  for (const r of hosts) {
    if (r.service?.kind !== "docker" || !r.service.name || (r.host_ip || r.ip) !== m.ip) continue;
    const set = byName.get(r.service.name) ?? new Set<string>();
    set.add(r.domains[0] ?? `:${r.port}`);
    byName.set(r.service.name, set);
  }
  const domains = (c: MachineContainer) => [...(byName.get(c.name) ?? [])];
  const up = list.filter((c) => c.up).length, alone = list.filter((c) => !byName.has(c.name)).length;
  const Chevron = folded ? ChevronDown : ChevronUp;
  const count = [tx("{0} en cours", up), list.length - up ? tx("{0} arrêté(s)", list.length - up) : "", alone ? tx("{0} sans service", alone) : ""].filter(Boolean).join(" · ");
  return (
    <Sub title={tx("Conteneurs Docker")} count={count}
      action={<button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline" aria-expanded={!folded} onClick={() => setFolded(!folded)}>{folded ? tx("Déplier") : tx("Replier")}<Chevron size={14} aria-hidden /></button>}>
      {!folded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-dim">
              <th className="w-4 px-2 py-1" /><th className="px-2 py-1 font-semibold">{tx("Nom")}</th><th className="px-2 py-1 font-semibold">Image</th>
              <th className="px-2 py-1 font-semibold">Ports</th><th className="px-2 py-1 font-semibold">Service</th>
            </tr></thead>
            <tbody className="[&>tr:nth-child(even)]:bg-bg/50">
              {list.map((c) => {
                const d = domains(c);
                return (
                  <tr key={c.name} className={c.up ? "" : "opacity-55"} title={c.status}>
                    <td className="px-2 py-1.5"><Dot tone={c.up ? "ok" : "off"} /></td>
                    <td className="whitespace-nowrap px-2 py-1.5"><span className="inline-flex items-center gap-2"><Icon src={appIconByText(c.name, c.image)} /><b className="font-medium">{c.name}</b></span></td>
                    <td className="max-w-56 truncate px-2 py-1.5 font-mono text-[11px] text-dim" title={c.image}>{c.image}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">
                      {c.ports.length || c.local_ports.length ? <>{ports(c.ports)}{c.local_ports.length > 0 && <span className="text-dim"> {c.local_ports.map((p) => `127.0.0.1:${p}`).join(" ")}</span>}</> : <Dim>-</Dim>}
                      {c.host_net && <span className="ml-1.5 rounded border border-dashed border-line px-1 font-sans text-[11px] text-dim">{tx("hôte")}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{d.length ? <span title={d.join("\n")}>{d[0]}{d.length > 1 && <span className="text-dim"> +{d.length - 1}</span>}</span> : <span className="text-dim">{c.up ? tx("sans service") : c.status}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Sub>
  );
}
