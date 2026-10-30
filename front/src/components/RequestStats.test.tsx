import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequestTable, watchText, type RequestDoc, type RequestRow } from "./RequestStats";

const row = (over: Partial<RequestRow>): RequestRow => ({
  owner: "mynetwork/lan", route: "/api/lan/devices", per_min: 2, per_hour: 40, total: 300, hits: 0, last_ms: 12, avg_ms: 15, last_code: 200, n429: 0,
  retry_after: null, last_error: "", last_at: 1_800_000_000, limit: null, watch: false, ...over,
});
const doc = (rows: RequestRow[], watch: RequestDoc["watch"] = []): RequestDoc => ({ rows, watch, at: 1_800_000_000 });

describe("Request counters table", () => {
  it("shows the routes of one connector with their figures, the limit and the code", () => {
    const html = renderToStaticMarkup(<RequestTable doc={doc([row({}), row({ route: "/api/search/ip-details/*", limit: 30, per_min: 24, watch: true }), row({ owner: "beszel/hub", route: "/x" })])} owner="mynetwork/lan" />);
    expect(html).toContain("/api/lan/devices");
    expect(html).toContain("limite 30/min");
    expect(html).toContain("12 ms");
    expect(html).not.toContain("beszel/hub");   // another connector: not in this card
    expect(html).toContain("text-warn");
  });
  it("lists what is to watch and names the connector when every one is shown", () => {
    const html = renderToStaticMarkup(<RequestTable doc={doc([row({ last_code: 429, n429: 2, retry_after: 7 })], [{ owner: "mynetwork/lan", route: "/api/lan/devices", per_min: 2, limit: null, n429: 2, retry_after: 7 }])} />);
    expect(html).toContain("Avertissement");   // the watch list is folded until clicked
    expect(watchText({ owner: "mynetwork/lan", route: "/api/lan/devices", per_min: 2, limit: null, n429: 2, retry_after: 7 })).toContain("429 reçu sur /api/lan/devices (mynetwork/lan), réessai dans 7 s");
    expect(html).toContain("2 (7 s)");
    expect(html).toContain("<td class=\"px-2 py-1 font-mono text-xs\">mynetwork/lan</td>");
  });
  it("says when a route is near its limit, and when nothing was counted", () => {
    const html = renderToStaticMarkup(<RequestTable doc={doc([row({})], [{ owner: "mynetwork/lan", route: "*", per_min: 250, limit: 300, n429: 0, retry_after: null }])} />);
    expect(watchText({ owner: "mynetwork/lan", route: "*", per_min: 250, limit: 300, n429: 0, retry_after: null })).toContain("250 appels par minute sur * (mynetwork/lan), limite 300");
    expect(html).toContain("Avertissement");
    expect(renderToStaticMarkup(<RequestTable doc={doc([])} />)).toContain("Aucun appel compté");
    expect(renderToStaticMarkup(<RequestTable doc={doc([row({ last_code: null, total: 1, last_error: "injoignable" })])} />)).toContain("aucune réponse");
  });
});
