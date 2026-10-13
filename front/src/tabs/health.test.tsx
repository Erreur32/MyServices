import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { Health } from "./Health";

// Health tab rendered without a browser: healthy machines hidden by default, a summary on top
const host = (id: string, name: string, extra: object) => ({ id, name, source: "ssh", reachable: true, level: "ok", disks: [], ...extra });
const snap = (hosts: object[]) => ({
  me: { role: "admin" },
  data: { machine_list: [], services_status: [], containers: [] },
  health: { timestamp: "2026-10-13T10:00:00", hosts, asleep: [{ id: "pc", name: "Gamer32 · 10.0.0.50", ip: "10.0.0.50", last_seen: null }] },
}) as unknown as Snapshot;

describe("onglet Santé", () => {
  it("only the machine with a problem, and a summary naming it", () => {
    const html = renderToStaticMarkup(<Health snap={snap([
      host("a", "nas · 10.0.0.2", { level: "warn", disks: [{ mount: "/data", used_pct: 91, warning: true }] }),
      host("b", "web · 10.0.0.3", {}),
    ])} />);
    for (const t of ["1 machine(s) à regarder", "nas (disque /data rempli à 91 %)", "1 éteinte(s)", "Afficher les 2 autres"]) expect(html, t).toContain(t);
    expect(html.match(/10\.0\.0\.2/g)?.length).toBeGreaterThan(0);   // the machine with a problem is listed
    expect(html).not.toContain("10.0.0.3");                            // the healthy one is not
    expect(html).not.toContain("10.0.0.50");                           // nor the PC switched off on purpose
  });
  it("all fine: one line, no empty list message", () => {
    const html = renderToStaticMarkup(<Health snap={snap([host("b", "web · 10.0.0.3", {})])} />);
    expect(html).toContain("1 machine(s), toutes en bonne santé");
    expect(html).not.toContain("Aucune machine pour ce filtre.");
  });
});
