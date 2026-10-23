import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { connectorCounts, networkCounts, upkeepCounts, virtualCounts, wazuhCounts } from "./statsExtra";

const snap = (data: object, health?: object): Snapshot => ({ data: { hosts: [], machine_list: [], ...data }, health } as unknown as Snapshot);

describe("counters of the home page", () => {
  it("Wazuh only when set and answering, alerts and vulnerabilities with its indexer", () => {
    const agents = { active: 6, total: 7, disconnected: 1, never: 0 };
    const v = (critical: number) => ({ critical, high: 0, medium: 0, low: 0, worst: [] });
    expect(wazuhCounts(snap({}))).toBeNull();
    expect(wazuhCounts(snap({ services_status: [{ connector: "wazuh", ok: false, stale: false, agents }] }))).toBeNull();
    expect(wazuhCounts(snap({ services_status: [{ connector: "wazuh", ok: true, stale: true, agents }] }))).toBeNull();
    expect(wazuhCounts(snap({ services_status: [{ connector: "wazuh", ok: true, stale: false, agents }] })))
      .toEqual({ active: 6, total: 7, disconnected: 1, never: 0, serious: null, critical: null });
    const full = { connector: "wazuh", ok: true, stale: false, agents, alerts: { serious: 4 }, machines: { a: { vulns: v(3) }, b: { vulns: v(2) }, c: {} } };
    expect(wazuhCounts(snap({ services_status: [full] }))).toMatchObject({ serious: 4, critical: 5 });
  });
  it("network equipment: connected means state 1", () => {
    const s = snap({ network: [{ unifi: { clients: [], devices: [{ state: "1" }, { state: 1 }, { state: "0" }] } }, { devices: [] }] });
    expect(networkCounts(s)).toEqual({ devices: 3, online: 2 });
  });
  it("connectors and agents", () => {
    const s = snap({ connectors: [{ ok: true }, { ok: false }, { ok: true }], machine_list: [{ agent: { os: "win" } }, { agent: { os: "win" }, disabled: true }, {}] });
    expect(connectorCounts(s)).toEqual({ ok: 2, failing: 1, agents: 1 });
  });
  it("guests, without templates", () => {
    const s = snap({ virtualization: [{ guests: [{ status: "running" }, { status: "stopped" }, { status: "running", template: true }], nodes: [{ online: true }, { online: false }], problems: ["x"] }] });
    expect(virtualCounts(s)).toEqual({ guests: 2, running: 1, stopped: 1, nodesDown: 1, problems: 1 });
  });
  it("updates, restarts and certificates", () => {
    const s = snap({ hosts: [{ enabled: true, webcheck: { cert_days: 5 } }, { enabled: true, webcheck: { cert_valid: false } }, { enabled: true, paused: true, webcheck: { cert_days: 1 } }, { enabled: true }] },
      { hosts: [{ apt: { upgradable: 3 } }, { apt: { upgradable: 0 }, reboot_required: true }, {}] });
    expect(upkeepCounts(s)).toEqual({ updates: 1, reboot: 1, certSoon: 1, certBad: 1 });
  });
});
