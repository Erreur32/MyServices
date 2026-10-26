import { afterEach, describe, expect, it, vi } from "vitest";
import { HEADER_LOGOS, applyFavicon, savedLogo, setHeaderLogo } from "./theme";

/** A page with its favicon link and a browser storage, without a DOM (the tests run in node) */
function fakePage(saved: string | null) {
  const link = { href: "/favicon.svg" };
  const store: Record<string, string> = saved === null ? {} : { "myservices-header-logo": saved };
  vi.stubGlobal("document", { querySelector: (sel: string) => (sel === 'link[rel="icon"]' ? link : null) });
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
  return { link, store };
}
afterEach(() => vi.unstubAllGlobals());

describe("logo de l'application", () => {
  it("la grille sans fond est le premier choix et celui par défaut ; un choix enregistré est gardé", () => {
    expect(HEADER_LOGOS[0].id).toBe("grid");
    fakePage(null);
    expect(savedLogo()).toBe("grid");
    fakePage("favicon");
    expect(savedLogo()).toBe("favicon");
    fakePage("nonsense");
    expect(savedLogo()).toBe("grid");
  });

  it("l'icône de l'onglet suit le logo choisi, au démarrage et à chaque changement", () => {
    const { link, store } = fakePage(null);
    applyFavicon();
    expect(link.href).toMatch(/logo-grid\.svg$/);
    setHeaderLogo("favicon");
    expect(link.href).toMatch(/\/favicon\.svg$/);
    expect(store["myservices-header-logo"]).toBe("favicon");
    setHeaderLogo("grid");
    expect(link.href).toMatch(/logo-grid\.svg$/);
  });

  it("sans stockage (navigation privée refusée), le défaut sans planter", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); } });
    expect(savedLogo()).toBe("grid");
  });
});
