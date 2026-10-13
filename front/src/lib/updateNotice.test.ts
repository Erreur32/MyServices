import { beforeEach, describe, expect, it, vi } from "vitest";
import { dismissTag, dismissedTag, forgetDismissed } from "./updateNotice";

describe("update notice", () => {
  beforeEach(() => {   // node test environment: a small in-memory localStorage
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
  });
  it("hides one version, then shows again once forgotten", () => {
    expect(dismissedTag()).toBe("");
    dismissTag("v0.12.0");
    expect(dismissedTag()).toBe("v0.12.0");
    forgetDismissed();
    expect(dismissedTag()).toBe("");
  });
  it("never fails when the browser refuses storage", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } });
    expect(dismissedTag()).toBe("");
    expect(() => { dismissTag("v1"); forgetDismissed(); }).not.toThrow();
  });
});
