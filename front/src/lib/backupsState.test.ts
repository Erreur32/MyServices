import { describe, expect, it } from "vitest";
import type { BackupHost, BackupSet, Backups } from "../types";
import { cronsOf, figures, newestOf, toWatch, unclaimedCrons } from "./backupsState";

const set = (o: Partial<BackupSet>): BackupSet => ({ id: "s", label: "s", origin: "dev", schedule: "", level: "ok", archived: false, offsite: 1, locations: [], ...o });
const host = (o: Partial<BackupHost>): BackupHost => ({ id: "dev", label: "Dev", ip: "10.0.0.2", kind: "serveur", reachable: true, level: "ok", disks: [], sets: [], last_local: null, copies: [], crons: [], local: [], ...o });

const root = set({ id: "dev-root", label: "Dev : /root", level: "warn", locations: [
  { host: "dev", label: "Dev", level: "ok", role: "source", path: "/home/backup", newest: { name: "Backup-dev-ROOT.tar.gz", mtime: 1000 } },
  { host: "fb", label: "Freebox", level: "crit", role: "copie", path: "/mnt/freebox/backup/dev" },
  { host: "echo", label: "echosystem", level: "ok", role: "copie", newest: { name: "Backup-dev-ROOT.tar.gz", mtime: 1200 } },
] });

describe("backups in state mode", () => {
  it("latest archive of a set: the newest place", () => {
    expect(newestOf(root)).toEqual({ mtime: 1200, name: "Backup-dev-ROOT.tar.gz", where: "echosystem" });
    expect(newestOf(set({}))).toBeNull();
  });
  it("to watch: not ok, archived left out, worst first then by name", () => {
    const list = toWatch([set({ id: "a", label: "b-warn", level: "warn" }), set({ id: "b", label: "a-ok" }), set({ id: "c", label: "c-crit", level: "crit" }), set({ id: "d", label: "old", level: "crit", archived: true }), set({ id: "e", label: "a-warn", level: "warn" })]);
    expect(list.map((s) => s.label)).toEqual(["c-crit", "a-warn", "b-warn"]);
  });
  it("figures: counts, copies elsewhere among the sets that expect one, latest archive", () => {
    const b = { sets: [root, set({ id: "ok1", offsite: 0, expect_offsite: false }), set({ id: "bad", level: "crit", offsite: 0 }), set({ id: "arch", level: "crit", archived: true })] } as Backups;
    const f = figures(b);
    expect([f.ok, f.warn, f.bad]).toEqual([1, 1, 1]);
    expect([f.offsiteOk, f.offsiteExpected]).toEqual([1, 2]);
    expect(f.last?.set.id).toBe("dev-root");
  });
  it("cron lines: those naming the folder or the archive stem belong to the set; the others are unclaimed", () => {
    const h = host({ crons: [{ src: "crontab root", line: "30 1 * * 1 /bin/bash /root/Backup-dev-ROOT.tar.gz.sh" }, { src: "crontab root", line: "0 3 * * * /usr/bin/rsync /data /mnt/nas" }] });
    expect(cronsOf(root, [h]).map((c) => c.line)).toEqual(["30 1 * * 1 /bin/bash /root/Backup-dev-ROOT.tar.gz.sh"]);
    expect(unclaimedCrons([root], [h]).map((c) => c.line)).toEqual(["0 3 * * * /usr/bin/rsync /data /mnt/nas"]);
    expect(cronsOf(root, [])).toEqual([]);
  });
});
