import { describe, expect, it } from "vitest";
import { savedFor } from "../tabs/Connectors";
import type { ConnectorInstance, Proposal } from "../types";

const inst = (type: string, url: string) => ({ type, label: type, name: type, config: { url }, set: {}, enabled: false }) as unknown as ConnectorInstance;
const p = { connector: "arcane", label: "Arcane", ip: "10.0.0.6", url: "http://10.0.0.6:3552" } as Proposal;

describe("savedFor: a detected service hidden as soon as its connector is saved", () => {
  it("same type and address in its settings, even switched off", () => expect(savedFor(p, [inst("arcane", "http://10.0.0.6:3552")])).toBe(true));
  it("another type or another machine keeps the row", () => {
    expect(savedFor(p, [inst("dockhand", "http://10.0.0.6:3998")])).toBe(false);
    expect(savedFor(p, [inst("arcane", "http://10.0.0.5:3552")])).toBe(false);
  });
});
