import { describe, expect, it } from "vitest";
import type { Data, HealthHost, Host } from "../types";
import { checks, status } from "./status";
import { attention, names } from "./summary";

const NOW = new Date("2026-10-10T12:00:00+02:00").getTime();

function host(h: Partial<Host>): Host {
  return { id: 1, type: "proxy", enabled: true, domains: ["a.lan"], acl: "LAN", ssl: true, ssl_forced: true,
    service: { kind: "docker" }, public: { code: 200 }, backend: { up: true }, machine: "srv", ...h };
}

function data(hosts: Host[], extra: Partial<Data> = {}): Data {
  return {
    generated: "2026-10-10T09:55:00+00:00",
    page: { health_url: "", backups_url: "", stale_min: 75, map: false, links: [] },
    npm_instances: { NPM: "10.0.0.2" }, hosts,
    machine_list: [{ ip: "10.0.0.2", name: "srv", ping: true, off: false, services: 3, npm: 3, down: 0, ssh: { alias: "srv", port: 22, identity: "/k" }, info: {} },
                   { ip: "10.0.0.9", name: "PC", ping: false, off: true, services: 0, npm: 0, down: 0 }],
    ...extra,
  };
}

describe("names", () => {
  it("3 noms au plus, puis le reste", () => {
    expect(names(["a", "b"])).toBe("**a**, **b**");
    expect(names(["a", "b", "c", "d", "e"])).toBe("**a**, **b**, **c** … et 2 autres");
    expect(names(["a", "b", "c", "d"])).toBe("**a**, **b**, **c** … et 1 autre");
  });
});

describe("status / checks (même logique que la page actuelle)", () => {
  it("backend mort = en panne, à corriger", () => {
    const r = host({ backend: { up: false, err: "timeout" }, ip: "10.0.0.2", port: 80 });
    expect(status(r)[0]).toBe("bad");
    expect(checks(r)).toContain("down");
  });
  it("désactivé et backend mort = à nettoyer seulement", () => {
    expect(checks(host({ enabled: false, backend: { up: false } }))).toEqual(["obsolete"]);
  });
  it("sans ACL ni déclaration publique = ouvert", () => {
    expect(checks(host({ acl: undefined }))).toContain("open");
  });
});

describe("accueil", () => {
  it("rien à signaler quand tout va bien", () => {
    const d = data([host({})]);
    expect(attention({ data: d, now: NOW })).toEqual([]);
  });

  it("redémarrage demandé et réécritures orphelines : des lignes d'attention, plus des paragraphes", () => {
    const d = data([host({})]);
    d.dns = { orphans: [{ domain: "vieux.lan" }], servers: {}, rewrites_diff: [], user_rules_diff: [] } as unknown as Data["dns"];
    const items = attention({ data: d, now: NOW, health: { timestamp: "", hosts: [{ id: "srv", name: "srv · prod · 10.0.0.2", reachable: true, level: "ok", reboot_required: true }] } });
    expect(items.map((i) => i.tab).sort()).toEqual(["dns", "machines"]);
    expect(items.find((i) => i.tab === "machines")!.text).toBe("Redémarrage demandé sur **srv · prod**");
    expect(items.find((i) => i.tab === "dns")!.text).toContain("1 réécriture AdGuard orpheline");
  });

  it("pannes, santé et sauvegardes triées par gravité, avec les noms", () => {
    const d = data([host({ domains: ["plex.lan"], backend: { up: false } }), host({ id: 2, domains: ["x.lan"], webcheck: { cert_days: 5 } })]);
    const items = attention({
      data: d, now: NOW,
      health: { timestamp: "", hosts: [{ id: "srv", name: "srv · prod · 10.0.0.77", reachable: true, level: "warn",
        disks: [{ mount: "/", used_pct: 91, warning: true }] }] },
      backups: { generated: "", summary: { ok: 1, warn: 0, crit: 1, sets: 2, hosts: 1, volume: 0, no_offsite: 1 },
        issues: [{ level: "crit", set: "HA", text: "aucune copie hors machine à jour" }] },
    });
    expect(items.map((i) => [i.level, i.tab])).toEqual([
      ["crit", "services"], ["crit", "backups"], ["warn", "services"], ["warn", "machines"]]);
    expect(items[0].text).toBe("**plex.lan** ne répond plus (backend down), sur srv");
    expect(items[3].text).toBe("Santé : **srv · prod** : disque / rempli à 91 %");  // nom avec « · » gardé entier
    expect(items[3].href).toBe("machines/10.0.0.77/watch/disk");   // the link opens on the frame of the trouble
    expect(items[3].fix).toEqual({ label: "Régler", href: "machines/10.0.0.77/settings" });
  });
});

