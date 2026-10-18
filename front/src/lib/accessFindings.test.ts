import { describe, expect, it } from "vitest";
import type { AgentInfo, ApiToken, User } from "../types";
import { accessFindings, daysSince } from "./accessFindings";

const NOW = 1_800_000_000, DAY = 86400;
const user = (o: Partial<User>): User => ({ username: "u", role: "viewer", created: NOW - 400 * DAY, last_login: NOW - DAY, disabled: 0, ...o });
const token = (o: Partial<ApiToken>): ApiToken => ({ id: 1, kind: "api", name: "t", level: "read", hint: "", created: NOW - 400 * DAY, created_by: null, expires: null, revoked: null, last_used: NOW - DAY, last_ip: null, state: "actif", ...o });
const agent = (o: Partial<AgentInfo>): AgentInfo => ({ id: 1, ip: "10.0.0.5", name: "pc", hint: "", created: NOW - 400 * DAY, created_by: null, revoked: null, last_seen: NOW - 60, last_ip: null, interval: 60, version: "7", os: null, state: "actif", ...o });
const run = (u: User[] = [], t: ApiToken[] = [], a: AgentInfo[] = []) => accessFindings({ users: u, tokens: t, agents: a }, NOW);

describe("who can get into MyServices", () => {
  it("nothing wrong, nothing listed", () => {
    expect(run([user({})], [token({})], [agent({})])).toEqual([]);
  });
  it("accounts: never used for a month, or no sign-in for 90 days; disabled ones are left alone", () => {
    const got = run([user({ username: "ghost", last_login: null, created: NOW - 40 * DAY }), user({ username: "old", last_login: NOW - 120 * DAY, role: "admin" }),
                     user({ username: "new", last_login: null, created: NOW - 3 * DAY }), user({ username: "off", last_login: null, created: NOW - 400 * DAY, disabled: 1 })]);
    expect(got.map((f) => f.title)).toEqual(["ghost", "old"]);
    expect(got[1].detail).toContain("120");
  });
  it("tokens: expired but not revoked, never used, long unused; revoked ones are left alone", () => {
    const got = run([], [token({ name: "a", expires: NOW - 5 * DAY }), token({ name: "b", last_used: null, created: NOW - 60 * DAY }), token({ name: "c", last_used: NOW - 200 * DAY, level: "admin" }),
                         token({ name: "d", last_used: null, created: NOW - 400 * DAY, revoked: NOW - DAY }), token({ name: "e", last_used: null, created: NOW - 2 * DAY })]);
    expect(got.map((f) => f.title.split(" ")[0])).toEqual(["a", "b", "c"]);
    expect(got[2].title).toContain("admin");
  });
  it("agents: a changed host name, silent, or created and never installed", () => {
    const got = run([], [], [agent({ name: "x", host_pending: "OTHER-PC" }), agent({ name: "y", state: "silencieux", last_seen: NOW - 3 * DAY }), agent({ name: "z", state: "en attente", last_seen: null, created: NOW - 20 * DAY }),
                              agent({ name: "w", state: "en attente", last_seen: null, created: NOW - DAY }), agent({ name: "v", state: "révoqué" })]);
    expect(got.map((f) => f.title)).toEqual(["x", "y", "z"]);
    expect(got[0].detail).toContain("OTHER-PC");
  });
  it("counts whole days", () => {
    expect(daysSince(NOW - 2.9 * DAY, NOW)).toBe(2);
    expect(daysSince(NOW + 100, NOW)).toBe(0);
  });
});
