// The figures of the tiles of the Virtualization page, counted like the server counts their history (tile_history.virt_points): the hosts and
// machines every hypervisor read gives, and the sets of Backups that are the vzdump of a machine.
import type { BackupSet, VirtualizationConnector } from "../types";

export interface VirtFigures {
  hosts: number; hostsUp: number; guests: number; running: number; cpu: number | null; mem: number | null; storage: number | null; storageName: string;
  backups: number; backupsOk: number;
}

const mean = (v: number[]): number | null => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);

export function virtFigures(virt: VirtualizationConnector[], sets: BackupSet[] = []): VirtFigures {
  const nodes = virt.flatMap((c) => c.nodes ?? []), up = nodes.filter((n) => n.online);
  const guests = virt.flatMap((c) => c.guests ?? []).filter((g) => !g.template);
  const volumes = virt.flatMap((c) => (c.storage ?? []).map((s) => ({ ...s, host: c.name }))).filter((s) => s.used_pct != null);
  const fullest = volumes.reduce<(typeof volumes)[number] | null>((a, b) => (a && (a.used_pct ?? 0) >= (b.used_pct ?? 0) ? a : b), null);
  const vz = sets.filter((s) => !s.archived && s.locations[0]?.vzdump);
  const of = (field: "cpu_pct" | "mem_pct") => mean(up.map((n) => n[field]).filter((v): v is number => v != null));
  return {
    hosts: nodes.length, hostsUp: up.length, guests: guests.length, running: guests.filter((g) => g.status === "running").length, cpu: of("cpu_pct"), mem: of("mem_pct"),
    storage: fullest ? Math.round(fullest.used_pct ?? 0) : null, storageName: fullest ? `${fullest.name} · ${fullest.node ?? fullest.host}` : "",
    backups: vz.length, backupsOk: vz.filter((s) => s.level === "ok").length,
  };
}