describe("santé sur l'accueil", () => {
  const line = (h: Partial<HealthHost>, machines: { ip: string; name: string; ping: boolean }[] = []) => attention({ data: { ...data([]), machine_list: machines as unknown as Data["machine_list"] }, now: NOW,
    health: { timestamp: "", hosts: [{ id: "a", name: "10.0.0.2 · 10.0.0.2", reachable: true, level: "warn", ...h }] } })[0];

  it("donne le nom de la machine et la cause signalée par le serveur, pas ce qui attend", () => {
    const it0 = line({ checks: { load: "warn" }, load: { available: true, load_1: 8, ncpu: 4 } as HealthHost["load"], apt: { upgradable: 3 } as HealthHost["apt"] }, [{ ip: "10.0.0.2", name: "Tower", ping: true }]);
    expect(it0.text).toBe("Santé : **Tower** : charge 8 pour 4 CPU");
    expect(it0.href).toBe("machines/10.0.0.2/watch/load");
  });

  it("deux causes au plus, le reste compté", () => {
    const disks = ["/", "/a", "/b"].map((mount) => ({ mount, used_pct: 91, warning: true }));
    expect(line({ disks }).text).toBe("Santé : **10.0.0.2** : disque / rempli à 91 %, disque /a rempli à 91 % (+1)");
  });

  it("sans cause connue : la phrase générale et la page de la machine", () => {
    const it0 = line({});
    expect(it0.text).toBe("Santé : **10.0.0.2** est à surveiller");
    expect(it0.href).toBe("machines/10.0.0.2");
  });
});

describe("avertissements de l'accueil", () => {
  const base = () => data([host({})]);
  it("machines en ligne sans SSH : plus une alerte, la ligne est dans « Il manque » (lib/missing.ts)", () => {
    const d = base();
    d.machine_list.push({ ip: "10.0.0.5", name: "nas", ping: true, off: false, services: 0, npm: 0, down: 0 });
    expect(attention({ data: d, now: NOW }).filter((x) => x.tab === "machines")).toEqual([]);
  });
  it("Docker illisible : phrase claire, pas de doublon avec le connecteur", () => {
    const d = base();
    d.connectors = [{ type: "docker", name: "srv", ok: false, message: "ssh: connect timed out" } as never];
    const a = attention({ data: d, now: NOW });
    expect(a.filter((x) => x.text.includes("Docker illisible"))).toHaveLength(1);
    expect(a.some((x) => x.text.startsWith("Connecteur"))).toBe(false);
  });
  it("entrées NPM avec avertissement : une ligne groupée", () => {
    const d = data([host({ id: 1, domains: ["a.lan"], public: { err: "gaierror" } }), host({ id: 2, domains: ["b.lan"], public: { err: "gaierror" } }), host({ id: 3 })]);
    const a = attention({ data: d, now: NOW }).filter((x) => x.text.includes("NPM avec avertissement"));
    expect(a).toHaveLength(1);
    expect(a[0].level).toBe("warn");
    expect(a[0].text).toContain("2 entrées");
  });
});

describe("every attention line leads somewhere", () => {
  it("has a category, a button label and a target (filter or exact address)", () => {
    const d = { generated: "", hosts: [host({ backend: { up: false }, public: { code: 502 } })], machine_list: [{ name: "pc", ip: "10.0.0.2", ping: false, off: false, services: 0, npm: 0, down: 0 }],
      connectors: [{ type: "x", name: "c", ok: false, message: "m" }, { type: "docker", name: "d", ok: false, message: "m" }] } as unknown as Data;
    const got = attention({ data: d, now: NOW, backups: { generated: "", summary: { ok: 0, warn: 0, crit: 1, sets: 1, hosts: 1, volume: 0, no_offsite: 0 }, issues: [{ level: "crit", set: "s", text: "absente" }] } });
    expect(got.length).toBeGreaterThanOrEqual(5);
    expect(got.every((i) => !!i.category && i.action.length > 0 && (!!i.sel || !!i.href || i.tab))).toBe(true);
    expect(got.find((i) => i.category === "machines")?.sel).toEqual({ state: ["down"] });
    expect(got.find((i) => i.text.startsWith("Docker illisible"))?.href).toBe("settings/machines");
    expect(got.find((i) => i.category === "sauvegardes")?.action).toBe("Voir le jeu");
  });
});
