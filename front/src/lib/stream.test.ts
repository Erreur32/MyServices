import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onStream, resetStream, streamConnected } from "./stream";

class FakeSource {
  static last: FakeSource | null = null;
  listeners = new Map<string, (e: { data: string }) => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeSource.last = this; }
  addEventListener(kind: string, f: (e: { data: string }) => void) { this.listeners.set(kind, f); }
  close() { /* nothing */ }
}

describe("event stream", () => {
  beforeEach(() => { vi.stubGlobal("EventSource", FakeSource); resetStream(); });
  afterEach(() => { vi.unstubAllGlobals(); resetStream(); });

  it("opens once, parses each event and tells when it is connected", () => {
    const got: unknown[] = [];
    onStream("manifest", (d) => got.push(d));
    onStream("tasks", (d) => got.push(d));
    const src = FakeSource.last!;
    expect(src.url).toBe("/api/v1/stream");
    expect(streamConnected()).toBe(false);
    src.onopen!();
    expect(streamConnected()).toBe(true);
    src.listeners.get("manifest")!({ data: '{"data.json":"1-2"}' });
    src.listeners.get("manifest")!({ data: "not json" });
    src.listeners.get("tasks")!({ data: '{"collect":{"running":true}}' });
    expect(got).toEqual([{ "data.json": "1-2" }, { collect: { running: true } }]);
    src.onerror!();
    expect(streamConnected()).toBe(false);
  });

  it("an unsubscribed handler is not called any more", () => {
    const got: unknown[] = [];
    const off = onStream("status", (d) => got.push(d));
    off();
    FakeSource.last!.listeners.get("status")!({ data: "{}" });
    expect(got).toEqual([]);
  });
});
