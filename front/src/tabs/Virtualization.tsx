// Virtualisation : chaque hôte Proxmox VE (pvesh par SSH, ou connecteur), VMware ESXi (vim-cmd par SSH) ou vCenter (API) avec ses VM,
// reliés à leur fiche Machine (couche de rapprochement), à leur sauvegarde vzdump suivie et à leurs conteneurs Docker (SSH, Dockhand).
// Plus bas : Proxmox Backup Server et Dockhand, s'ils sont reliés. Lecture seule.
import { Box, Container, HardDrive, Monitor, Server } from "lucide-react";
import type { Snapshot } from "../api";
import { bytes, dur } from "../lib/format";
import { tx } from "../lib/i18n";
import type { BackupSet, Machine, VirtualizationConnector } from "../types";
import { Badge, Card, Count, Dim, Empty, Fill } from "../components/ui";
import { DockhandCard, PbsCard } from "../components/InfraCards";

const HYPERVISORS = ["proxmox", "esxi", "vcenter"];
type Guest = NonNullable<VirtualizationConnector["guests"]>[number];
const tone = (p?: number | null, warn = 80, bad = 90) => (p == null ? "off" : p >= bad ? "bad" : p >= warn ? "warn" : "ok") as "ok" | "warn" | "bad" | "off";
const LEVEL_TONE: Record<string, "ok" | "warn" | "bad" | "off"> = { ok: "ok", warn: "warn", crit: "bad", down: "bad" };

/** Gauge with its value, « 40 / 64 Go » under it when the totals are known */
function Gauge({ label, pct, used, total }: { label: string; pct?: number | null; used?: number | null; total?: number | null }) {
  if (pct == null) return null;
  return (
    <div className="min-w-[9rem] text-xs">
      <div className="flex justify-between gap-2 text-muted"><span>{label}</span><span className="tabular-nums">{Math.round(pct)} %</span></div>
      <Fill pct={pct} tone={tone(pct)} />
      {total ? <div className="text-dim">{bytes(used)} / {bytes(total)}</div> : null}
    </div>
  );
}

/** Last vzdump of the guest among the followed sets (Sauvegardes) of this Proxmox host: the freshest one wins */
function backupOf(g: Guest, sets: BackupSet[], hostIds: Set<string>) {
  const key = `${g.type}/${g.vmid}`;
  const mine = sets.filter((s) => !s.archived && hostIds.has(s.origin) && s.locations[0]?.vzdump === key);
  return mine.sort((a, b) => (a.locations[0].age ?? 1e9) - (b.locations[0].age ?? 1e9))[0];
}

