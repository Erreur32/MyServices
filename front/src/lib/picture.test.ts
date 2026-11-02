import { afterEach, describe, expect, it, vi } from "vitest";
import { pictureReason, pictureText } from "./picture";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("picture of a camera", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("says the server's reason, or that the tool did not answer", () => {
    expect(pictureText("image refusée (Unauthorized)")).toBe("Image non lue : image refusée (Unauthorized)");
    expect(pictureText(true)).toBe("Image non lue : l'outil n'a pas répondu.");
    expect(pictureText(true, true)).toBe("Flux non lu : l'outil n'a pas répondu.");
  });
  it("reads the reason once more from the same address", async () => {
    const got: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ error: "caméra sans compte caméra" }) })));
    pictureReason("/api/v1/stream/snapshot?camera=a", (r) => got.push(r));
    await flush();
    expect(got).toEqual(["caméra sans compte caméra"]);
  });
  it("keeps quiet when there is no reason or no answer", async () => {
    const got: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ error: 5 }) })));
    pictureReason("/x", (r) => got.push(r));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    pictureReason("/x", (r) => got.push(r));
    await flush();
    expect(got).toEqual([]);
  });
});
