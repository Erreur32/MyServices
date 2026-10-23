import { describe, expect, it } from "vitest";
import { agentSummary, sshRows, sshTarget } from "./accessLists";
import type { AgentInfo, Connector, Machine, MachineConf, SshAlias } from "../types";

const agent = (id: number, name: string, state: AgentInfo["state"], more: Partial<AgentInfo> = {}): AgentInfo => ({
  id, name, state, ip: `10.0.0.${id}`, hint: "abcd", created: 0, created_by: null, revoked: state === "révoqué" ? 1 : null,
  last_seen: null, last_ip: null, interval: 60, version: "1.0", os: null, ...more,
});

describe("agentSummary", () => {
  it("counts each state and keeps the revoked apart", () => {
    const s = agentSummary([agent(1, "b", "actif"), agent(2, "a", "silencieux"), agent(3, "c", "en attente"), agent(4, "d", "révoqué")]);
    expect([s.active, s.silent, s.pending]).toEqual([1, 1, 1]);
    expect(s.revoked.map((a) => a.name)).toEqual(["d"]);
    expect(s.live.map((a) => a.name)).toEqual(["a", "b", "c"]);   // silent first, then by name
  });
  it("lists the outdated agents not already asked to update, and shows them first", () => {
    const s = agentSummary([agent(1, "a", "actif"), agent(2, "z", "actif", { outdated: true }), agent(3, "y", "actif", { outdated: true, update_requested: true })]);
    expect(s.outdated.map((a) => a.name)).toEqual(["z"]);
    expect(s.live[0].name).toBe("y");
  });
});

describe("sshTarget", () => {
  const aliases: SshAlias[] = [{ alias: "srv", host: "srv.lan", ip: "10.0.0.5", user: "monitor", port: 2222 }, { alias: "box", host: "box.lan", ip: null, port: 22 }];
  it("gives account@address:port, the port only when it is not 22", () => {
    expect(sshTarget("srv", aliases)).toBe("monitor@10.0.0.5:2222");
    expect(sshTarget("box", aliases)).toBe("box.lan");
  });
  it("keeps an unknown alias as it is", () => {
    expect(sshTarget("other", aliases)).toBe("other");
  });
});

describe("sshRows", () => {
  const machines: Record<string, MachineConf> = {
    "10.0.0.1": { name: "alpha", ssh: "a" },
    "10.0.0.2": { name: "beta", ssh: "b" },
    "10.0.0.3": { name: "gamma", ssh: "c" },
    "10.0.0.4": { name: "delta", ssh: false },
    "10.0.0.5": { name: "eps" },
    "10.0.0.6": { name: "zeta", ssh: "z", disabled: true },
  };
  const connectors: Connector[] = [
    { type: "docker", name: "alpha", ok: true, message: "", ip: "10.0.0.1" },
    { type: "docker", name: "beta", ok: false, message: "Permission denied (publickey)", ip: "10.0.0.2" },
  ];
  const list = [{ ip: "10.0.0.1", info: { os: "Debian" } }, { ip: "10.0.0.3", info: { os: "Windows", via: "agent" } }] as unknown as Machine[];
  it("one row per SSH access, refused first, then not read yet, read, turned off", () => {
    const rows = sshRows(machines, [], list, connectors);
    expect(rows.map((r) => [r.name, r.state])).toEqual([["beta", "refused"], ["gamma", "unread"], ["alpha", "ok"], ["delta", "off"]]);
    expect(rows[0].message).toBe("Permission denied (publickey)");
    expect(rows[2].message).toBe("");
  });
});
