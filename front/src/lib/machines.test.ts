import { describe, expect, it } from "vitest";
import { isWindowsMachine } from "./machines";

describe("isWindowsMachine", () => {
  it("réglage « windows » ou système probable", () => {
    expect(isWindowsMachine({ os: "windows" })).toBe(true);
    expect(isWindowsMachine({}, { ttl: 128 })).toBe(true);                          // TTL 128 : Windows probable
    expect(isWindowsMachine({}, { info: { os: "Debian GNU/Linux 13" } })).toBe(false);
    expect(isWindowsMachine({}, { ttl: 64 })).toBe(false);
    expect(isWindowsMachine({})).toBe(false);
  });
  it("machine inconnue (liste pas chargée, machine retirée) : jamais d'erreur, on se fie à l'agent", () => {
    expect(isWindowsMachine(undefined)).toBe(false);
    expect(isWindowsMachine(undefined, undefined, true)).toBe(true);
    expect(isWindowsMachine(undefined, { ttl: 128 })).toBe(false);
  });
});
