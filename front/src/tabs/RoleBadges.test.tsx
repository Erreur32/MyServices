import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleBadges } from "./MachinesSettings";

describe("RoleBadges", () => {
  it("shows every role up to three, without a « +N »", () => {
    const html = renderToStaticMarkup(<RoleBadges roles={["web", "db"]} />);
    expect(html).toContain("web");
    expect(html).toContain("db");
    expect(html).not.toContain("+");
  });
  it("keeps three roles, cuts long ones short and lists the others in a « +N » tooltip", () => {
    const html = renderToStaticMarkup(<RoleBadges roles={["a", "b", "un-role-vraiment-trop-long", "d", "e"]} />);
    expect(html).toContain("un-role-vraim…");
    expect(html).toContain("+2");
    expect(html).toContain('title="d&#10;e"');
  });
});
