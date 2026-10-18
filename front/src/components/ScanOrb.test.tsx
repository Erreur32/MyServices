import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setScan } from "../lib/scan";
import { ScanOrb } from "./ScanOrb";

describe("orbe de l'en-tête", () => {
  it("n'affiche rien quand aucun passage ne tourne", () => {
    setScan(null);
    expect(renderToStaticMarkup(<ScanOrb />)).toBe("");
    setScan({ running: false, progress: null });
    expect(renderToStaticMarkup(<ScanOrb />)).toBe("");
  });

  it("annonce la collecte et son étape pendant qu'elle tourne", () => {
    setScan({ running: true, progress: { step: 3, steps: 9, label: "ping des machines", done: null, total: null } });
    const html = renderToStaticMarkup(<ScanOrb />);
    expect(html).toContain("Collecte en cours");
    expect(html).toContain("3/9 · ping des machines");
    expect(html).toContain('role="status"');
    setScan(null);
  });

  it("annonce aussi la recherche réseau", () => {
    setScan({ running: false, progress: null, network: { running: true, phase: "identify", done: 0, total: 0, up: 3, described: 1, found: 3 } });
    expect(renderToStaticMarkup(<ScanOrb />)).toContain("Recherche réseau en cours");
    setScan(null);
  });
});
