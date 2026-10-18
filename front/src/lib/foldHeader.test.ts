import { describe, expect, it } from "vitest";
import { headerToggle, isHeaderClick } from "./foldHeader";

/** A tiny stand-in for the DOM: an element knows its parent and whether it matches a selector */
type El = { tag: string; parent?: El; closest: (sel: string) => El | null; contains: (o: El) => boolean };
const el = (tag: string, parent?: El): El => {
  const self: El = {
    tag, parent,
    closest(sel) { const tags = sel.split(",").map((s) => s.replace(/\[.*$/, "")); for (let n: El | undefined = self; n; n = n.parent) if (tags.includes(n.tag)) return n; return null; },
    contains(o) { for (let n: El | undefined = o; n; n = n.parent) if (n === self) return true; return false; },
  };
  return self;
};

describe("a click on the header of a foldable card", () => {
  const header = el("div"), title = el("h3", header), link = el("a", header), icon = el("span", link), button = el("button", header);
  it("on the title or on empty space toggles", () => {
    expect(isHeaderClick({ target: title as never, currentTarget: header as never })).toBe(true);
    expect(isHeaderClick({ target: header as never, currentTarget: header as never })).toBe(true);
  });
  it("on a link, something inside a link, or a button is left to that element", () => {
    expect(isHeaderClick({ target: link as never, currentTarget: header as never })).toBe(false);
    expect(isHeaderClick({ target: icon as never, currentTarget: header as never })).toBe(false);
    expect(isHeaderClick({ target: button as never, currentTarget: header as never })).toBe(false);
  });
  it("a clickable element OUTSIDE the header does not matter", () => {
    const outside = el("button");
    const inner = el("span", outside);
    expect(isHeaderClick({ target: inner as never, currentTarget: header as never })).toBe(true);
  });
  it("headerToggle calls the toggle only for the header itself", () => {
    let n = 0;
    const h = headerToggle(() => { n += 1; });
    h({ target: title as never, currentTarget: header as never } as never);
    h({ target: link as never, currentTarget: header as never } as never);
    expect(n).toBe(1);
  });
});
