import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MachineBackupsSection } from "./Machines";
import type { Backups, Machine, VeeamObject } from "../types";

const obj = (o: Partial<VeeamObject>): VeeamObject => ({ name: "vm", host: "", type: "VirtualMachine", size: null, points: null, machine: null, machine_by: null, runs_on: null, ...o });
const backups = {
  hosts: [],
  sets: [{ id: "weekly", label: "Veeam : Weekly", origin: "veeam-sources", schedule: "", level: "ok", archived: false, offsite: 1,
    locations: [{ host: "veeam", label: "Veeam", level: "ok", age: 2, job: "Weekly", repository: "NAS", objects: [
      obj({ name: "Nextcloud", host: "10.0.0.37", size: 160 * 1024 ** 3, points: 4, machine: "10.0.0.40", machine_by: "name", runs_on: "10.0.0.37" }),
      obj({ name: "Plex-VM", host: "10.0.0.37", points: 2, runs_on: "10.0.0.37" }),
    ] }] }],
} as unknown as Backups;
const machine = (ip: string) => ({ ip, name: ip } as unknown as Machine);

describe("MachineBackupsSection, Veeam", () => {
  it("shows the job that backs up a VM, its size, points and how it was linked", () => {
    const html = renderToStaticMarkup(<MachineBackupsSection m={machine("10.0.0.40")} backups={backups} />);
    expect(html).toContain("Sauvegardée par Veeam");
    expect(html).toContain("job « Weekly »");
    expect(html).toContain("dépôt NAS");
    expect(html).toContain("4 point(s)");
    expect(html).toContain("Rattachée par le nom (« Nextcloud » dans Veeam)");
    expect(html).not.toContain("VM sauvegardées ici");
  });
  it("lists on the hypervisor the VMs that run on it, the unlinked ones flagged", () => {
    const html = renderToStaticMarkup(<MachineBackupsSection m={machine("10.0.0.37")} backups={backups} />);
    expect(html).toContain("VM sauvegardées ici");
    expect(html).toContain("Plex-VM");
    expect(html).toContain("non rattachée");
  });
  it("shows nothing for a machine Veeam does not back up", () => {
    expect(renderToStaticMarkup(<MachineBackupsSection m={machine("10.0.0.99")} backups={backups} />)).toBe("");
  });
});
