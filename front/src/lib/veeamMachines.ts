// What Veeam backs up of a machine, read from backups.json: the jobs that back it up (it is the VM, or the computer), and the VMs
// backed up that run on it (it is the hypervisor). Archived sets are left out.
import type { BackupLocation, BackupSet, Backups, VeeamObject } from "../types";

export interface VeeamRow { set: BackupSet; loc: BackupLocation; obj: VeeamObject }

export function veeamOf(backups: Backups | null | undefined, ip: string): { mine: VeeamRow[]; hosted: VeeamRow[] } {
  const mine: VeeamRow[] = [], hosted: VeeamRow[] = [];
  for (const set of backups?.sets ?? []) {
    if (set.archived) continue;
    for (const loc of set.locations) {
      for (const obj of loc.objects ?? []) {
        if (obj.machine === ip) mine.push({ set, loc, obj });
        if (obj.runs_on === ip) hosted.push({ set, loc, obj });
      }
    }
  }
  return { mine, hosted };
}
