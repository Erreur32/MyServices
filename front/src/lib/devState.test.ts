import { describe, expect, it } from "vitest";
import { otherBranches, plannedVersion } from "./devState";

const LOG = "# Changelog\n\n## Unreleased (next)\n\n## v0.32.1 (2026-10-31)\n\n## v0.32.0 (2026-10-31)\n";

describe("plannedVersion", () => {
  it("is the top of the changelog while it has no tag yet", () => expect(plannedVersion(LOG, "v0.32.0")).toBe("0.32.1"));
  it("is the next patch once that version is tagged", () => expect(plannedVersion(LOG, "v0.32.1")).toBe("0.32.2"));
  it("is nothing without work under way or a version", () => {
    expect(plannedVersion("## v0.32.1 (x)\n", "v0.32.1")).toBeNull();
    expect(plannedVersion("## Unreleased\n", "v0.1.0")).toBeNull();
  });
});

describe("otherBranches", () => {
  it("reads the name and the commits, the fullest first", () =>
    expect(otherBranches("fix+1,routers+2")).toEqual([{ name: "routers", commits: 2 }, { name: "fix", commits: 1 }]));
  it("keeps a plus sign in a name", () => expect(otherBranches("a+b+3")).toEqual([{ name: "a+b", commits: 3 }]));
  it("is empty on an image built before the field", () => {
    expect(otherBranches(undefined)).toEqual([]);
    expect(otherBranches("")).toEqual([]);
  });
});
