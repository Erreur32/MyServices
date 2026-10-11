import { describe, expect, it } from "vitest";
import { parseChangelog } from "./changelog";

const RAW = `# Changelog

intro

## Unreleased (next version, not tagged yet)

### Added
- **Truc** nouveau

## v0.9.3 (2026-10-11)

### Changed
- chose

## v0.9.2 (2026-10-11)
- autre
`;

describe("journal des changements", () => {
  it("découpe par version, la version en cours d'abord", () => {
    const s = parseChangelog(RAW);
    expect(s.map((x) => x.id)).toEqual(["unreleased", "0.9.3", "0.9.2"]);
    expect(s[0]).toMatchObject({ unreleased: true, title: "Unreleased", date: null });
    expect(s[1]).toMatchObject({ unreleased: false, title: "v0.9.3", date: "2026-10-11" });
    expect(s[1].body).toContain("- chose");
    expect(s[1].body).not.toContain("autre");
  });
  it("texte vide ou sans version", () => {
    expect(parseChangelog("")).toEqual([]);
    expect(parseChangelog("juste du texte")).toEqual([]);
  });
});
