import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import type { Health } from "../types";
import { machineFail2ban, readF2b } from "./machineFail2ban";
import { securityFindings } from "./securityFindings";

const host = (id: string, fail2ban?: object) => ({ id, name: `${id} · 10.0.0.${id.length}`, source: "agent", system: fail2ban ? { fail2ban } : {} });
const health = (...hosts: object[]) => ({ hosts }) as unknown as Health;
const HOSTS = [
  host("calm", { available: true, access: true, total: 0, jails: [{ name: "sshd", banned: 0 }] }),
  host("web", { available: true, access: true, total: 42, usual: 3, peak: 42, rising: true, jails: [{ name: "sshd", banned: 40 }, { name: "nginx", banned: 2 }] }),
  host("nas", { available: true, access: false, rule: "fail2ban-client status" }),
  host("pi", { available: false }),
  host("box"),   // health pass did not look for Fail2ban: no row
  host("db", { available: true, access: true, total: 3, jails: [{ name: "sshd", banned: 3 }] }),
];

describe("machine fail2ban", () => {
  it("one row per machine that was looked at, the rising ones first", () => {
    const rows = machineFail2ban(health(...HOSTS));
    expect(rows.map((r) => [r.id, r.state])).toEqual([["web", "rising"], ["db", "usual"], ["nas", "unread"], ["calm", "calm"], ["pi", "absent"]]);
    expect(rows[2].rule).toBe("fail2ban-client status");
    expect(readF2b(rows).map((r) => r.id)).toEqual(["web", "db", "calm"]);
    expect(machineFail2ban(null)).toEqual([]);
  });
  it("a rising Fail2ban is a security finding that opens the machine", () => {
    const snap = { data: { hosts: [], machine_list: [], security: [], network: [] }, health: health(...HOSTS) } as unknown as Snapshot;
    expect(securityFindings(snap).map((f) => [f.sev, f.area, f.title, f.detail, f.href])).toEqual([
      ["warn", "fail2ban", "Fail2ban monte sur web", "42 IP bannies, contre 3 d'habitude", "#machines/10.0.0.3"],
    ]);
  });
});
