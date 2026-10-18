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
  it("a caution has its own colour", () => {
    expect(renderToStaticMarkup(<InfoNote tone="warn">Careful</InfoNote>)).toContain("border-l-warn");
  });
});
