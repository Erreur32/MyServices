import { describe, expect, it } from "vitest";
import { appIcon } from "./appIcons";

describe("appIcon", () => {
  it("trouve l'icône d'après le nom lisible de l'appli", () => {
    expect(appIcon(["Proxmox VE"])).toMatch(/icons\/proxmox\.svg$/);
    expect(appIcon(["Home Assistant"])).toMatch(/icons\/home-assistant\.svg$/);
  });
  it("connaît les icônes des connecteurs (Proxmox Backup = Proxmox)", () => {
  expect(appIcon(["Proxmox Backup Server"])).toMatch(/icons\/proxmox\.svg$/);
  for (const [n, f] of [["Dockhand", "dockhand"], ["LogviewR", "logviewr"], ["MynetworK", "mynetwork"], ["Web-Check", "web-check"], ["Veeam Backup & Replication", "veeam"]]) expect(appIcon([n])).toMatch(new RegExp(`icons/${f}\\.svg$`));
});
it("connaît Docker et Nginx", () => {
    expect(appIcon(["Docker"])).toMatch(/icons\/docker\.svg$/);
    expect(appIcon(["Nginx"])).toMatch(/icons\/nginx\.svg$/);
  });
  it("prend la première appli qui a une icône ; rien sinon", () => {
    expect(appIcon(["Netdata", "UniFi"])).toMatch(/icons\/unifi\.svg$/);
    expect(appIcon(["Netdata"])).toBeNull();
    expect(appIcon(undefined)).toBeNull();
  });
});
