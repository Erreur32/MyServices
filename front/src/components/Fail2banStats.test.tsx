import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Fail2banStats as Stats, SecurityConnector } from "../types";
import { Fail2banStats, mergeStats } from "./Fail2banStats";

const stats = (n: number): Stats => ({
  hours: Array.from({ length: 24 }, (_, i) => (i === 23 ? n : 0)), days: [0, 0, 0, 0, 0, 1, n], by_jail: [{ jail: "sshd", d1: n, d7: n + 1 }],
  top_ips: [{ ip: "203.0.113.5", bans: 3, jails: ["sshd"], failures: 9, last: 1_800_000_000 }], unique_1d: 1, unique_7d: 2, repeat: 1, failures_1d: 9,
});
const source = (s: Stats | null) => ({ connector: "logviewr", name: "lv", stats: s } as unknown as SecurityConnector);

describe("Fail2ban statistics", () => {
  it("shows the numbers, the jails and the most banned address", () => {
    const html = renderToStaticMarkup(<Fail2banStats sources={[source(stats(4))]} />);
    expect(html).toContain("203.0.113.5");
    expect(html).toContain("sshd");
    expect(html).toContain(">4<");
  });
  it("says so when the connector sent no statistics", () => {
    expect(renderToStaticMarkup(<Fail2banStats sources={[source(null)]} />)).toContain("role=\"note\"");
  });
  it("adds up several sources", () => {
    const m = mergeStats([stats(2), stats(3)]);
    expect(m.hours[23]).toBe(5);
    expect(m.by_jail).toEqual([{ jail: "sshd", d1: 5, d7: 7 }]);
    expect(m.repeat).toBe(2);
  });
});
