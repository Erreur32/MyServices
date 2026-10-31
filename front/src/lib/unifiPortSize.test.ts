import { beforeAll, describe, expect, it, vi } from "vitest";

type Card = { offsetWidth: number; _config: unknown; _ctx: unknown; _effectivePortSize: () => number };
let Element: new () => Card;

// No DOM in these tests: the class is taken as the file registers it
beforeAll(async () => {
  vi.stubGlobal("HTMLElement", class { attachShadow() { return {}; } });
  vi.stubGlobal("customElements", { get: () => undefined, define: (name: string, c: new () => Card) => { if (name === "unifi-device-card") Element = c; } });
  vi.stubGlobal("window", { customCards: [] });
  await import("../vendor/unifi-device-card/unifi-device-card.js");
});

describe("taille des ports d'une carte UniFi", () => {
  const card = (width: number, fit = true) => {
    const el = new Element();
    Object.defineProperty(el, "offsetWidth", { value: width });
    el._config = { port_size_fit: fit };
    el._ctx = { layout: { rows: [[1, 2, 3, 4, 5, 6, 7, 8]], specialSlots: [{ port: 9, row: 0 }] } };
    return el;
  };

  it("les ports suivent la largeur de la carte, entre 24 et 52 px", () => {
    expect(card(380)._effectivePortSize()).toBe(34);   // 9 slots in 340 px
    expect(card(600)._effectivePortSize()).toBe(52);
    expect(card(150)._effectivePortSize()).toBe(24);
  });

  it("sans l'option, ou avant la première mesure, la taille reste celle du réglage", () => {
    expect(card(380, false)._effectivePortSize()).toBe(36);
    expect(card(0)._effectivePortSize()).toBe(36);
  });
});
