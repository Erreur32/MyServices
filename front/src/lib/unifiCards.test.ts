import { describe, expect, it } from "vitest";
import { applyOrder, cardDefaults, cardLayoutWidth, cardScale, clampHeight, clampSpan, GRID_COLUMNS, MAX_HEIGHT, MIN_HEIGHT, MIN_SPAN, textZoom } from "./cardLayout";
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

describe("zoom des cartes UniFi", () => {
  it("la carte suit la largeur de son cadre : plus large, jamais plus petite", () => {
    expect(cardScale(420, 420, 300)).toBe(1);
    expect(cardScale(630, 420, 300)).toBe(1.5);
    expect(cardScale(210, 420, 300)).toBe(0.5);
    expect(cardScale(5000, 420, 300)).toBe(2);
  });

  it("une hauteur choisie borne le zoom sans le faire reculer quand la carte s'élargit", () => {
    const zoom = (width: number) => cardScale(width, 420, 300, 450);
    expect(zoom(630)).toBe(1.5);
    expect(zoom(1000)).toBe(1.5);
    expect(cardScale(420, 420, 300, 150)).toBe(0.5);
  });

  it("une carte haute reste sous la hauteur maximale, même très élargie", () => {
    expect(660 * cardScale(5000, 420, 660)).toBeCloseTo(MAX_HEIGHT);
  });

  it("la taille par défaut dépend du type de carte", () => {
    expect(cardDefaults("gateway", 10)).toEqual({ span: 4, height: 455 });
    expect(cardDefaults("switch", 12)).toEqual({ span: 4, height: 455 });
    expect(cardDefaults("access_point", 2)).toEqual({ span: 4, height: 420 });
    expect(cardDefaults("access_point", 0)).toEqual({ span: 3, height: 473 });
  });

  it("une hauteur trop petite ne fait pas fondre le zoom", () => {
    expect(cardScale(420, 420, 660, 60)).toBe(0.5);
  });

  it("les textes gardent à peu près leur taille, petite ou grande carte", () => {
    expect(0.5 * textZoom(0.5)).toBeCloseTo(0.95);
    expect(textZoom(1)).toBe(1);
    expect(2 * textZoom(2)).toBeCloseTo(1.05);
  });

  it("avant la première mesure, pas de zoom", () => {
    expect([cardScale(0, 420, 300), cardScale(500, 420, 0)]).toEqual([1, 1]);
  });

  it("les ports tiennent sur deux rangées, même sur un grand switch", () => {
    expect(cardLayoutWidth(0)).toBe(470);
    expect(cardLayoutWidth(2)).toBe(470);
    expect(cardLayoutWidth(8)).toBe(380);
    expect(cardLayoutWidth(24)).toBe(508);
    expect(cardLayoutWidth(48)).toBe(988);
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
    expect(link.filter(([, v]) => v.state === "on")).toHaveLength(7);   // 7 of the 9 ports are up
  });
});
