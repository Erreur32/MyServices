// Virtualisation : chaque hôte Proxmox VE (pvesh par SSH, ou connecteur), VMware ESXi (vim-cmd par SSH), vCenter, Unraid ou Proxmox Datacenter Manager
// (API), KVM / libvirt, Incus / LXD ou VirtualBox (SSH) et Hyper-V (agent Windows) avec ses VM,
// reliés à leur fiche Machine (couche de rapprochement), à leur sauvegarde vzdump suivie et à leurs conteneurs Docker (SSH, Dockhand).
// Plus bas : Proxmox Backup Server, s'il est relié. Dockhand (Docker seulement) reste dans Santé. Lecture seule.
import { Box, Container, HardDrive, Monitor, Server } from "lucide-react";
import type { Snapshot } from "../api";
import { bytes, dur } from "../lib/format";
import { tx } from "../lib/i18n";
import type { BackupSet, Machine, VirtualizationConnector } from "../types";
import { Badge, Card, Count, Dim, Empty, Fill } from "../components/ui";
import { PbsCard } from "../components/InfraCards";

const HYPERVISORS = ["proxmox", "pulse", "esxi", "vcenter", "pdm", "unraid", "libvirt", "incus", "lxd", "virtualbox", "hyperv"];
/** How a host was read, shown as a badge */
const VIA: Record<string, string> = { esxi: "vim-cmd", proxmox: "pvesh", libvirt: "virsh", incus: "incus", lxd: "lxc", virtualbox: "VBoxManage" };
type Guest = NonNullable<VirtualizationConnector["guests"]>[number];
const tone = (p?: number | null, warn = 80, bad = 90) => (p == null ? "off" : p >= bad ? "bad" : p >= warn ? "warn" : "ok") as "ok" | "warn" | "bad" | "off";
const LEVEL_TONE: Record<string, "ok" | "warn" | "bad" | "off"> = { ok: "ok", warn: "warn", crit: "bad", down: "bad" };

/** Gauge with its value, « 40 / 64 Go » under it when the totals are known; it fills the width its grid cell gives, so gauges line up */
function Gauge({ label, pct, used, total, icon }: Readonly<{ label: string; pct?: number | null; used?: number | null; total?: number | null; icon?: React.ReactNode }>) {
  if (pct == null) return null;
  return (
    <div className="min-w-0 text-xs">
      <div className="flex items-center justify-between gap-2 text-muted"><span className="flex min-w-0 items-center gap-1 truncate">{icon}{label}</span><b className="tabular-nums text-txt">{Math.round(pct)} %</b></div>
      <Fill pct={pct} tone={tone(pct)} />
      {total ? <div className="truncate text-[11px] text-dim">{bytes(used)} / {bytes(total)}</div> : null}
    </div>
  );
}

