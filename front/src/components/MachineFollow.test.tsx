import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { send } from "../api";
import { saveFollowed } from "../lib/machineAccess";
import type { Machine } from "../types";
import { FollowAsk, FollowButton, FollowIcon } from "./MachineFollow";

vi.mock("../api", () => ({ read: vi.fn(), send: vi.fn(() => Promise.resolve({ ok: true })) }));

const m = { ip: "10.0.0.16", name: "PapoMint", ping: true, off: false, services: 0, npm: 0, down: 0 } as Machine;
const off = { ...m, disabled: true } as Machine;

describe("ne plus suivre une machine depuis la liste et sa fiche", () => {
  it("demande avant de couper, et dit ce qui s'arrête", () => {
    const html = renderToStaticMarkup(<FollowAsk m={m} onClose={() => undefined} />);
    for (const t of ["PapoMint", "s&#x27;arrêtent", "Ne plus suivre", "Annuler"]) expect(html, t).toContain(t);
  });
  it("propose de reprendre sur une machine non suivie", () => {
    expect(renderToStaticMarkup(<FollowAsk m={off} onClose={() => undefined} />)).toContain("repartent");
    expect(renderToStaticMarkup(<FollowButton m={off} onAsk={() => undefined} />)).toContain("Reprendre le suivi");
    expect(renderToStaticMarkup(<FollowIcon m={off} onAsk={() => undefined} />)).toContain("Reprendre le suivi : PapoMint");
  });
});

describe("saveFollowed", () => {
  beforeEach(() => { vi.mocked(send).mockClear(); });
  it("ne change que ce champ, puis relit cette machine pour retirer sa santé", async () => {
    await saveFollowed("10.0.0.16", false);
    expect(send).toHaveBeenNthCalledWith(1, "PATCH", "machines/settings/10.0.0.16", { fields: { disabled: true } });
    expect(send).toHaveBeenNthCalledWith(2, "POST", "machines/settings/10.0.0.16/refresh");
  });
  it("retire le champ pour reprendre le suivi", async () => {
    await saveFollowed("10.0.0.16", true);
    expect(send).toHaveBeenNthCalledWith(1, "PATCH", "machines/settings/10.0.0.16", { fields: { disabled: null } });
  });
});
