import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { cloudflareCounts, connectorCounts, networkCounts, upkeepCounts, virtualCounts, wazuhCounts } from "./statsExtra";

const snap = (data: object, health?: object): Snapshot => ({ data: { hosts: [], machine_list: [], ...data }, health } as unknown as Snapshot);

describe("counters of the home page", () => {
  it("Cloudflare: each domain once, a domain to improve counted once, totals of the period", () => {
    const zone = (name: string, settings: object, more: object = {}) => ({ name, status: "active", paused: false, settings, dns: { total: 3, proxied: 1, records: [] }, traffic: { requests: 0, cached: 0, bytes: 0, threats: 2, page_views: 0, visitors: 5, days: [] }, ...more });
    const bad = zone("a.fr", { ssl: "flexible", always_use_https: "off" }), good = zone("b.fr", { ssl: "strict" }), off = zone("c.fr", { ssl: "strict" }, { paused: true, traffic: null, dns: null });
    expect(cloudflareCounts(snap({}))).toEqual({ domains: 0, active: 0, toImprove: 0, threats: 0, visitors: 0, records: 0 });
    expect(cloudflareCounts(snap({ services_status: [{ connector: "cloudflare", cloudflare: { days: 7, zones: [bad, good, off] } }, { connector: "cloudflare", cloudflare: { days: 7, zones: [bad] } }] })))
      .toEqual({ domains: 3, active: 2, toImprove: 1, threats: 4, visitors: 10, records: 6 });
  });

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
  it("updates and restarts", () => {
    const s = snap({}, { hosts: [{ apt: { upgradable: 3 } }, { apt: { upgradable: 0 }, reboot_required: true }, {}] });
    expect(upkeepCounts(s)).toEqual({ updates: 1, reboot: 1 });
  });
});
