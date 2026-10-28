import { describe, expect, it } from "vitest";
import { suggestionsPage } from "./DiscoveryCard";

const s = (...ids: string[]) => ids.map((id) => ({ id, state: "suggest" }));

describe("suggestionsPage (cloche de l'en-tête)", () => {
  it("les applis à relier ouvrent Connecteurs › Détectés, même avec une autre suggestion en plus", () => {
    expect(suggestionsPage(s("connector:ollama@10.0.0.2", "connector:glances@10.0.0.3"))).toBe("#settings/connectors/detected");
    expect(suggestionsPage(s("hosts", ...Array.from({ length: 17 }, (_, i) => `connector:app${i}@10.0.0.2`)))).toBe("#settings/connectors/detected");
  });
  it("une seule sorte de suggestion ouvre sa page", () => {
    expect(suggestionsPage(s("hosts"))).toBe("#settings/machines/devices");
    expect(suggestionsPage(s("backups-other"))).toBe("#settings/backups");
  });
  it("à égalité, ou sans suggestion, la page Découverte", () => {
    expect(suggestionsPage(s("hosts", "backups-other"))).toBe("#settings/discovery");
    expect(suggestionsPage([])).toBe("#settings/discovery");
    expect(suggestionsPage([{ id: "connector:x@1.1.1.1", state: "todo" }])).toBe("#settings/discovery");
  });
});
