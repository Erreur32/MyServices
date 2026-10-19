// Backups tab in « state » mode: the summary figures, the sets to watch (not ok, worst first), the latest archive produced, the cron line that
// produces a set and the cron lines no set claims. Pure functions over backups.json (backups.py), tested apart.
import type { BackupHost, BackupLocation, BackupSet, Backups } from "../types";

/** Severity of a set level, for sorting: down and crit first, then warn, then ok */
const RANK: Record<string, number> = { down: 4, crit: 3, warn: 2, na: 1, ok: 0 };
export const rank = (level: string): number => RANK[level] ?? 1;

/** The source place of a set (where it is produced), else its first place */
export const sourceOf = (s: BackupSet): BackupLocation | undefined => s.locations.find((l) => l.role === "source") ?? s.locations[0];

/** The latest archive of a set: the newest among its places (source first when equal) */
export function newestOf(s: BackupSet): { mtime: number; name: string; where: string } | null {
  let best: { mtime: number; name: string; where: string } | null = null;
  for (const l of s.locations) if (l.newest && (!best || l.newest.mtime > best.mtime)) best = { mtime: l.newest.mtime, name: l.newest.name, where: l.label };
  return best;
}

/** The sets that are not ok (archived ones left out), the worst first, then by name */
export function toWatch(sets: BackupSet[]): BackupSet[] {
  return sets.filter((s) => !s.archived && s.level !== "ok").sort((a, b) => rank(b.level) - rank(a.level) || a.label.localeCompare(b.label));
}

export interface Figures { ok: number; warn: number; bad: number; offsiteOk: number; offsiteExpected: number; last: { set: BackupSet; mtime: number; name: string } | null }

/** The four tiles: up to date (with the copies elsewhere), late, missing or failing, the latest archive produced */
export function figures(b: Backups): Figures {
  const live = (b.sets ?? []).filter((s) => !s.archived);
  const expected = live.filter((s) => s.expect_offsite !== false);
  let last: Figures["last"] = null;
  for (const s of live) { const n = newestOf(s); if (n && (!last || n.mtime > last.mtime)) last = { set: s, mtime: n.mtime, name: n.name }; }
  return {
    ok: live.filter((s) => s.level === "ok").length, warn: live.filter((s) => s.level === "warn").length,
    bad: live.filter((s) => s.level === "crit" || s.level === "down").length,
    offsiteOk: expected.filter((s) => s.offsite > 0).length, offsiteExpected: expected.length, last,
  };
}

export interface CronLine { host: string; src?: string; line: string }

/** The words of a set that a cron line may carry: the source folder, the archive names and their stems (« Backup-Root.tar.gz » -> « Backup-Root ») */
function needles(s: BackupSet): string[] {
  const out = new Set<string>();
  for (const l of s.locations) {
    if (l.role === "source" && l.path) out.add(l.path);
    const n = l.newest?.name; if (n) { out.add(n); out.add(n.replace(/\.(tar\.gz|tar\.zst|tgz|zip|7z|gz|zst)$/i, "")); }
  }
  return [...out].filter((x) => x.length >= 6);
}

/** The cron lines of the set's source machine that name its folder or its archives (empty when none is recognised) */
export function cronsOf(s: BackupSet, hosts: BackupHost[] = []): CronLine[] {
  const host = hosts.find((h) => h.id === s.origin);
  if (!host) return [];
  const words = needles(s);
  return host.crons.filter((c) => c.line && words.some((w) => c.line!.includes(w))).map((c) => ({ host: host.label, src: c.src, line: c.line! }));
}

/** The backup-looking cron lines of every machine that no set claims: a backup nobody follows, maybe */
export function unclaimedCrons(sets: BackupSet[], hosts: BackupHost[] = []): CronLine[] {
  const claimed = new Set(sets.flatMap((s) => cronsOf(s, hosts).map((c) => `${c.host}|${c.line}`)));
  return hosts.flatMap((h) => h.crons.filter((c) => c.line && !claimed.has(`${h.label}|${c.line}`)).map((c) => ({ host: h.label, src: c.src, line: c.line! })));
}
