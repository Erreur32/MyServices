import { describe, expect, it } from "vitest";
import { changes, interesting, quiet, tagsOf } from "./netScan";

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
