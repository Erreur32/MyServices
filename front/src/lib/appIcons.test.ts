import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appIcon, modelIcon } from "./appIcons";

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
    expect(appIcon(["Gotify", "UniFi"])).toMatch(/icons\/unifi\.svg$/);
    expect(appIcon(["Gotify"])).toBeNull();
    for (const [n, f] of [["Healthchecks", "healthchecks"], ["CrowdSec", "crowdsec"], ["Technitium DNS", "technitium"], ["Onduleur (NUT)", "nut"], ["Nextcloud", "nextcloud"]]) expect(appIcon([n])).toMatch(new RegExp(`icons/${f.replace(/[()]/g, "")}\\.svg$`));
    expect(appIcon(undefined)).toBeNull();
  });
});

describe("icon files", () => {
  it("every name points to a file of public/icons, and the new connectors have one", async () => {
    const { readdirSync } = await import("node:fs");
    const files = new Set(readdirSync(new URL("../../public/icons", import.meta.url)));
    const names = ["Pulse", "Arcane", "Glances", "GpuViewR", "NetAlertX", "Speedtest Tracker", "OpenSpeedTest", "Umami", "Rybbit", "Wazuh", "Webmin", "Tautulli", "Dozzle (agent)",
      "Bazarr", "Overseerr / Jellyseerr", "qBittorrent", "Transmission", "Backrest", "borgmatic (Borg)", "UrBackup", "Veeam Backup for Microsoft 365", "Veeam Agent",
      "Unraid", "Proxmox Datacenter Manager", "KVM / libvirt", "Incus", "LXD", "VirtualBox", "Hyper-V", "Whisparr", "Box internet (UPnP IGD)", "FRITZ!Box", "SFR Box", "Livebox", "Vodafone Station", "Sagemcom F@st", "Bbox Bouygues", "Swisscom Internet-Box", "Compal Connect Box", "Telekom Speedport", "Passerelle Technicolor (Homeware)", "T-Mobile Home Internet", "Hitron CODA", "Verizon Fios Router", "Arris SURFboard"];
    for (const n of names) {
      const src = appIcon([n]);
      expect(src, n).not.toBeNull();
      expect(files.has(src!.split("/").pop()!), n).toBe(true);
    }
  });
});

describe("logo d'un service", () => {
  it("appli reconnue, nom ou image, puis type", async () => {
    const { serviceIcon } = await import("./appIcons");
    expect(serviceIcon({ app: { label: "Home Assistant" } })).toMatch(/home-assistant\.svg$/);
    expect(serviceIcon({ service: { name: "npm", image: "jc21/nginx-proxy-manager:latest", kind: "docker" } })).toMatch(/nginx-proxy-manager\.svg$/);
    expect(serviceIcon({ service: { name: "monappli", image: "x/y", kind: "docker" } })).toMatch(/docker\.svg$/);
    expect(serviceIcon({ service: { name: "site", kind: "web" } })).toBeNull();
    expect(serviceIcon({})).toBeNull();
  });
});

describe("photos par modèle", () => {
  it("Freebox : Ultra (aussi « v9 »), Revolution (« v6 »), Pop (aussi « v8 ») ; une autre Freebox a le logo Freebox, un modèle absent rien", () => {
    expect(modelIcon("Freebox v9 (r1)")).toMatch(/freebox-ultra\.png$/);
    expect(modelIcon("Freebox Ultra")).toMatch(/freebox-ultra\.png$/);
    expect(modelIcon("Freebox Revolution")).toMatch(/freebox-revolution\.png$/);
    expect(modelIcon("Freebox v6")).toMatch(/freebox-revolution\.png$/);
    expect(modelIcon("Freebox Pop")).toMatch(/freebox-pop\.png$/);
    expect(modelIcon("Freebox v8 (r1)")).toMatch(/freebox-pop\.png$/);
    expect(modelIcon("Freebox Delta")).toMatch(/freebox\.svg$/);
    expect(modelIcon("Freebox v7 (r1)")).toMatch(/freebox\.svg$/);
    expect(modelIcon(undefined)).toBeNull();
  });
  it("UniFi : les bornes ont leur photo, une console ou un switch le logo UniFi", () => {
    for (const m of ["U6-Pro", "U7 Pro", "UAP-AC-Lite", "UniFi AP", "nanoHD"]) expect(modelIcon(m), m).toMatch(/unifi-ap\.png$/);
    for (const m of ["UCG-Fiber", "UDMA6A8", "UDM-Pro", "USW-24", "USW Flex 2.5G 8 PoE", "USG-3P", "UNVR"]) expect(modelIcon(m), m).toMatch(/unifi\.svg$/);
    expect(modelIcon("Raspberry Pi")).toBeNull();
  });
  it("chaque photo existe dans public/icons", () => {
    for (const m of ["Freebox Ultra", "Freebox Revolution", "Freebox Pop", "Freebox Delta", "U6-Pro", "UDM-Pro"]) {
      const file = modelIcon(m)!.split("/icons/")[1];
      expect(existsSync(join(__dirname, "../../public/icons", file)), file).toBe(true);
    }
  });
});
