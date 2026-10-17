import { describe, expect, it } from "vitest";
import { changes, interesting, needsLink, osOf, quiet, summarize, tagsOf, viaMynetwork } from "./netScan";

const labels = (h: { hints: string[]; apps: string[] }) => tagsOf(h).map((t) => t.label);

describe("tagsOf", () => {
  it("l'appli reconnue remplace l'indice de port du même nom", () => {
    expect(labels({ hints: ["SSH", "Proxmox", "partage SMB"], apps: ["Proxmox VE"] })).toEqual(["Proxmox VE", "SSH", "partage SMB"]);
  });
  it("pas deux fois le même nom, casse comprise", () => {
    expect(labels({ hints: ["Home Assistant", "Plex"], apps: ["Home Assistant", "Plex"] })).toEqual(["Home Assistant", "Plex"]);
    expect(labels({ hints: ["web", "Web"], apps: [] })).toEqual(["web"]);
  });
  it("deux noms qui se ressemblent seulement par le début ne sont pas confondus", () => {
    expect(labels({ hints: ["SSH"], apps: ["SSHwifty"] })).toEqual(["SSHwifty", "SSH"]);
  });
  it("nature de l'étiquette", () => {
    expect(tagsOf({ hints: ["SSH", "web"], apps: ["Plex"] }).map((t) => t.kind)).toEqual(["app", "ssh", "port"]);
  });
  it("machine sans rien : aucune étiquette", () => {
    expect(tagsOf({ hints: [], apps: [] })).toEqual([]);
  });
});

describe("interesting", () => {
  it("SSH, appli reconnue ou service autre que web : à pré-sélectionner", () => {
    expect(interesting({ ssh_port: 22232, hints: ["SSH :22232"], apps: [] })).toBe(true);
    expect(interesting({ hints: [], apps: ["Plex"] })).toBe(true);
    expect(interesting({ hints: ["partage SMB"], apps: [] })).toBe(true);
    expect(interesting({ hints: ["Windows (RDP)"], apps: [] })).toBe(true);
  });
  it("un objet connecté (page web seule) ou un port sans nom : non", () => {
    expect(interesting({ hints: ["web"], apps: [] })).toBe(false);
    expect(interesting({ hints: ["web :80", "web :443"], apps: [] })).toBe(false);
    expect(interesting({ hints: ["port 5000"], apps: [] })).toBe(false);
    expect(interesting({ hints: [], apps: [] })).toBe(false);
  });
});

describe("changes", () => {
  it("rien à comparer à la première recherche", () => {
    expect(changes({ found: [{ ip: "1" }] })).toBeNull();
    expect(changes({ found: [{ ip: "1" }], previous: [] })).toBeNull();
  });
  it("nouvelles et disparues", () => {
    const c = changes({ found: [{ ip: "1" }, { ip: "2" }], previous: ["1", "3"], gone: ["3"] });
    expect([...c!.fresh]).toEqual(["2"]);
    expect(c!.gone).toEqual(["3"]);
  });
});

describe("quiet", () => {
  it("sans aucune étiquette : à ranger dans le bloc replié", () => {
    expect(quiet({ hints: [], apps: [] })).toBe(true);
    expect(quiet({ hints: ["web :80"], apps: [] })).toBe(false);
    expect(quiet({ hints: [], apps: ["Plex"] })).toBe(false);
  });
});

describe("needsLink", () => {
  const ha = { ip: "10.0.0.8", apps: ["Home Assistant"], ssh_port: 22232 };
  it("Home Assistant sans connecteur : jeton à régler (jamais SSH, même si un port SSH répond)", () => {
    expect(needsLink(ha, [{ ip: "10.0.0.8" }], [])).toBe("ha");
    expect(needsLink(ha, [{ ip: "10.0.0.8" }], [{ connector: "home-assistant", url: "http://10.0.0.8:8123" }])).toBeNull();
    expect(needsLink(ha, [], [{ connector: "home-assistant", url: "http://10.0.0.9:8123" }])).toBe("ha");
  });
  it("machine en SSH sans accès réglé : clé à préparer", () => {
    const h = { ip: "10.0.0.5", apps: [], ssh_port: 22 };
    expect(needsLink(h, [{ ip: "10.0.0.5", ssh: null }], [])).toBe("ssh");
    expect(needsLink(h, [{ ip: "10.0.0.5", ssh: { alias: "m-5" } }], [])).toBeNull();
  });
  it("machine sans SSH : rien à régler", () => {
    expect(needsLink({ ip: "10.0.0.6", apps: [] }, [{ ip: "10.0.0.6" }], [])).toBeNull();
  });
});

