import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import type { TabId } from "../lib/summary";
import { Tabs } from "./Tabs";

const snap = (over: Record<string, unknown> = {}): Snapshot =>
  ({ me: { role: "admin" }, backups: { issues: [] }, data: {
    machine_list: [{ info: { sshd: true } }], hosts: [], services_status: [], containers: [], network: [{ unifi: {} }], virtualization: [], security: [{ id: "x" }], dns: null, ...over,
  } } as unknown as Snapshot);

describe("Tabs", () => {
  it("six boutons, dans l'ordre", () => {
    const html = renderToStaticMarkup(<Tabs tab="home" snap={snap()} badges={{}} onSelect={() => undefined} />);
    const order = ["Accueil", "Machines", "Services", "Réseau", "Sauvegardes", "Sécurité"].map((l) => html.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it("le bouton Inventaire est toujours proposé (Schémas ne dépend d'aucune source) et porte « Inventaire » quand l'onglet courant n'y est pas", () => {
    const html = renderToStaticMarkup(<Tabs tab="home" snap={snap()} badges={{}} onSelect={() => undefined} />);
    expect(html).toContain("Inventaire");
    expect(html).not.toContain("Inventaire · ");
  });
  it("le bouton Inventaire porte « Inventaire · DNS » quand l'onglet courant est dns", () => {
    const html = renderToStaticMarkup(<Tabs tab={"dns" as TabId} snap={snap({ dns: { ok: true } })} badges={{}} onSelect={() => undefined} />);
    expect(html).toContain("Inventaire · DNS");
  });
});
