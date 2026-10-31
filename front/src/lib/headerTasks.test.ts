import { afterEach, describe, expect, it, vi } from "vitest";
import { inHeader, orbLook, shownTasks, taskColor } from "./headerTasks";

const storage = (kept: Record<string, string>) => vi.stubGlobal("localStorage", { getItem: (k: string) => kept[k] ?? null });

describe("tasks shown in the header", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows the collection and the network search unless told otherwise", () => {
    storage({});
    expect(["collect", "netscan", "health", "watch", "backups"].map(inHeader)).toEqual([true, true, false, false, false]);
  });

  it("follows the choice kept in this browser", () => {
    storage({ "ms.header.collect": "0", "ms.header.health": "1" });
    expect([inHeader("collect"), inHeader("health")]).toEqual([false, true]);
  });

  it("falls back on the default when the storage is refused", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect([inHeader("collect"), inHeader("health")]).toEqual([true, false]);
  });

  it("puts the collection first, skips a task left out and names a task once", () => {
    const st = { running: true, progress: null, tasks: ["netscan", "health", "backups"] };
    storage({ "ms.header.health": "1", "ms.header.backups": "1" });
    expect(shownTasks(st)).toEqual(["collect", "netscan", "health", "backups"]);
    expect(shownTasks({ ...st, running: false, tasks: ["health"] })).toEqual(["health"]);
    storage({ "ms.header.collect": "0", "ms.header.backups": "1" });
    expect(shownTasks({ ...st, tasks: ["health", "backups"] })).toEqual(["backups"]);
    storage({});
    expect(shownTasks({ ...st, running: false, tasks: ["health"] })).toEqual([]);
    expect(shownTasks(null)).toEqual([]);
  });

  it("gives each task its own token of the theme", () => {
    const tokens = ["collect", "netscan", "watch", "health", "backups"].map(taskColor);
    expect(new Set(tokens).size).toBe(5);
    expect(taskColor("collect")).toBe("rgb(var(--link))");
    expect(taskColor("unknown")).toBe("rgb(var(--link))");
  });

  it("hands the orb the colour and the brightness of the theme in use, not of the system", () => {
    vi.stubGlobal("document", { documentElement: { classList: { contains: (c: string) => c === "light" } } });
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (n: string) => (n === "--apache" ? " 147 84 220" : "") }));
    expect(orbLook("netscan")).toEqual({ color: "rgb(147, 84, 220)", theme: "light" });
  });
});
