import { describe, expect, it } from "vitest";
import type { BackupSet, Backups, VeeamObject } from "../types";
import { veeamOf } from "./veeamMachines";

const obj = (o: Partial<VeeamObject>): VeeamObject => ({ name: "vm", host: "", type: "VirtualMachine", size: null, points: null, machine: null, machine_by: null, runs_on: null, ...o });
const set = (id: string, objects: VeeamObject[], archived = false): BackupSet =>
  ({ id, label: id, origin: "veeam-sources", schedule: "", level: "ok", archived, offsite: 1, locations: [{ host: "veeam", label: "Veeam", level: "ok", job: id, objects }] });

describe("veeamOf", () => {
  const backups = { sets: [
    set("weekly", [obj({ name: "nextcloud", machine: "10.0.0.40", runs_on: "10.0.0.37" }), obj({ name: "plex", runs_on: "10.0.0.37" })]),
    set("old", [obj({ name: "nextcloud", machine: "10.0.0.40" })], true),
  ] } as unknown as Backups;

  it("gives the jobs that back up the machine, archived sets left out", () => {
    expect(veeamOf(backups, "10.0.0.40").mine.map((r) => [r.set.id, r.obj.name])).toEqual([["weekly", "nextcloud"]]);
  });
  it("gives the VMs that run on a hypervisor, linked or not", () => {
    expect(veeamOf(backups, "10.0.0.37").hosted.map((r) => r.obj.name)).toEqual(["nextcloud", "plex"]);
  });
  it("is empty without backups or objects", () => {
    expect(veeamOf(null, "10.0.0.40")).toEqual({ mine: [], hosted: [] });
    expect(veeamOf(backups, "10.0.0.99")).toEqual({ mine: [], hosted: [] });
  });
});
