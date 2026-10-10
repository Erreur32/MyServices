import { describe, expect, it } from "vitest";
import { appIcon } from "./appIcons";

describe("appIcon", () => {
  it("trouve l'icône d'après le nom lisible de l'appli", () => {
    expect(appIcon(["Proxmox VE"])).toMatch(/icons\/proxmox\.svg$/);
    expect(appIcon(["Home Assistant"])).toMatch(/icons\/home-assistant\.svg$/);
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
