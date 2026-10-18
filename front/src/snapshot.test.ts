// The page's refresh is guided by the manifest: at rest one small request, a file read again only when its stamp moved.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSnapshot, loadSnapshot } from "./api";

const DATA = { generated: "2026-10-18 10:00", page: { health_url: "", backups_url: "" }, machine_list: [] };

function server() {
  const stamps: Record<string, string> = { "data.json": "1-10", "pulse.json": "1-5", "live.json": "1-5", "events.json": "1-5" };
  const calls: string[] = [];
  let manifestOk = true;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    calls.push(url);
    const body = (o: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 404, json: async () => o });
    if (url.includes("api/v1/manifest")) return body({ ts: 1, files: { ...stamps } }, manifestOk);   // a fresh document each time, as the server sends it
    if (url.includes("api/v1/me")) return body({ username: "a", role: "admin" });
    if (url.includes("data.json")) return body(DATA);
    if (url.includes("pulse.json")) return body({ ts: Date.now() / 1000, machines: {} });
    if (url.includes("live.json")) return body({ ts: Date.now() / 1000, sources: {} });
    return body({ events: [], labels: {}, severity: {} });
  }));
  return { calls, stamps, breakManifest: () => { manifestOk = false; } };
}

describe("snapshot refresh", () => {
  beforeEach(() => { vi.stubGlobal("document", { cookie: "" }); forgetSnapshot(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reads everything once, then only the manifest while nothing moved, then the one file that moved", async () => {
    const s = server();
    const first = await loadSnapshot();
    expect(s.calls).toHaveLength(6);   // manifest, me, data, pulse, live, events
    const second = await loadSnapshot();
    expect(s.calls.slice(6)).toHaveLength(1);   // the manifest only
    expect(second).toBe(first);                 // the very same object: no render
    s.stamps["pulse.json"] = "2-5";
    const third = await loadSnapshot();
    expect(s.calls.slice(7).map((u) => u.split("?")[0])).toEqual(["/api/v1/manifest", "/pulse.json"]);
    expect(third).not.toBe(first);
    expect(third.data.generated).toBe(DATA.generated);
  });

  it("without a manifest, every file is read again as before", async () => {
    const s = server();
    await loadSnapshot();
    s.breakManifest();
    await loadSnapshot();
    expect(s.calls.slice(6).map((u) => u.split("?")[0])).toEqual(["/api/v1/manifest", "/data.json", "/pulse.json", "/live.json", "/events.json"]);
  });
});
