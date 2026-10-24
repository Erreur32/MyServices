import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, savedTheme, toggledTheme } from "./theme";

const store = (v: Record<string, string>) => vi.stubGlobal("localStorage", { getItem: (k: string) => v[k] ?? null });

describe("theme", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("header button: light goes back to the last dark theme, any dark theme to light", () => {
    expect(toggledTheme("light", "night-owl")).toBe("night-owl");
    expect(toggledTheme("ayu-mirage", "ayu-mirage")).toBe("light");
    expect(toggledTheme("dark", "dark")).toBe("light");
  });

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
  });
});
