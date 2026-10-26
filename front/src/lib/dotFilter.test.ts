import { describe, expect, it } from "vitest";
import type { Data, Health } from "../types";
import { DOT_FILTER, attention } from "./summary";

const data = { generated: "2026-10-26T18:00:00+00:00", machine_list: [], hosts: [], connectors: [] } as unknown as Data;

describe("pastille du menu : le clic montre ce que la bulle liste", () => {
  it("machines : les alertes de santé et la pastille partagent la facette Santé", () => {
    const health = { hosts: [{ name: "A · 10.0.0.1", level: "warn", reachable: true }, { name: "B · 10.0.0.2", level: "ok", reachable: true }] } as unknown as Health;
    const items = attention({ data, health }).filter((i) => i.tab === "machines");
    expect(items).toHaveLength(1);
    expect(items[0].sel).toEqual(DOT_FILTER.machines);
    expect(DOT_FILTER.machines).toEqual({ health: ["warn", "crit", "down"] });   // not the « Alertes » facet (the wider « À surveiller » column)
  });

  it("services : la facette « en alerte » de la page (en panne ou avertissement, non masqué)", () => {
    expect(DOT_FILTER.services).toEqual({ alert: ["on"] });
  });

  it("connecteurs : la pastille va sur l'entrée Connecteurs, un Docker illisible sur Machines", () => {
    const d = { ...data, connectors: [{ type: "npm", name: "npm", ok: false, message: "boom" }, { type: "docker", name: "Jarvis", ok: false, message: "x" }] } as unknown as Data;
    const items = attention({ data: d }).filter((i) => i.tab === "settings");
    expect(items.map((i) => [i.dot, i.href])).toEqual([["machines", "settings/machines"], ["connectors", "settings/connectors"]]);
    expect(DOT_FILTER.connectors).toBeUndefined();   // the dot opens the entry's address
  });

  it("les autres onglets gardent leur filtre « alertes »", () => {
    expect(DOT_FILTER.backups).toEqual({ alerts: ["on"] });
    expect(DOT_FILTER.dns).toEqual({ alerts: ["on"] });
    expect(DOT_FILTER.network).toEqual({ alert: ["on"] });
    expect(DOT_FILTER.home).toBeUndefined();
  });
});
