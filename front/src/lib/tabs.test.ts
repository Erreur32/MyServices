import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { NAV, TAB_IDS, activeNav, navGroups, navTrail, tabFromHash, visible } from "./tabs";

const fakeLocation = { hash: "" };
Object.defineProperty(globalThis, "location", { value: fakeLocation, configurable: true });

const snap = (over: Record<string, unknown> = {}, meOver: Record<string, unknown> = {}): Snapshot =>
  ({ me: { role: "admin", ...meOver }, backups: null, data: { machine_list: [], hosts: [], services_status: [], containers: [], network: [], virtualization: [], security: [], dns: null, ...over } } as unknown as Snapshot);

describe("lib/tabs", () => {
  it("NAV : quatre groupes, dans l'ordre ; Fail2ban est une sous-page de Sécurité, Réglages réparti", () => {
    expect(NAV.map((g) => g.id)).toEqual(["overview", "inventory", "protection", "admin"]);
    const security = NAV.flatMap((g) => g.items).find((i) => i.id === "security")!;
    expect(security.subs!.map((x) => x.id)).toContain("fail2ban");
    const hashes = NAV.flatMap((g) => g.items.flatMap((i) => i.subs ?? [i])).map((i) => i.hash);
    for (const sec of ["machines", "connectors", "network", "backups", "alerts/channels", "accounts", "api", "ssh", "tasks", "updates", "mail", "export", "requests"])
      expect(hashes).toContain(`settings/${sec}`);
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
    expect(ids(snap())).toEqual(expect.arrayContaining(["alerts", "connectors", "access", "app"]));   // admin: Alertes and the Administration
    const subs = (sn: Snapshot, id: string) => navGroups(sn).flatMap((g) => g.items).find((i) => i.id === id)?.subs?.map((x) => x.id);
    expect(subs(snap({ security: [{ id: "f2b" }] }), "security")).toContain("fail2ban");
    expect(subs(snap({ machine_list: [{ info: { sshd: true } }] }), "security")).not.toContain("fail2ban");
    const viewer = navGroups(snap({}, { role: "viewer" })).flatMap((g) => g.items).find((i) => i.id === "machines")!;
    expect(viewer.subs).toBeUndefined();   // only « Toutes les machines » left: a plain link
    expect(viewer.hash).toBe("machines");
  });
  it("activeNav : l'entrée la plus précise de l'adresse", () => {
    const g = navGroups(snap({ security: [{ id: "f2b" }], machine_list: [{ info: { sshd: true } }] }));
    expect(activeNav("", g)).toBe("home-overview");
    expect(activeNav("#home", g)).toBe("home-overview");
    expect(activeNav("#stats", g)).toBe("home-stats");
    expect(activeNav("#history/availability", g)).toBe("history-availability");
    expect(activeNav("#machines/10.0.0.5/access", g)).toBe("machines-list");
    expect(activeNav("#settings/machines", g)).toBe("machines-add");
    expect(activeNav("#settings/machines/agents", g)).toBe("machines-agents");
    expect(activeNav("#security/fail2ban", g)).toBe("fail2ban");
    expect(activeNav("#settings/alerts/notifications", g)).toBe("alerts-notifications");
    expect(activeNav("#settings/connectors", g)).toBe("connectors-mine");
    expect(activeNav("#settings/connectors/available", g)).toBe("connectors-available");
    expect(activeNav("#settings/requests/audit", g)).toBe("audit");
    expect(activeNav("#about", g)).toBe("about");
    expect(activeNav("#settingsx", g)).toBe("");
    expect(activeNav("#profile", g)).toBe("");
  });
  it("navTrail : l'entrée et la sous-page d'une adresse (titre de page)", () => {
    expect(navTrail("#settings/tasks").item?.id).toBe("app");
    expect(navTrail("#settings/tasks").sub?.id).toBe("tasks");
    expect(navTrail("#dns").item?.id).toBe("dns");
    expect(navTrail("#dns").sub).toBeUndefined();
    expect(navTrail("#profile")).toEqual({});
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
