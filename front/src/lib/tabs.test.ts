import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { INVENTORY, TABS, tabFromHash, visible } from "./tabs";

const fakeLocation = { hash: "" };
Object.defineProperty(globalThis, "location", { value: fakeLocation, configurable: true });

const snap = (over: Record<string, unknown> = {}, meOver: Record<string, unknown> = {}): Snapshot =>
  ({ me: { role: "admin", ...meOver }, backups: null, data: { machine_list: [], hosts: [], services_status: [], containers: [], network: [], virtualization: [], security: [], dns: null, ...over } } as unknown as Snapshot);

describe("lib/tabs", () => {
  it("TABS a sept entrées, dans l'ordre", () => {
    expect(TABS.map((t) => t.id)).toEqual(["home", "machines", "services", "network", "dns", "backups", "security"]);
  });
  it("INVENTORY a trois entrées", () => {
    expect(INVENTORY.map((t) => t.id)).toEqual(["infra", "virtualization", "diagrams"]);
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
  it("settings n'est pas dans TABS mais reste reconnu par tabFromHash", () => {
    expect(TABS.some((t) => t.id === "settings")).toBe(false);
    fakeLocation.hash = "#settings/api";
    expect(tabFromHash()).toBe("settings");
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