function GuestRow({ g, m, set, backups, docker, dockhand, onMachine }: { g: Guest; m?: Machine; set?: BackupSet; backups: boolean; docker?: number; dockhand?: { containers?: number; updates: number }; onMachine: (ip: string) => void }) {
  const on = g.status === "running", age = set?.locations[0].age;
  return (
    <tr className={`hover:bg-bg2/50 ${on ? "" : "text-muted"}`}>
      <td className="px-3 py-2 align-top"><Badge tone={on ? "ok" : "off"}>{on ? tx("en marche") : tx("arrêtée")}</Badge></td>
      <td className="px-3 py-2 align-top">
        <span className="flex items-baseline gap-2"><b className="text-txt">{g.name || g.vmid}</b><Dim>{g.type === "lxc" ? "LXC" : "VM"} {g.vmid}</Dim></span>
        {(g.os || g.ip) && <span className="block text-xs text-dim">{[g.os, g.ip].filter(Boolean).join(" · ")}</span>}
        {!!g.tags?.length && <span className="mt-0.5 flex flex-wrap gap-1">{g.tags.filter((t) => !t.startsWith("_")).map((t) => <Badge key={t} tone="off">{t}</Badge>)}</span>}
      </td>
      <td className="px-3 py-2 align-top">
        {m ? <button type="button" onClick={() => onMachine(m.ip)} className="text-left hover:text-link" title={tx("Voir ses services")}>
          <span className="inline-flex items-center gap-1.5"><Monitor size={13} aria-hidden /><b>{m.name}</b></span><span className="block text-xs text-dim">{m.ip}</span></button>
          : <Dim>{tx("pas suivie")}</Dim>}
      </td>
      <td className="px-3 py-2 align-top tabular-nums">{g.cpus ? <>{g.cpus} {tx("CPU")}{on && g.cpu_pct != null && <Dim> · {Math.round(g.cpu_pct)} %</Dim>}</> : "-"}</td>
      <td className="px-3 py-2 align-top">{on && g.mem_pct != null ? <Gauge label={tx("RAM")} pct={g.mem_pct} used={g.mem} total={g.maxmem} /> : g.maxmem ? <Dim>{bytes(g.maxmem)}</Dim> : "-"}</td>
      <td className="px-3 py-2 align-top tabular-nums">{g.maxdisk ? bytes(g.maxdisk) : "-"}</td>
      <td className="px-3 py-2 align-top tabular-nums">{on && g.uptime ? dur(g.uptime) : <Dim>-</Dim>}</td>
      <td className="px-3 py-2 align-top">
        {!backups ? <Dim>-</Dim> : set ? <a href="#backups" title={set.label}><Badge tone={LEVEL_TONE[set.level] ?? "off"}>{age == null ? tx("aucune") : age < 1 ? tx("{0} h", Math.max(1, Math.round(age * 24))) : tx("{0} j", Math.round(age))}</Badge></a>
          : <a href="#settings/backups" className="text-xs text-dim hover:text-link" title={tx("Suivre ses sauvegardes vzdump dans Réglages → Sauvegardes")}>{tx("non suivie")}</a>}
      </td>
      <td className="px-3 py-2 align-top text-xs">
        {docker ? <span className="inline-flex items-center gap-1"><Container size={12} aria-hidden />{docker}</span> : null}
        {dockhand && <span className="mt-0.5 block text-dim">Dockhand{dockhand.containers != null && ` · ${dockhand.containers}`}{dockhand.updates > 0 && <span className="text-warn"> · {tx("{0} mise(s) à jour", dockhand.updates)}</span>}</span>}
        {!docker && !dockhand && <Dim>-</Dim>}
      </td>
    </tr>
  );
}

