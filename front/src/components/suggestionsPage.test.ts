import { describe, expect, it } from "vitest";
import { suggestionGroups } from "./DiscoveryCard";

const s = (...ids: string[]) => ids.map((id) => ({ id, state: "suggest" }));

describe("suggestionGroups (cloche de l'en-tête)", () => {
  it("les applis à relier et les autres découvertes sont deux lignes, chacune vers sa page", () => {
    expect(suggestionGroups(s("hosts", "connector:ollama@10.0.0.2", "connector:glances@10.0.0.3", "backups-other"))).toEqual([
      { href: "#settings/connectors/detected", n: 2, apps: true },
      { href: "#settings/discovery", n: 2, apps: false },
    ]);
  });
  it("une seule sorte : une seule ligne", () => {
    expect(suggestionGroups(s("connector:ollama@10.0.0.2"))).toEqual([{ href: "#settings/connectors/detected", n: 1, apps: true }]);
    expect(suggestionGroups(s("hosts"))).toEqual([{ href: "#settings/discovery", n: 1, apps: false }]);
  });
  it("seules les suggestions comptent", () => {
    expect(suggestionGroups([{ id: "connector:x@1.1.1.1", state: "todo" }, { id: "hosts", state: "info" }])).toEqual([]);
    expect(suggestionGroups([])).toEqual([]);
  });
});
