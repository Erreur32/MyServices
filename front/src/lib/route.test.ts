import { describe, expect, it } from "vitest";
import { pageViewTarget, routeView } from "./route";

const VIEWS = ["events", "availability"] as const;

describe("routeView", () => {
  it("reads the view named after the page", () => {
    expect(routeView("#history/availability", VIEWS)).toBe("availability");
  });
  it("ignores an unknown view or a page without one", () => {
    expect(routeView("#history/other", VIEWS)).toBeNull();
    expect(routeView("#history", VIEWS)).toBeNull();
  });
});

describe("pageViewTarget", () => {
  it("writes the default view when the page is reached without one", () => {
    expect(pageViewTarget("#history", "history", null, "events")).toBe("#history/events");
    expect(pageViewTarget("#history/old", "history", null, "events")).toBe("#history/events");
  });
  it("leaves a named view alone", () => {
    expect(pageViewTarget("#history/events", "history", "events", "events")).toBeNull();
  });
  it("never pulls the address back while the page is being left", () => {
    expect(pageViewTarget("#home", "history", null, "events")).toBeNull();
    expect(pageViewTarget("#settings/tasks", "history", null, "events")).toBeNull();
    expect(pageViewTarget("#historyx", "history", null, "events")).toBeNull();
  });
});
