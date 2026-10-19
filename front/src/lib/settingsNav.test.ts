import { describe, expect, it } from "vitest";
import { normalizeSection } from "./settingsNav";

describe("normalizeSection", () => {
  it("une ancienne section déménagée dans Réglages", () => {
    expect(normalizeSection("ssh")).toEqual({ section: "api" });
    expect(normalizeSection("sources")).toEqual({ section: "connectors" });
    expect(normalizeSection("agents")).toEqual({ section: "machines" });
  });
  it("une ancienne section devenue une page à part", () => {
    expect(normalizeSection("audit")).toEqual({ redirect: "audit" });
    expect(normalizeSection("logs")).toEqual({ redirect: "logs" });
    expect(normalizeSection("help")).toEqual({ redirect: "help" });
    expect(normalizeSection("about")).toEqual({ redirect: "about" });
  });
  it("Tâches et horaires : panneau d'un autre onglet", () => {
    expect(normalizeSection("tasks")).toEqual({ section: "tasks" });   // Tasks and schedules stays a Settings section
  });
  it("une section inconnue ou toujours à sa place revient telle quelle", () => {
    expect(normalizeSection("machines")).toEqual({ section: "machines" });
    expect(normalizeSection("constructor")).toEqual({ section: "constructor" });
  });
});
