import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Ban } from "lucide-react";
import { ChartToggle, topSlices } from "./ChartToggle";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: `row ${i}`, value: i + 1 }));

describe("topSlices", () => {
  it("keeps everything up to six slices, biggest first", () => {
    expect(topSlices(rows(3), "others").map((s) => s.label)).toEqual(["row 2", "row 1", "row 0"]);
  });
  it("adds the smallest ones up into one slice beyond six", () => {
    const got = topSlices(rows(9), "others");
    expect(got).toHaveLength(6);
    expect(got[5]).toMatchObject({ label: "others", value: 1 + 2 + 3 + 4 });
  });
  it("drops empty slices", () => {
    expect(topSlices([{ key: "a", label: "a", value: 0 }], "others")).toEqual([]);
  });
});

describe("ChartToggle", () => {
  it("shows the list first, with the two switch buttons", () => {
    const html = renderToStaticMarkup(<ChartToggle id="t" icon={Ban} title="T" rows={rows(2)} list={<p>the list</p>} />);
    expect(html).toContain("the list");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("<svg viewBox");
  });
});