function Host({ c, snap, onMachine }: { c: VirtualizationConnector; snap: Snapshot; onMachine: (ip: string) => void }) {
  const guests = (c.guests ?? []).filter((g) => !g.template).sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || String(a.vmid).localeCompare(String(b.vmid), undefined, { numeric: true }));
  const machines = snap.data.machine_list;
  const sets = snap.backups?.sets ?? [];
  const hostIds = new Set((snap.backups?.hosts ?? []).filter((h) => h.ip === c.ip).map((h) => h.id));
  const envs = (snap.data.containers ?? []).flatMap((x) => x.environments ?? []);
  const machineOf = (g: Guest) => machines.find((m) => m.links?.guest?.vmid === g.vmid && m.links.guest.node === g.node && m.links.guest.instance === c.name);
  const via = c.via === "ssh" ? (c.connector === "esxi" ? tx("lu par SSH (vim-cmd)") : tx("lu par SSH (pvesh)")) : tx("lu par l'API");
  const vmware = c.connector !== "proxmox";
  return (
    <Card className={c.ok ? "" : "border-bad/40"}>
      <h2 className="flex flex-wrap items-center gap-2 font-bold"><Server size={16} aria-hidden />{c.name}
        <Badge tone={c.ok ? "ok" : "bad"}>{c.ok ? tx("en ligne") : tx("illisible")}</Badge>
        {c.version && <span className="font-mono text-xs text-dim">{c.label} {c.version}</span>}
        <Badge tone="info">{via}</Badge>{c.stale && <Badge tone="warn">{tx("relevé périmé")}</Badge>}</h2>
      {!c.ok && !c.stale ? <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{c.message}</p> : (
        <>
          {(c.nodes ?? []).map((n) => (
            <div key={n.name} className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-2 rounded-lg bg-bg2/50 px-3 py-2">
              <span className="text-sm"><b>{vmware ? tx("Hôte") : tx("Nœud")} {n.name}</b>{n.model && <Dim> · {n.model}</Dim>}{c.connector === "vcenter" && <Badge tone={n.online ? "ok" : "bad"}>{n.online ? tx("connecté") : tx("injoignable")}</Badge>}{n.cpus ? <Dim> · {n.cpus} {tx("CPU")}</Dim> : null}{n.uptime ? <Dim> · {tx("en marche depuis")} {dur(n.uptime)}</Dim> : null}</span>
              <Gauge label={tx("CPU")} pct={n.cpu_pct} />
              <Gauge label={tx("RAM")} pct={n.mem_pct} used={n.mem} total={n.maxmem} />
            </div>
          ))}
          {(c.storage ?? []).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              {c.storage!.map((s) => <span key={`${s.node}/${s.name}`} className="inline-flex items-start gap-1.5"><HardDrive size={13} className="mt-0.5 text-dim" aria-hidden /><Gauge label={s.name} pct={s.used_pct} used={s.used} total={s.total} /></span>)}
            </div>
          )}
          {c.totals && <p className="mt-3 text-sm text-muted">{c.totals.vm} {tx("VM")} · {c.totals.lxc} {tx("conteneurs LXC")} · <b className="text-ok">{c.totals.running} {tx("en marche")}</b>{c.totals.stopped > 0 && <> · {c.totals.stopped} {tx("arrêtés")}</>}</p>}
          {guests.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
                  <th className="px-3 py-2">{tx("État")}</th><th className="px-3 py-2">{tx("Invité")}</th><th className="px-3 py-2">{tx("Machine")}</th><th className="px-3 py-2">{tx("CPU")}</th>
                  <th className="px-3 py-2">{tx("Mémoire")}</th><th className="px-3 py-2">{tx("Disque")}</th><th className="px-3 py-2">{tx("En marche")}</th><th className="px-3 py-2">{tx("Sauvegarde")}</th><th className="px-3 py-2">Docker</th>
                </tr></thead>
                <tbody className="divide-y divide-line/60">
                  {guests.map((g) => {
                    const m = machineOf(g);
                    const dh = m?.links?.sources.find((x) => x.source === "dockhand");
                    const env = dh && envs.find((e) => e.name === dh.environment);
                    return <GuestRow key={`${g.node}/${g.vmid}`} g={g} m={m} set={vmware ? undefined : backupOf(g, sets, hostIds)} backups={!vmware} onMachine={onMachine}
                      docker={m?.info?.docker || undefined} dockhand={dh ? { containers: dh.containers, updates: env?.updates.length ?? 0 } : undefined} />;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function Virtualization({ snap, onMachine }: { snap: Snapshot; onMachine: (ip: string) => void }) {
  const virt = snap.data.virtualization ?? [];
  const pve = virt.filter((c) => HYPERVISORS.includes(c.connector)), pbs = virt.filter((c) => c.connector === "proxmox-backup");
  const docker = snap.data.containers ?? [];
  if (!pve.length && !pbs.length && !docker.length) return <Empty>{tx("Aucun hyperviseur trouvé : un Proxmox VE ou un VMware ESXi lu par SSH apparaît ici tout seul, un vCenter par son connecteur.")}</Empty>;
  return (
    <div className="flex flex-col gap-4 py-1">
      {pve.map((c) => <Host key={`${c.via ?? "api"}/${c.name}`} c={c} snap={snap} onMachine={onMachine} />)}
      {(pbs.length > 0 || docker.length > 0) && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 border-b border-line/60 pb-1 text-xs font-bold uppercase tracking-wider text-dim"><Box size={14} aria-hidden />{tx("Sauvegardes Proxmox et conteneurs")} <Count n={pbs.length + docker.length} tone="off" /></h2>
          <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pbs.map((c) => <PbsCard key={`${c.connector}/${c.name}`} c={c} />)}
            {docker.map((c) => <DockhandCard key={`${c.connector}/${c.name}`} c={c} />)}
          </div>
        </section>
      )}
    </div>
  );
}
