import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Host } from "../types";
import { isHidden, problemSig, serviceKey, setServiceHidden } from "./servicesHidden";

const api = vi.hoisted(() => ({ read: vi.fn(), send: vi.fn() }));
vi.mock("../api", () => api);

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

describe("masquer ou réafficher un service", () => {
  beforeEach(() => { api.read.mockReset().mockResolvedValue({}); api.send.mockReset().mockResolvedValue({ ok: true }); });
  it("envoie la clé, la signature du problème et le choix au serveur", async () => {
    const down = host({ status: "down", alive: false } as Partial<Host>);
    await setServiceHidden(down, "mail.lan", true);
    expect(api.send).toHaveBeenCalledWith("POST", "services/watch-hidden", { key: serviceKey(down), sig: problemSig(down), name: "mail.lan", hidden: true });
    await setServiceHidden(down, "mail.lan", false);
    expect(api.send).toHaveBeenLastCalledWith("POST", "services/watch-hidden", expect.objectContaining({ hidden: false }));
    expect(api.read).not.toHaveBeenCalled();
  });
  it("refusé par le serveur : relit ce qu'il garde", async () => {
    api.send.mockRejectedValue(new Error("403"));
    await setServiceHidden(host({}), "mail.lan", true);
    expect(api.read).toHaveBeenCalledWith("services/watch-hidden");
  });
});
