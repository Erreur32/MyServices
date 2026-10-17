import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { Assistant } from "./Assistant";

const mem = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
  configurable: true,
});

Object.defineProperty(globalThis, "location", { value: { hostname: "serveur.lan" }, configurable: true });   // la page n'est pas ouverte par l'adresse d'une machine

const snap = {
  me: { username: "admin", role: "admin" },
  data: { machine_list: [{ ip: "10.0.0.1", name: "passerelle", ping: true, services: 0 }, { ip: "10.0.0.2", name: "srv", ping: true, local: true, services: 3, info: { apache: true } }], hosts: [{ machine: "srv", app: { label: "Plex" } }] },
} as unknown as Snapshot;

describe("Assistant de démarrage", () => {
  beforeEach(() => mem.clear());

  it("étape 1 : bienvenue, trois principes, compte, cinq étapes en haut", () => {
    const html = renderToStaticMarkup(<Assistant snap={snap} />);
    for (const t of ["Bienvenue sur MyServices", "Il lit, il ne modifie rien", "Compte administrateur", "admin", "Étape 1 sur 5", "Cette machine", "Relier vos outils", "Continuer"]) expect(html, t).toContain(t);
    expect(html).not.toContain("Retour");   // pas de retour depuis la première étape
    expect(html).not.toContain("Passer cette étape");   // bienvenue n'a rien à régler : seulement « Continuer »
  });

  it("étape 2 : la machine qui héberge, ses services et ses applis, sans SSH", () => {
    mem.set("myservices-assistant", JSON.stringify({ current: "machine", done: ["welcome"], skipped: [] }));
    const html = renderToStaticMarkup(<Assistant snap={snap} />);
    for (const t of ["Étape 2 sur 5", "srv", "10.0.0.2", "3 services trouvés", "Plex", "Apache", "Retour"]) expect(html, t).toContain(t);
  });

  it("étape 5 : les outils, avec Continuer et Passer (plus d'étape d'alertes : elle viendra plus tard)", () => {
    for (const [step, title] of [["tools", "Relier vos outils"]]) {
      mem.set("myservices-assistant", JSON.stringify({ current: step, done: [], skipped: [] }));
      const html = renderToStaticMarkup(<Assistant snap={snap} />);
      expect(html, step).toContain(title);
      expect(html, step).toContain("Passer");
      expect(html, step).not.toContain("arrive bientôt");
    }
  });

  it("dernière étape : « Terminer » à la place de « Continuer »", () => {
    mem.set("myservices-assistant", JSON.stringify({ current: "tools", done: ["welcome"], skipped: [] }));
    const html = renderToStaticMarkup(<Assistant snap={snap} />);
    expect(html).toContain("Terminer");
    expect(html).not.toContain("Continuer");
  });

  it("ne plante pas avec une progression d'un serveur plus ancien, sans le champ « accepted »", () => {
    for (const step of ["welcome", "machine", "access", "tools"]) {   // « network » lit le scan par un abonnement qui ne se rend pas hors navigateur
      mem.set("myservices-assistant", JSON.stringify({ current: step, done: [], skipped: [] }));   // ni host ni accepted
      expect(() => renderToStaticMarkup(<Assistant snap={snap} />), step).not.toThrow();
    }
  });

  it("le résumé n'apparaît qu'une fois toutes les étapes faites ou passées", () => {
    mem.set("myservices-assistant", JSON.stringify({ current: "tools", done: ["welcome"], skipped: [] }));
    expect(renderToStaticMarkup(<Assistant snap={snap} />)).not.toContain("Vous avez fait le tour");
  });

  it("sans machine identifiable, ne montre pas la première au hasard et demande laquelle", () => {
    mem.set("myservices-assistant", JSON.stringify({ current: "machine", done: [], skipped: [] }));
    const unknown = { ...snap, data: { machine_list: [{ ip: "10.0.0.1", name: "passerelle" }, { ip: "10.0.0.5", name: "autre" }], hosts: [] } } as unknown as Snapshot;
    const html = renderToStaticMarkup(<Assistant snap={unknown} />);
    expect(html).toContain("Choisissez-la");
    expect(html).not.toContain("services trouvés");
  });

  it("aucune machine détectée : un message au lieu d'une page vide", () => {
    mem.set("myservices-assistant", JSON.stringify({ current: "machine", done: [], skipped: [] }));
    const empty = { ...snap, data: { machine_list: [], hosts: [] } } as unknown as Snapshot;
    expect(renderToStaticMarkup(<Assistant snap={empty} />)).toContain("Aucune machine détectée");
  });
});
