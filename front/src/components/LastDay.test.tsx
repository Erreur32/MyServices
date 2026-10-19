import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { LastDay } from "./LastDay";

const NOW = Date.parse("2026-10-10T12:00:00+02:00");
const at = (h: number) => new Date(NOW - h * 3600e3).toISOString();
const snap = (events: { ts: string; kind: string; label: string }[]) =>
  ({ events, labels: { panne: "🔴 Panne", retabli: "🟢 Rétabli" }, severity: { panne: 3, retabli: 0 } } as unknown as Snapshot);

describe("What changed since yesterday", () => {
  it("says so when nothing happened", () => {
    const html = renderToStaticMarkup(<LastDay snap={snap([])} go={() => undefined} now={NOW} />);
    expect(html).toContain("Rien n");
    expect(html).toContain(">0<");
  });
  it("one aligned row per kind: mark and label, names, time on the right, the names beyond four counted", () => {
    const events = [1, 2, 3, 4, 5, 6].map((i) => ({ ts: at(i), kind: "panne", label: `srv${i}.lan` })).concat([{ ts: at(2), kind: "retabli", label: "plex.lan" }]);
    const html = renderToStaticMarkup(<LastDay snap={snap(events)} go={() => undefined} now={NOW} />);
    expect(html).toContain("sm:grid-cols-[13rem_minmax(0,1fr)_6.5rem]");
    expect(html).toContain("Panne");
    expect(html).toContain("srv1.lan");
    expect(html).not.toContain("srv5.lan");   // the fifth and sixth names are counted, not listed
    expect(html).toContain("+ 2 autre(s)");
    expect(html).toContain("sm:col-start-3");
  });
});
