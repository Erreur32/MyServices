import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { hasNetwork } from "../lib/network";
import { Network } from "./Network";

// Network tab rendered without a browser, from MynetworK and UniFi rows in the shape of data.json
const snap = {
  me: { role: "admin" },
  data: {
    machine_list: [{ ip: "10.0.0.6", name: "Monitor" }],
    network: [{ connector: "mynetwork", name: "lan", label: "MynetworK", ok: true, stale: false, message: "OK",
      devices: [{ ip: "10.0.0.6", hostname: "monitor", vendor: "Proxmox", status: "online", ports: [] }, { ip: "10.0.0.9", hostname: "tv", vendor: "LG", status: "offline", ports: [] }],
      unifi: { devices: [{ name: "UCG", model: "UDMA6A8", mac: "AA:00", ip: "10.0.0.1", state: "connected", version: "5.1", clients: 2, uptime: 3600 },
                         { name: "Borne salon", mac: "aa:01", state: "offline" }],
               clients: [{ name: "Monitor", ip: "10.0.0.6", mac: "bb:01", wired: true, switch_mac: "aa:00", switch_port: 5 },
                         { name: "Phone", ip: "10.0.0.20", mac: "bb:02", wired: false, essid: "Maison", signal_dbm: -60, ap_mac: "aa:01" }] } }],
    services_status: [{ connector: "freebox", name: "lan", label: "Freebox (via MynetworK)", ok: true, stale: false, message: "OK", facts: [{ label: "Appareils actifs", value: "3/10" }], problems: [] },
                      { connector: "unifi", name: "ucg", label: "UniFi Network", ok: true, stale: false, message: "OK", facts: [], problems: [],
                        unifi: { devices: [{ name: "UCG", mac: "aa:00", online: true, updatable: true }], clients: [] } }],
    hosts: [],
  },
} as unknown as Snapshot;

// A minimal localStorage: the folded sections are remembered there ([] = the person unfolded everything)
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) }, configurable: true });
afterEach(() => stored.clear());

describe("onglet Réseau", () => {
  it("par défaut tout est plié sauf l'accès Internet et les passerelles ; le menu reste là", () => {
    const html = renderToStaticMarkup(<Network snap={snap} onMachine={() => undefined} initialSub="list" />);
    expect(html).toContain("Freebox (via MynetworK)");              // the open section
    expect(html).not.toContain('<b class="text-txt">UCG</b>');       // the equipment table is folded
    expect(html).not.toContain("LG");                               // so is the device list
    for (const t of ["Équipements réseau", "Clients par borne ou switch", "Appareils du réseau", "Tout déplier"]) expect(html, t).toContain(t);   // headers and menu stay
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-expanded="false"');
  });
  it("si la personne a tout déplié, tout s'affiche", () => {
    stored.set("ms.network.folded", "[]");
    expect(renderToStaticMarkup(<Network snap={snap} onMachine={() => undefined} initialSub="list" />)).toContain("LG");
  });
  it("tiles, Internet card, equipment merged by MAC, clients by uplink, devices", () => {
    stored.set("ms.network.folded", "[]");   // everything unfolded to read it all
    expect(hasNetwork(snap)).toBe(true);
    const html = renderToStaticMarkup(<Network snap={snap} onMachine={() => undefined} initialSub="list" />);
    for (const t of ["Freebox (via MynetworK)", "UniFi Network", "Passerelle", "1/2 en ligne", "« Borne salon » hors ligne", "« UCG » : mise à jour disponible", "UDMA6A8", "Borne salon", "port 5", "Maison · -60 dBm", "LG", "Monitor", "1/2"]) expect(html, t).toContain(t);
    expect(html.match(/<b class="text-txt">UCG<\/b>/g)?.length).toBe(1);   // MynetworK and the UniFi connector: one row
    expect(html.indexOf("Freebox (via MynetworK)")).toBeLessThan(html.indexOf("UniFi Network"));   // side by side at the top, Freebox first
  });
  it("« À surveiller » : the access point offline in red, the gateway update in orange, the figures above", () => {
    const html = renderToStaticMarkup(<Network snap={snap} onMachine={() => undefined} />);
    for (const t of ["À surveiller", "Borne salon", "hors ligne", "mise à jour disponible (installée : 5.1)", "1/2", "Équipements en ligne", "Accès Internet", "Appareils actifs : 3/10", "tous suivis"]) expect(html, t).toContain(t);
    expect(html.indexOf("Borne salon")).toBeLessThan(html.indexOf("mise à jour disponible"));   // red before orange
  });
  it("hidden without any network source", () => {
    expect(hasNetwork({ data: { network: [], services_status: [] } } as unknown as Snapshot)).toBe(false);
  });
  it("la vue d'ensemble est la page d'arrivée : les compteurs et le sous-menu, pas la liste", () => {
    const html = renderToStaticMarkup(<Network snap={snap} onMachine={() => undefined} />);
    expect(html).toContain("Cartes");                      // the sub-menu
    expect(html).toContain("Équipements et appareils");
    expect(html).not.toContain("Clients par borne ou switch");   // that list lives in the other sub-page
  });
});
