import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { areaKey, findingKey, securityFindings } from "./securityFindings";

const snap = (ignore?: string[]) => ({
  data: {
    hosts: [], security: [], security_ignore: ignore, machine_list: [],
    network: [{ connector: "mynetwork", name: "m", devices: [{ ip: "10.0.0.5", hostname: "nas", vendor: "", ports: [445, 22] }] }],
  },
  health: null,
}) as unknown as Snapshot;

describe("ignored security findings", () => {
  const port = securityFindings(snap())[0];
  it("a sensitive port shows by default", () => {
    expect(port).toMatchObject({ area: "ports", title: "nas" });
  });
  it("one ignored finding is gone, and comes back when its detail changes", () => {
    expect(securityFindings(snap([findingKey(port)]))).toEqual([]);
    expect(securityFindings(snap([findingKey({ ...port, detail: "445 SMB · 3389 RDP" })]))).toHaveLength(1);
  });
  it("a switched-off check hides its whole area", () => {
    expect(securityFindings(snap([areaKey("ports")]))).toEqual([]);
    expect(securityFindings(snap([areaKey("sites")]))).toHaveLength(1);
  });
});
