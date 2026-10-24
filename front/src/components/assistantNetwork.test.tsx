import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { NetHost, NetScan } from "../types";
import { AssistantNetwork, whatIs } from "./AssistantNetwork";

const host = (ip: string, o: Partial<NetHost> = {}): NetHost => ({ ip, name: "", ports: [], hints: [], apps: [], ...o });
const scan = (o: Partial<NetScan>): NetScan => ({ phase: "done", net: "10.0.0.0/24", total: 254, done: 254, up: 4, described: 4, found: [], started: 1, ended: 2, error: null, stopped: false, ...o });
const render = (net: NetScan | null, known: string[] = []) => renderToStaticMarkup(<AssistantNetwork net={net} reload={() => undefined} known={known} onManual={() => undefined} />);

describe("étape réseau de l'assistant", () => {
  it("pas encore cherché : une explication et un seul bouton", () => {
    const html = render(null);
    expect(html).toContain("Lancer la recherche");
    expect(html).toContain("ajouter une machine à la main");
    expect(html).not.toContain("À suivre");
  });

  it("en cours : un pourcentage et un compteur, pas de liste", () => {
    const html = render(scan({ phase: "ping", done: 127, found: [host("10.0.0.5", { name: "nas" })] }));
    expect(html).toContain("Recherche en cours");
    expect(html).toContain("Machines trouvées jusqu");
    expect(html).not.toContain(">nas<");
  });

  it("résultat : un résumé, les machines à suivre, les autres appareils seulement mentionnés", () => {
    const found = [host("10.0.0.2", { name: "srv", ssh_port: 22, hints: ["SSH"] }), host("10.0.0.3", { name: "plex", apps: ["Plex"], hints: ["web :32400"] }),
                   host("10.0.0.4", { name: "camera", hints: ["web :80"] }), host("10.0.0.9", { name: "deja" })];
    const html = render(scan({ found }), ["10.0.0.9"]);
    expect(html).toContain("4 machines trouvées");
    expect(html).toContain("1 déjà suivies");
    expect(html).toContain("2 à suivre");
    for (const t of ["srv", "plex", "Plex", "SSH", "1 autre appareil (caméras", "Machines › Appareils non suivis", "Relancer la recherche"]) expect(html, t).toContain(t);
    expect(html).not.toContain("camera");   // pas dans l'assistant : seulement un ping possible, à ajouter plus tard depuis Découverte
    expect(html).not.toContain("Autres appareils");
    expect(html).toContain("Une machine manque ?");
    expect(html).not.toContain('href="#settings/network"');   // la phrase sur les autres appareils n'est pas un lien (on la prendrait pour un bouton)
    expect(html).not.toContain("deja");     // déjà suivie : pas proposée
  });

  it("un ordinateur qui ne répond qu'au ping est proposé, pas une caméra", () => {
    const found = [host("10.0.0.20", { name: "pc-bureau", os: "windows", os_how: "TTL" }), host("10.0.0.21", { name: "cam", os: "network", hints: ["web :80"] }),
                   host("10.0.0.22", { name: "ampoule" }), host("10.0.0.23", { name: "tel", os: "ios" })];
    const html = render(scan({ found }));
    expect(html).toContain("pc-bureau");
    expect(html).toContain("Windows");
    for (const t of ["cam<", "ampoule", ">tel<"]) expect(html, t).not.toContain(t);
    expect(html).toContain("3 autres appareils");
  });

  it("rien de nouveau : le dit simplement", () => {
    expect(render(scan({ found: [host("10.0.0.9")] }), ["10.0.0.9"])).toContain("rien de nouveau à suivre");
  });

  it("une machine en un mot : l'appli, sinon SSH, sinon la première étiquette", () => {
    expect(whatIs({ apps: ["Plex"], hints: ["SSH"], ssh_port: 22 })).toBe("Plex");
    expect(whatIs({ apps: [], hints: ["SSH"], ssh_port: 22 })).toBe("SSH");
    expect(whatIs({ apps: [], hints: ["web :80"], ssh_port: null })).toBe("web :80");
    expect(whatIs({ apps: [], hints: [], ssh_port: null, os: "linux", os_how: "SSH" })).toBe("Linux");
    expect(whatIs({ apps: [], hints: [], ssh_port: null })).toBe("");
  });
});