describe("summarize", () => {
  const h = (ip: string, hints: string[], apps: string[] = [], ssh_port: number | null = null) => ({ ip, hints, apps, ssh_port });
  const found = [
    h("1", ["SSH :22232", "partage SMB"], [], 22232),   // à regarder : SSH + partage
    h("2", ["web :80"], ["Plex"]),                      // à regarder : appli
    h("3", ["Windows (RDP)"]),                          // à regarder : bureau à distance
    h("4", ["web :80"]), h("5", ["web :443"]),          // replié : web seul (caméras…)
    h("6", []), h("7", []),                             // replié : ping seulement
    h("8", ["SSH"], [], 22),                            // déjà ajoutée
  ];
  it("compte ce qui est à regarder et ce qui est replié", () => {
    expect(summarize(found, ["8"])).toEqual({ total: 8, known: 1, candidates: 7, watch: 3, ssh: 1, apps: 1, shares: 2, webOnly: 2, pingOnly: 2 });
  });
  it("rien trouvé", () => {
    expect(summarize([], [])).toEqual({ total: 0, known: 0, candidates: 0, watch: 0, ssh: 0, apps: 0, shares: 0, webOnly: 0, pingOnly: 0 });
  });
  it("tout est replié quand rien n'est intéressant (réseau de caméras)", () => {
    const s = summarize([h("1", ["web :80"]), h("2", ["web :80"])], []);
    expect([s.watch, s.webOnly]).toEqual([0, 2]);
  });
});

describe("viaMynetwork (UniFi)", () => {
  it("reconnu par l'appli, le nom ou le titre de la page (anciens scans compris)", () => {
    expect(viaMynetwork({ apps: ["UniFi"] })).toBe(true);
    expect(viaMynetwork({ name: "unifi", apps: [] })).toBe(true);
    expect(viaMynetwork({ name: "UDM-Pro", apps: [] })).toBe(true);
    expect(viaMynetwork({ title: "UniFi Network", apps: [] })).toBe(true);
    expect(viaMynetwork({ name: "gamer32", apps: ["Plex"] })).toBe(false);
  });
  it("ne demande aucun accès SSH, même avec un port SSH ouvert", () => {
    const u = { ip: "10.0.0.1", name: "unifi", ssh_port: 22, apps: [] };
    expect(needsLink(u, [{ ip: "10.0.0.1", ssh: null }], [])).toBeNull();
  });
});

describe("osOf", () => {
  it("donne le système probable et l'indice, rien s'il est inconnu", () => {
    expect(osOf({ os: "linux", os_how: "SSH", hints: ["SSH"] })).toEqual({ label: "Linux", how: "SSH" });
    expect(osOf({ os: null, hints: [] })).toBeNull();
  });
  it("pas de doublon avec « Windows (RDP) »", () => {
    expect(osOf({ os: "windows", os_how: "ports", hints: ["Windows (RDP)"] })).toBeNull();
  });
});

import { worthFollowing } from "./netScan";

describe("machines à proposer dans l'assistant", () => {
  const h = (o = {}) => ({ hints: [] as string[], apps: [] as string[], ...o });
  it("un vrai ordinateur compte même sans rien d'ouvert", () => {
    for (const os of ["windows", "linux", "macos"]) expect(worthFollowing(h({ os })), os).toBe(true);
  });
  it("caméras, objets connectés, téléphones et matériel réseau sont écartés", () => {
    for (const os of ["network", "ios", null, undefined]) expect(worthFollowing(h({ os, hints: ["web :80"] })), String(os)).toBe(false);
  });
  it("SSH ou appli reconnue comptent toujours", () => {
    expect(worthFollowing(h({ ssh_port: 22 }))).toBe(true);
    expect(worthFollowing(h({ apps: ["Plex"] }))).toBe(true);
  });
});
