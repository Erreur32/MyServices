import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { NetHost, NetScan } from "../types";
import { AssistantNetwork, whatIs } from "./AssistantNetwork";

const host = (ip: string, o: Partial<NetHost> = {}): NetHost => ({ ip, name: "", ports: [], hints: [], apps: [], ...o });
const scan = (o: Partial<NetScan>): NetScan => ({ phase: "done", net: "10.0.0.0/24", total: 254, done: 254, up: 4, described: 4, found: [], started: 1, ended: 2, error: null, stopped: false, ...o });
const render = (net: NetScan | null, known: string[] = []) => renderToStaticMarkup(<AssistantNetwork net={net} reload={() => undefined} known={known} />);

describe("étape réseau de l'assistant", () => {
  it("pas encore cherché : une explication et un seul bouton", () => {
    const html = render(null);
    expect(html).toContain("Lancer la recherche");
    expect(html).not.toContain("À suivre");
  });

  it("en cours : un pourcentage et un compteur, pas de liste", () => {
    const html = render(scan({ phase: "ping", done: 127, found: [host("10.0.0.5", { name: "nas" })] }));
    expect(html).toContain("Recherche en cours");
    expect(html).toContain("Machines trouvées jusqu");
    expect(html).not.toContain(">nas<");
  });

  it("résultat : un résumé, les machines à suivre, les autres repliées", () => {
    const found = [host("10.0.0.2", { name: "srv", ssh_port: 22, hints: ["SSH"] }), host("10.0.0.3", { name: "plex", apps: ["Plex"], hints: ["web :32400"] }),
                   host("10.0.0.4", { name: "camera", hints: ["web :80"] }), host("10.0.0.9", { name: "deja" })];
    const html = render(scan({ found }), ["10.0.0.9"]);
    expect(html).toContain("4 machines trouvées");
    expect(html).toContain("1 déjà suivies");
    expect(html).toContain("2 à suivre");
    for (const t of ["srv", "plex", "Plex", "SSH", "Autres appareils", "Relancer la recherche"]) expect(html, t).toContain(t);
    expect(html).not.toContain("camera");   // replié : pas dans la page tant qu'on ne l'ouvre pas
    expect(html).not.toContain("deja");     // déjà suivie : pas proposée
  });

  it("rien de nouveau : le dit simplement", () => {
    expect(render(scan({ found: [host("10.0.0.9")] }), ["10.0.0.9"])).toContain("rien de nouveau à suivre");
  });

  it("une machine en un mot : l'appli, sinon SSH, sinon la première étiquette", () => {
    expect(whatIs({ apps: ["Plex"], hints: ["SSH"], ssh_port: 22 })).toBe("Plex");
    expect(whatIs({ apps: [], hints: ["SSH"], ssh_port: 22 })).toBe("SSH");
    expect(whatIs({ apps: [], hints: ["web :80"], ssh_port: null })).toBe("web :80");
    expect(whatIs({ apps: [], hints: [], ssh_port: null })).toBe("");
  });
});
