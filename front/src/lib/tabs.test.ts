import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { NAV, TAB_IDS, activeNav, navGroups, tabFromHash, visible } from "./tabs";

const fakeLocation = { hash: "" };
Object.defineProperty(globalThis, "location", { value: fakeLocation, configurable: true });

const snap = (over: Record<string, unknown> = {}, meOver: Record<string, unknown> = {}): Snapshot =>
  ({ me: { role: "admin", ...meOver }, backups: null, data: { machine_list: [], hosts: [], services_status: [], containers: [], network: [], virtualization: [], security: [], dns: null, ...over } } as unknown as Snapshot);

describe("lib/tabs", () => {
  it("NAV : quatre groupes, dans l'ordre, Fail2ban rangé sous Sécurité", () => {
    expect(NAV.map((g) => g.id)).toEqual(["overview", "inventory", "protection", "admin"]);
    const prot = NAV.find((g) => g.id === "protection")!.items.map((i) => i.id);
    expect(prot.indexOf("fail2ban")).toBe(prot.indexOf("security") + 1);
    expect(NAV.flatMap((g) => g.items).find((i) => i.id === "fail2ban")?.child).toBe(true);
  });
  it("TAB_IDS reprend chaque onglet une seule fois", () => {
    expect(TAB_IDS).toEqual([...new Set(TAB_IDS)]);
    expect(TAB_IDS).toContain("settings");
  });
  it("visible() cache une entrée sans source", () => {
    expect(visible("dns", snap())).toBe(false);
    expect(visible("dns", snap({ dns: { ok: true } }))).toBe(true);
    expect(visible("infra", snap({}, { version: "dev" }))).toBe(false);   // encore en chantier : masqué hors image de dev, même avec une source
    expect(visible("infra", snap({ services_status: [{ connector: "dockhand" }] }, { version: "prod" }))).toBe(false);
    expect(visible("infra", snap({ services_status: [{ connector: "dockhand" }] }, { version: "dev" }))).toBe(true);
    expect(visible("virtualization", snap())).toBe(false);
    expect(visible("virtualization", snap({ virtualization: [{ id: "pve" }] }))).toBe(true);
    expect(visible("security", snap())).toBe(false);
    expect(visible("security", snap({ security: [{ id: "f2b" }] }))).toBe(true);
    expect(visible("settings", snap())).toBe(true);
  });
  it("navGroups : un débutant ne voit que les pages qui ont du contenu, un groupe vide disparaît", () => {
    const ids = (sn: Snapshot) => navGroups(sn).flatMap((g) => g.items.map((i) => i.id));
    const bare = ids(snap({}, { role: "viewer" }));
    expect(bare).toEqual(["home", "history", "machines", "services", "diagrams"]);
    expect(navGroups(snap({}, { role: "viewer" })).map((g) => g.id)).toEqual(["overview", "inventory"]);
    expect(ids(snap())).toContain("alerts");   // admin: Alertes, Connecteurs, Réglages
    expect(ids(snap())).not.toContain("fail2ban");
    expect(ids(snap({ security: [{ id: "f2b" }] }))).toEqual(expect.arrayContaining(["security", "fail2ban"]));
  });
  it("activeNav : l'entrée la plus précise de l'adresse", () => {
    const g = navGroups(snap({ security: [{ id: "f2b" }] }));
    expect(activeNav("", g)).toBe("home");
    expect(activeNav("#stats", g)).toBe("home");
    expect(activeNav("#history", g)).toBe("history");
    expect(activeNav("#machines/10.0.0.5/access", g)).toBe("machines");
    expect(activeNav("#security", g)).toBe("security");
    expect(activeNav("#security/fail2ban", g)).toBe("fail2ban");
    expect(activeNav("#settings/alerts/rules", g)).toBe("alerts");
    expect(activeNav("#settings/connectors", g)).toBe("connectors");
    expect(activeNav("#settings/api", g)).toBe("settings");
    expect(activeNav("#settingsx", g)).toBe("");
    expect(activeNav("#profile", g)).toBe("");
  });
  it("tabFromHash lit l'adresse (ancien lien, onglet connu, inconnu)", () => {
    fakeLocation.hash = "#dns";
    expect(tabFromHash()).toBe("dns");
    fakeLocation.hash = "#history";
    expect(tabFromHash()).toBe("home");
    fakeLocation.hash = "#settings/api";
    expect(tabFromHash()).toBe("settings");
    fakeLocation.hash = "#inconnu";
    expect(tabFromHash()).toBe("home");
  });
});
