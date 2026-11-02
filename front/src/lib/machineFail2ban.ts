// The Fail2ban of each machine, read by its agent or over SSH (health stats.json), for the security page and its overview. The trend (peak of
// 24 h, usual level, rising) is set by the health pass from the history it keeps (tile_history.fail2ban_trend), the same as the alert.
import type { Health } from "../types";
import { splitHostName } from "./format";

export type F2bState = "rising" | "usual" | "calm" | "unread" | "absent";
export interface MachineF2b {
  id: string; name: string; ip: string; via: string; state: F2bState;
  jails: { name: string; banned: number }[]; total: number; peak: number | null; usual: number | null; rule?: string;
}

export const STATE_ORDER: F2bState[] = ["rising", "usual", "unread", "calm", "absent"];

/** One row per machine whose health pass looked for Fail2ban, the ones to look at first */
export function machineFail2ban(health: Health | null): MachineF2b[] {
  return (health?.hosts ?? []).flatMap((h): MachineF2b[] => {
    const f = h.system?.fail2ban;
    if (!f) return [];
    const [name, ip] = splitHostName(h.name);
    const total = f.total ?? 0;
    let state: F2bState = "absent";
    if (f.available && (!f.access || f.down)) state = "unread";
    else if (f.available && f.rising) state = "rising";
    else if (f.available) state = total > 0 ? "usual" : "calm";
    return [{ id: h.id, name, ip, via: h.source ?? "", state, jails: f.jails ?? [], total, peak: f.peak ?? null, usual: f.usual ?? null, rule: f.rule }];
  }).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.total - a.total || a.name.localeCompare(b.name));
}

/** Machines whose Fail2ban answers: the ones the table and the figures count */
export const readF2b = (rows: MachineF2b[]): MachineF2b[] => rows.filter((r) => r.state !== "absent" && r.state !== "unread");
