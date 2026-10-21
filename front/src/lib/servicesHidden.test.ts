import { describe, expect, it } from "vitest";
import type { Host } from "../types";
import { isHidden, problemSig, serviceKey } from "./servicesHidden";

const host = (o: Partial<Host>): Host => ({ type: "proxy", id: 12, enabled: true, domains: ["mail.lan"], ...o } as unknown as Host);

describe("services masqués de « À surveiller »", () => {
  it("masqué tant que le problème garde la même signature, de retour s'il change", () => {
    const down = host({ status: "down", alive: false } as Partial<Host>);
    const map = { [serviceKey(down)]: { sig: problemSig(down), name: "mail.lan", at: 0 } };
    expect(isHidden(down, map)).toBe(true);
    const other = host({ status: "ok", alive: true, enabled: false } as Partial<Host>);
    expect(problemSig(other)).not.toBe(problemSig(down));
    expect(isHidden(other, map)).toBe(false);
  });
  it("un service jamais masqué ne l'est pas", () => {
    expect(isHidden(host({}), {})).toBe(false);
  });
});
