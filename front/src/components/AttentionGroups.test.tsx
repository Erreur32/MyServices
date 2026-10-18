import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { groupAttention, limitGroups, type Attention } from "../lib/summary";
import { AttentionGroups } from "./AttentionGroups";

const item = (category: Attention["category"], level: Attention["level"], text: string): Attention => ({ category, level, text, tab: "machines" });

describe("attention groups", () => {
  it("one section per category with its counts, the red line before the orange one", () => {
    const groups = limitGroups(groupAttention([item("dns", "warn", "dns orpheline"), item("machines", "warn", "ssh"), item("machines", "crit", "ping perdu")]), 0);
    const html = renderToStaticMarkup(<AttentionGroups groups={groups} go={() => undefined} />);
    expect(html.match(/<section/g)).toHaveLength(2);
    expect(html.indexOf("Machines")).toBeLessThan(html.indexOf("DNS"));   // the category with the red point first
    expect(html.indexOf("ping perdu")).toBeLessThan(html.indexOf("ssh"));
    expect(html).toContain('aria-expanded="true"');
  });
});
