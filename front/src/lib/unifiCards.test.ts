import { describe, expect, it } from "vitest";
import { applyOrder, clampHeight, clampSpan, GRID_COLUMNS, MAX_HEIGHT, MIN_HEIGHT, MIN_SPAN } from "./cardLayout";
import { DEMO_UNIFI_DEVICES } from "./unifiCardsDemo";
import { createMynetworkHass } from "../vendor/unifi-device-card/mynetwork-adapter";

describe("agencement des cartes UniFi", () => {
  it("l'ordre gardé passe devant, les nouveaux appareils suivent dans leur ordre", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(applyOrder(items, ["c", "a"]).map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
    expect(applyOrder(items, []).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("largeur et hauteur restent dans leurs bornes", () => {
    expect([clampSpan(0), clampSpan(5.4), clampSpan(99)]).toEqual([MIN_SPAN, 5, GRID_COLUMNS]);
    expect([clampHeight(1), clampHeight(300.4), clampHeight(5000)]).toEqual([MIN_HEIGHT, 300, MAX_HEIGHT]);
  });
});

describe("données d'exemple des cartes UniFi", () => {
  const { hass, devices } = createMynetworkHass(DEMO_UNIFI_DEVICES, "fr");

  it("une passerelle, un switch et une borne sont affichables", () => {
    expect(devices.map((d) => d.type).sort((a, b) => a.localeCompare(b))).toEqual(["access_point", "gateway", "switch"]);
    expect(devices.find((d) => d.type === "switch")?.exact).toBe(true);   // USWED37 has its own front panel
  });

  it("les ports du switch viennent de la table de ports, avec leur état et leur trafic", () => {
    const sw = devices.find((d) => d.type === "switch")!;
    expect(sw.ports.length).toBeGreaterThanOrEqual(9);   // the model layout may add slots the controller did not list
    const states = (hass as { states: Record<string, { state: string }> }).states;
    const link = Object.entries(states).filter(([k]) => k.includes("aabbcc000002_p") && k.endsWith("_link"));
    expect(link.filter(([, v]) => v.state === "on").length).toBe(7);   // 7 of the 9 ports are up
  });
});
