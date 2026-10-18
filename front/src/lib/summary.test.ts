import { describe, expect, it } from "vitest";
import type { Data, Host } from "../types";
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
      health: { timestamp: "", hosts: [{ id: "srv", name: "srv · prod · 10.0.0.2", reachable: true, level: "warn",
        disks: [{ mount: "/", used_pct: 91, warning: true }] }] },
      backups: { generated: "", summary: { ok: 1, warn: 0, crit: 1, sets: 2, hosts: 1, volume: 0, no_offsite: 1 },
        issues: [{ level: "crit", set: "HA", text: "aucune copie hors machine à jour" }] },
    });
    expect(items.map((i) => [i.level, i.tab])).toEqual([
      ["crit", "services"], ["crit", "backups"], ["warn", "services"], ["warn", "machines"]]);
    expect(items[0].text).toBe("**plex.lan** ne répond plus (backend down), sur srv");
    expect(items[3].text).toBe("Santé : **srv · prod** est à surveiller (disque / à 91 %)");  // nom avec « · » gardé entier
  });
});

describe("avertissements de l'accueil", () => {
  const base = () => data([host({})]);
  it("machines en ligne sans SSH : une seule ligne orange, sans la box ni l'éteinte", () => {
    const d = base();
    d.machine_list.push({ ip: "10.0.0.5", name: "nas", ping: true, off: false, services: 0, npm: 0, down: 0 },
      { ip: "10.0.0.1", name: "box", ping: true, off: false, gateway: true, services: 0, npm: 0, down: 0 });
    const a = attention({ data: d, now: NOW }).filter((x) => x.level === "warn" && x.tab === "machines");
    expect(a).toHaveLength(1);
    expect(a[0].text).toContain("nas");
    expect(a[0].text).not.toContain("box");
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
