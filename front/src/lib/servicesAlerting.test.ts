import { describe, expect, it } from "vitest";
import type { Host } from "../types";
import { ALWAYS, serviceKey, type HiddenMap } from "./servicesHidden";
import { alerting } from "../tabs/Services";

const local = (id: string, up: boolean, extra: Partial<Host> = {}): Host =>
  ({ type: "local", id, enabled: true, ip: "10.0.0.1", port: 80, backend: { up }, service: { kind: "docker", name: id }, ...extra }) as unknown as Host;

describe("services « en alerte » (pastille du menu, accueil)", () => {
  it("en panne : oui ; OK : non, même avec une remarque à vérifier", () => {
    expect(alerting(local("down", false), {})).toBe(true);
    expect(alerting(local("fine", true), {})).toBe(false);
    expect(alerting(local("remark", true, { public: { code: 200, cert_days: 3 } } as Partial<Host>), {})).toBe(false);
  });

  it("masqué des alertes : non, même en panne", () => {
    const r = local("down", false);
    const hidden: HiddenMap = { [serviceKey(r)]: { sig: ALWAYS, name: "down", at: 1 } };
    expect(alerting(r, hidden)).toBe(false);
    expect(alerting(r, {})).toBe(true);
  });
});
