import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { read, send } from "./api";

/** A fetch that answers when `release()` is called, and counts its calls */
function slowFetch() {
  const calls: string[] = [];
  const waiting: (() => void)[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    calls.push(url);
    return new Promise((resolve) => { waiting.push(() => resolve({ ok: true, status: 200, json: async () => ({ at: calls.length }) })); });
  }));
  return { calls, release: () => waiting.splice(0).forEach((f) => f()) };
}

describe("reads of the API", () => {
  beforeEach(() => { vi.stubGlobal("document", { cookie: "ms_csrf=x" }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("the same read asked twice while it runs is one network call", async () => {
    const f = slowFetch();
    const a = read<{ at: number }>("network/scan"), b = read<{ at: number }>("network/scan"), other = read<{ at: number }>("agents");
    expect(f.calls).toHaveLength(2);   // scan once, agents once
    f.release();
    expect(await a).toEqual(await b);
    await other;
  });

  it("once it has answered, the next read asks again", async () => {
    const f = slowFetch();
    const first = read("system");
    f.release();
    await first;
    const second = read("system");
    expect(f.calls).toHaveLength(2);
    f.release();
    await second;
  });

  it("a write empties the shared reads: nothing read after it can be an answer from before", async () => {
    const f = slowFetch();
    void read("system");
    expect(f.calls).toHaveLength(1);
    void send("POST", "system/mail/test").catch(() => undefined);
    void read("system");
    expect(f.calls.filter((u) => u.includes("api/v1/system?")).length).toBe(2);
    f.release();
  });
});
