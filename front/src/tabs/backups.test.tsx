import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { Backups } from "./Backups";

// Rendu de l'onglet sur un backups.json du format de backups.py (sans navigateur)
const snap = {
  me: { username: "a", role: "admin" },
  data: { page: { map: true }, machine_list: [{ ip: "10.0.0.2", name: "srv", ping: true, off: false, services: 0, npm: 0, down: 0 }] },
  backups: {
    generated: "2026-10-10T07:05:00+02:00",
    summary: { ok: 1, warn: 0, crit: 1, sets: 2, hosts: 2, volume: 5e9, no_offsite: 1, local_dirs: 1, local_unlisted: 1 },
    issues: [{ level: "crit", set: "HA", text: "aucune copie hors machine à jour" }],
    sets: [{ id: "a", label: "srv: base", origin: "srv", origin_label: "srv", schedule: "03:00", level: "ok", archived: false, offsite: 1,
             locations: [{ host: "srv", label: "srv", level: "ok", role: "source", path: "/backup", newest: { name: "base.tar.gz", mtime: 1791600000 } }] },
           { id: "b", label: "srv: ha", origin: "srv", origin_label: "srv", schedule: "04:00", level: "crit", archived: false, offsite: 0, why: ["aucune copie hors machine à jour"], locations: [] }],
    hosts: [
      { id: "srv", label: "srv", ip: "10.0.0.2", kind: "serveur", reachable: true, level: "crit",
        disks: [{ mount: "/", pct: 91, avail: 1e9, size: 1e10, level: "crit" }], sets: ["a", "b"],
        last_local: { age: 0.4, mtime: 1791600000, set: "srv: base", level: "ok" },
        copies: [{ host: "nas", label: "NAS", vias: ["rsync"], sets: 1, level: "ok", age: 1.2, encrypted: true }],
        crons: [], local: [{ path: "/backup/x", size: 2e6, covered: [], age: 3 }] },
      { id: "nas", label: "NAS", ip: "10.0.0.5", kind: "stockage", reachable: false, level: "ok", storage: true,
        disks: [], sets: [], last_local: null, copies: [], crons: [], local: [] },
    ],
  },
} as unknown as Snapshot;

describe("onglet Sauvegardes", () => {
  it("figures, the sets to watch, the folded views", () => {
    const html = renderToStaticMarkup(<Backups snap={snap} />);
    for (const t of ["À jour", "Absente ou en erreur", "Dernière archive", "base.tar.gz", "À surveiller", "aucune copie hors machine à jour", "Tout voir", "Par machine", "Réglages des sauvegardes"])
      expect(html).toContain(t);
    expect(html).not.toContain("srv: base</b>");   // the ok set sits in « Tout voir », folded
    expect(html).not.toContain("91 %");   // the view by machine starts folded
    expect(html).toContain(">ha<");   // the set to watch, its label without the machine prefix
  });
});