/** A guest's CPU or memory: a gauge while it runs, else what it is given (« 6 CPU », « 16 Go ») */
function GuestLoad({ on, pct, label, used, total, idle }: Readonly<{ on: boolean; pct?: number | null; label: string; used?: number | null; total?: number | null; idle?: string }>) {
  if (on && pct != null) return <Gauge label={label} pct={pct} used={used} total={total} />;
  return <Dim>{idle ?? "-"}</Dim>;
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
      <td className="w-36 px-3 py-2 align-top"><GuestLoad on={on} pct={g.cpu_pct} label={g.cpus ? tx("{0} CPU", g.cpus) : tx("CPU")} idle={g.cpus ? tx("{0} CPU", g.cpus) : undefined} /></td>
      <td className="w-40 px-3 py-2 align-top"><GuestLoad on={on} pct={g.mem_pct} label={tx("RAM")} used={g.mem} total={g.maxmem} idle={g.maxmem ? bytes(g.maxmem) : undefined} /></td>
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
  const via = c.via === "ssh" ? tx("lu par SSH ({0})", VIA[c.connector] ?? "ssh") : c.via === "agent" ? tx("lu par l'agent Windows") : tx("lu par l'API");
  const vmware = !["proxmox", "pdm", "pulse"].includes(c.connector);   // vzdump backups and « node » wording are Proxmox's only (Pulse reads Proxmox)
  // One section per node with its own guests and storage; a host without nodes (or guests on an unknown node) gets a section of its own
  const nodes = c.nodes ?? [];
  const storageOf = (node?: string) => (c.storage ?? []).filter((st) => (node ? st.node === node : !nodes.some((n) => n.name === st.node)));
  const orphan = !nodes.length || guests.some((g) => !nodes.some((n) => n.name === g.node)) || storageOf().length > 0;   // guests or storage on no known node (ESXi datastores)
  const byNode = [...nodes.map((n) => ({ node: n as typeof nodes[number] | undefined, list: guests.filter((g) => g.node === n.name) })),
    ...(orphan ? [{ node: undefined, list: guests.filter((g) => !nodes.some((n) => n.name === g.node)) }] : [])];
  return (
    <Card className={c.ok ? "" : "border-bad/40"}>
      <h2 className="flex flex-wrap items-center gap-2 font-bold"><Server size={16} aria-hidden />{c.name}
        <Badge tone={c.ok ? "ok" : "bad"}>{c.ok ? tx("en ligne") : tx("illisible")}</Badge>
        {c.version && <span className="font-mono text-xs text-dim">{c.label} {c.version}</span>}
        <Badge tone="info">{via}</Badge>{c.stale && <Badge tone="warn">{tx("relevé périmé")}</Badge>}
        {c.totals && <span className="ml-auto text-sm font-normal text-muted">{c.totals.vm} {tx("VM")}{c.totals.lxc > 0 || c.connector === "proxmox" || c.connector === "pulse" ? <> · {c.totals.lxc} {tx("LXC")}</> : null} · <b className="text-ok">{c.totals.running} {tx("en marche")}</b>{c.totals.stopped > 0 && <> · {c.totals.stopped} {tx("arrêtés")}</>}</span>}</h2>
      {!c.ok && !c.stale ? <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{c.message}</p> : (
        <>
          {!!c.problems?.length && <ul className="mt-3 flex flex-col gap-0.5 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{c.problems.map((p) => <li key={p}>⚑ {p}</li>)}</ul>}
          {byNode.map(({ node: n, list }) => (
            <section key={n?.name ?? "-"} className="mt-3 overflow-hidden rounded-xl border border-line">
              {n && (
                <div className="grid items-center gap-x-6 gap-y-2 bg-bg2/50 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_11rem_11rem]">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <Server size={14} className="text-dim" aria-hidden /><b>{vmware ? tx("Hôte") : tx("Nœud")} {n.name}</b>
                    {c.connector === "vcenter" && <Badge tone={n.online ? "ok" : "bad"}>{n.online ? tx("connecté") : tx("injoignable")}</Badge>}
                    <span className="text-xs text-dim">{[n.model, n.cpus ? tx("{0} CPU", n.cpus) : "", n.uptime ? tx("en marche depuis {0}", dur(n.uptime)) : ""].filter(Boolean).join(" · ")}</span>
                    <Badge tone="off">{tx("{0} invité(s)", list.length)}</Badge>
                  </span>
                  <Gauge label={tx("CPU")} pct={n.cpu_pct} />
                  <Gauge label={tx("RAM")} pct={n.mem_pct} used={n.mem} total={n.maxmem} />
                </div>
              )}
              {storageOf(n?.name).length > 0 && (
                <div className="grid gap-x-6 gap-y-2 border-t border-line/60 px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {storageOf(n?.name).map((st) => <Gauge key={`${st.node}/${st.name}`} label={st.name} pct={st.used_pct} used={st.used} total={st.total} icon={<HardDrive size={12} className="shrink-0 text-dim" aria-hidden />} />)}
                </div>
              )}
              {list.length > 0 && (
                <div className="overflow-x-auto border-t border-line/60">
                  <table className="w-full border-collapse text-sm">
                    <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
                      <th className="px-3 py-2">{tx("État")}</th><th className="px-3 py-2">{tx("Invité")}</th><th className="px-3 py-2">{tx("Machine")}</th><th className="px-3 py-2">{tx("CPU")}</th>
                      <th className="px-3 py-2">{tx("Mémoire")}</th><th className="px-3 py-2">{tx("Disque")}</th><th className="px-3 py-2">{tx("En marche")}</th><th className="px-3 py-2">{tx("Sauvegarde")}</th><th className="px-3 py-2">Docker</th>
                    </tr></thead>
                    <tbody className="divide-y divide-line/60">
                      {list.map((g) => {
                        const m = machineOf(g);
                        const dh = m?.links?.sources.find((x) => x.source === "dockhand" || x.source === "dozzle");
                        const env = dh && envs.find((e) => e.name === dh.environment);
                        return <GuestRow key={`${g.node}/${g.vmid}`} g={g} m={m} set={vmware ? undefined : backupOf(g, sets, hostIds)} backups={!vmware} onMachine={onMachine}
                          docker={m?.info?.docker || undefined} dockhand={dh ? { containers: dh.containers, updates: env?.updates.length ?? 0 } : undefined} />;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </Card>
  );
}

export function Virtualization({ snap, onMachine }: { snap: Snapshot; onMachine: (ip: string) => void }) {
  const virt = snap.data.virtualization ?? [];
  const pve = virt.filter((c) => HYPERVISORS.includes(c.connector)), pbs = virt.filter((c) => c.connector === "proxmox-backup");
  if (!pve.length && !pbs.length) return <Empty>{tx("Aucun hyperviseur trouvé : Proxmox VE, VMware ESXi, KVM / libvirt, Incus / LXD ou VirtualBox lus par SSH apparaissent ici tout seuls, Hyper-V par l'agent Windows, vCenter, Unraid et Proxmox Datacenter Manager par leur connecteur.")}</Empty>;
  return (
    <div className="flex flex-col gap-4 py-1">
      {pve.map((c) => <Host key={`${c.via ?? "api"}/${c.name}`} c={c} snap={snap} onMachine={onMachine} />)}
      {pbs.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 border-b border-line/60 pb-1 text-xs font-bold uppercase tracking-wider text-dim"><Box size={14} aria-hidden />{tx("Proxmox Backup Server")} <Count n={pbs.length} tone="off" /></h2>
          <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pbs.map((c) => <PbsCard key={`${c.connector}/${c.name}`} c={c} />)}
          </div>
        </section>
      )}
    </div>
  );
}
