import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, savedTheme, THEMES } from "./theme";

const store = (v: Record<string, string>) => vi.stubGlobal("localStorage", { getItem: (k: string) => v[k] ?? null });

describe("theme", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("an unknown saved value falls back to the original dark theme", () => {
    store({ "myservices-theme": "github-dark" });
    expect(savedTheme()).toBe("github-dark");
    store({ "myservices-theme": "solarized" });
    expect(savedTheme()).toBe("dark");
  });

  it("one class per extra dark theme, « light » only for the light one", () => {
    const classes = new Set<string>();
    vi.stubGlobal("document", { documentElement: { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) } } });
    applyTheme("night-owl");
    expect([...classes]).toEqual(["theme-night-owl"]);
    applyTheme("light");
    expect([...classes]).toEqual(["light"]);
    applyTheme("dark");
    expect([...classes]).toEqual([]);
    applyTheme("dracula");
    expect([...classes]).toEqual(["theme-dracula"]);
    expect(THEMES).toEqual(expect.arrayContaining(["one-dark", "nord", "dracula"]));
  });
});
