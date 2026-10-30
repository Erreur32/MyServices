import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoNote } from "./InfoNote";

describe("InfoNote", () => {
  it("is a note with its text and an icon the screen readers skip", () => {
    const html = renderToStaticMarkup(<InfoNote>Postfix needs nothing</InfoNote>);
    expect(html).toContain('role="note"');
    expect(html).toContain("Postfix needs nothing");
    expect(html).toContain('aria-hidden="true"');
  });
  it("an information frame has a cross, a caution has none", () => {
    expect(renderToStaticMarkup(<InfoNote>Hint</InfoNote>)).toContain("Masquer cette note");
    expect(renderToStaticMarkup(<InfoNote tone="warn">Careful</InfoNote>)).not.toContain("Masquer cette note");
  });
  it("a frame is named by its text: same text, same id; another text, another id", async () => {
    const { hintId, textOf } = await import("../lib/hints");
    expect(hintId("Same")).toBe(hintId("  Same "));
    expect(hintId("Same")).not.toBe(hintId("Other"));
    expect(textOf(<>A <b>bold</b> {3}</>)).toBe("A bold 3");
  });
  it("a caution has its own colour", () => {
    expect(renderToStaticMarkup(<InfoNote tone="warn">Careful</InfoNote>)).toContain("border-l-warn");
  });
});
