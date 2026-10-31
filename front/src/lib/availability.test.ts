import { describe, expect, it } from "vitest";
import { rootDomain, rowKind } from "./availability";

const row = (kind: "service" | "machine" | "kuma", label: string | null, target: string | null = null) => ({ kind, label, target });

describe("availability rows", () => {
  it("calls a service reached by its domain a domain", () => {
    expect(rowKind(row("service", "photos.exemple.fr", "10.0.0.5:80"))).toBe("domain");
    expect(rowKind(row("service", "Paperless", "10.0.0.5:8000"))).toBe("service");
    expect(rowKind(row("service", "10.0.0.5"))).toBe("service");
    expect(rowKind(row("machine", "serveur.lan"))).toBe("machine");
  });

  it("finds the domain of a row, in its name or its target", () => {
    expect(rootDomain(row("service", "a.b.Exemple.fr"))).toBe("exemple.fr");
    expect(rootDomain(row("kuma", "Ma sonde", "photos.exemple.fr"))).toBe("exemple.fr");
    expect(rootDomain(row("machine", "routeur", "10.0.0.1"))).toBe("");
  });
});
