// What Veeam backs up of a machine, read from backups.json: the jobs that back it up (it is the VM, or the computer), and the VMs
// backed up that run on it (it is the hypervisor). Archived sets are left out.
import type { BackupLocation, BackupSet, Backups, VeeamObject } from "../types";

export interface VeeamRow { set: BackupSet; loc: BackupLocation; obj: VeeamObject }

export function veeamOf(backups: Backups | null | undefined, ip: string): { mine: VeeamRow[]; hosted: VeeamRow[] } {
  const rows = (backups?.sets ?? []).filter((set) => !set.archived)
    .flatMap((set) => set.locations.flatMap((loc) => (loc.objects ?? []).map((obj): VeeamRow => ({ set, loc, obj }))));
  return { mine: rows.filter((r) => r.obj.machine === ip), hosted: rows.filter((r) => r.obj.runs_on === ip) };
}
