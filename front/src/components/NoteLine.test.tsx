import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteLine } from "./form";

describe("NoteLine", () => {
  it("opens a failure in a window over the page, and keeps the red line below it", () => {
    const html = renderToStaticMarkup(<NoteLine note={{ ok: false, text: "boom" }} />);
    expect(html).toContain("<dialog");
    expect(html.match(/boom/g)).toHaveLength(2);   // in the window and in the line under the form
  });
  it("shows a success as a quiet line, without a window", () => {
    const html = renderToStaticMarkup(<NoteLine note={{ ok: true, text: "done" }} />);
    expect(html).not.toContain("<dialog");
    expect(html).toContain("done");
  });
  it("keeps the small inline form without a window, and shows nothing without a note", () => {
    expect(renderToStaticMarkup(<NoteLine note={{ ok: false, text: "x" }} inline />)).not.toContain("<dialog");
    expect(renderToStaticMarkup(<NoteLine note={null} />)).toBe("");
  });
});
