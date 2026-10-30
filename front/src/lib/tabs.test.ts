import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { NAV, TAB_IDS, activeNav, leaves, navGroups, navTrail, tabFromHash, visible } from "./tabs";

const fakeLocation = { hash: "" };
Object.defineProperty(globalThis, "location", { value: fakeLocation, configurable: true });

const snap = (over: Record<string, unknown> = {}, meOver: Record<string, unknown> = {}): Snapshot =>
  ({ me: { role: "admin", ...meOver }, backups: null, data: { machine_list: [], hosts: [], services_status: [], containers: [], network: [], virtualization: [], security: [], dns: null, ...over } } as unknown as Snapshot);

describe("lib/tabs", () => {
  it("NAV : cinq groupes, dans l'ordre ; Fail2ban est une sous-page de Sécurité, Réglages réparti", () => {
    expect(NAV.map((g) => g.id)).toEqual(["overview", "inventory", "protection", "collect", "admin"]);
    const collect = NAV.find((g) => g.id === "collect")!.items;   // what feeds the app, apart from the Administration
    expect(collect.map((i) => i.id)).toEqual(["connectors", "discovery", "tasks"]);
    expect(collect.filter((i) => !i.subs).map((i) => i.hash)).toEqual(["settings/discovery", "settings/tasks"]);   // one page each: the name opens it
    expect(NAV.find((g) => g.id === "admin")!.items.map((i) => i.id)).toEqual(["alerts", "access", "app"]);
    const security = NAV.flatMap((g) => g.items).find((i) => i.id === "security")!;
    expect(security.subs!.map((x) => x.id)).toContain("fail2ban");
    const hashes = NAV.flatMap((g) => g.items.flatMap(leaves)).flatMap((i) => [i.hash, ...(i.also ?? [])]);   // also: Machines settings (buttons of « All machines »), the page of a set (« Sets »)
    for (const sec of ["machines", "connectors", "discovery", "backups", "alerts/channels", "accounts", "api", "machines/ssh", "tasks", "updates", "mail", "export", "requests"])
      expect(hashes).toContain(`settings/${sec}`);
  });
  it("TAB_IDS reprend chaque onglet une seule fois", () => {
    expect(TAB_IDS).toEqual([...new Set(TAB_IDS)]);
    expect(TAB_IDS).toContain("settings");
  });
  it("visible() cache une entrée sans source", () => {
    expect(visible("dns", snap())).toBe(false);
    expect(visible("dns", snap({ dns: { ok: true } }))).toBe(true);
    expect(visible("virtualization", snap())).toBe(false);
    expect(visible("virtualization", snap({ virtualization: [{ id: "pve" }] }))).toBe(true);
    expect(visible("security", snap())).toBe(false);
    expect(visible("security", snap({ security: [{ id: "f2b" }] }))).toBe(true);
    expect(visible("settings", snap())).toBe(true);
  });
  it("navGroups : un débutant ne voit que les pages qui ont du contenu, un groupe vide disparaît", () => {
    const ids = (sn: Snapshot) => navGroups(sn).flatMap((g) => g.items.map((i) => i.id));
    const bare = ids(snap({}, { role: "viewer" }));
    expect(bare).toEqual(["home", "machines", "services"]);   // Schémas et Infra : dev seulement
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
    expect(activeNav("#stats", g)).toBe("home-overview");   // the old Statistics address opens the home page
    expect(activeNav("#history/availability", g)).toBe("history-availability");
    expect(activeNav("#machines/10.0.0.5/access", g)).toBe("machines-list");
    expect(activeNav("#settings/machines", g)).toBe("machines-list");   // the page of its « Add » and « Redetect » buttons
    expect(activeNav("#settings/machines/redetect", g)).toBe("machines-list");
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
    expect(navTrail("#settings/tasks").item?.id).toBe("tasks");   // Collection › Tasks and schedules: a page of its own
    expect(navTrail("#settings/tasks").sub).toBeUndefined();
    expect(navTrail("#settings/updates").item?.id).toBe("app");
    expect(navTrail("#settings/updates").sub?.id).toBe("updates");
    expect(navTrail("#virtualization").item?.id).toBe("virtualization");
    expect(navTrail("#virtualization").sub).toBeUndefined();
    expect(navTrail("#dns/servers").item?.id).toBe("dns");
    expect(navTrail("#dns/servers").sub?.id).toBe("dns-servers");
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
