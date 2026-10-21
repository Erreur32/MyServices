import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchBox } from "./ui";

describe("SearchBox", () => {
  it("a search field named by its hint, then « N sur M »", () => {
    const html = renderToStaticMarkup(<SearchBox value="ssh" onChange={() => undefined} placeholder="Compte, IP" count={[3, 40]} />);
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Compte, IP"');
    expect(html).toContain('value="ssh"');
    expect(html).toMatch(/<b[^>]*>3<\/b> sur 40/);
  });
  it("without a count, the field alone", () => {
    expect(renderToStaticMarkup(<SearchBox value="" onChange={() => undefined} placeholder="x" />)).not.toContain(" sur ");
  });
});
