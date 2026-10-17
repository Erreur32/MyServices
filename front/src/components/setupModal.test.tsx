import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { SetupModal, type Setup } from "./SetupModal";

Object.defineProperty(globalThis, "location", { value: { origin: "http://10.0.0.2:8090" }, configurable: true });   // pas de navigateur dans les tests

const snap = { data: { hosts: [], proposals: [] } } as unknown as Snapshot;
const render = (setup: Setup) => renderToStaticMarkup(<SetupModal setup={setup} snap={snap} onClose={() => undefined} onSwitch={() => undefined} />);

describe("fenêtre de réglage de l'assistant", () => {
  it("canal d'alerte : le formulaire des Réglages, dans une fenêtre", () => {
    const html = render({ kind: "channel" });
    expect(html).toContain("Ajouter un canal d");
    expect(html).toContain("<dialog open");   // the window is a real dialog element
  });

  it("agent : le composant d'installation partagé avec la page Agents, choix Windows / Linux compris", () => {
    const html = render({ kind: "agent", ip: "10.0.0.5", name: "pc", agent: "windows" });
    for (const t of ["Installer l&#x27;agent sur", "pc", "10.0.0.5", "Windows", "Linux", "Créer l&#x27;agent"]) expect(html, t).toContain(t);
  });

  it("aucune fenêtre ne contient de lien qui sorte de la page", () => {
    for (const s of [{ kind: "channel" }, { kind: "agent", ip: "10.0.0.5", name: "pc", agent: "linux" }, { kind: "connector", ip: "10.0.0.5", name: "pc" }] as Setup[]) {
      expect(render(s), s.kind).not.toMatch(/href="#settings/);
    }
  });
});
