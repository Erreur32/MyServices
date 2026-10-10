import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { Backups } from "./Backups";

// Rendu de l'onglet sur un backups.json du format de backups.py (sans navigateur)
const snap = {
  data: { page: { map: true } },
  backups: {
    generated: "2026-10-10T07:05:00+02:00",
    summary: { ok: 1, warn: 0, crit: 1, sets: 2, hosts: 2, volume: 5e9, no_offsite: 1, local_dirs: 1, local_unlisted: 1 },
    issues: [{ level: "crit", set: "HA", text: "aucune copie hors machine à jour" }],
    sets: [{ id: "a", label: "srv: base", origin: "srv", schedule: "03:00", level: "ok", archived: false, offsite: 1, locations: [] },
           { id: "b", label: "srv: ha", origin: "srv", schedule: "04:00", level: "crit", archived: false, offsite: 0, locations: [] }],
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
  it("synthèse, alertes, machines et dossiers locaux", () => {
    const html = renderToStaticMarkup(<Backups snap={snap} />);
    for (const t of ["jeux critiques", "aucune copie hors machine à jour", "🔒 NAS", "base", "91 %", "/backup/x", "non inventorié", "injoignable"])
      expect(html).toContain(t);
  });
});
