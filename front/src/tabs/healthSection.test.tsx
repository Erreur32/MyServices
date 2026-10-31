import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HealthHost, Machine } from "../types";
import { freeboxHealth } from "../lib/freebox";
import { DriveStatus, FreeboxAccessSection, FreeboxFirmware, FreeboxNetwork, FreeboxWifi, HealthSection, ProbeChips, SystemSection, UpdatesSection } from "./Machines";

const m = { ip: "10.0.0.254", name: "Freebox", ping: true, off: false, services: 0, npm: 0, down: 0 } as Machine;
const h = freeboxHealth(m, {
  connection: { state: "up", media: "ftth" },
  system: { model: "Freebox v9 (r1)", uptime: 508155, fans: [{ id: "fan0", name: "Ventilateur 1", value: 600 }], sensors: [{ id: "temp_cpu0", name: "CPU 0", value: 58 }, { id: "temp_cpu1", name: "CPU 1", value: 60 }, { id: "temp_hdd", name: "Disque", value: 62 }] },
  storage: { disks: [{ model: "WD_BLACK SN770", state: "enabled", smart_ok: false, temperature: 62, total_bytes: 1e12 }], partitions: [{ label: "NVME 32", fstype: "ext4", total_bytes: 917e9, used_bytes: 506e9, free_bytes: 411e9, used_pct: 55 }] },
  vms: [{ id: 0, name: "FreeMachine", status: "stopped", vcpus: 2, memory_mb: 2048, os: "debian" }],
  vm_system: { total_memory_mb: 2048, used_memory_mb: 0, total_cpus: 2, used_cpus: 0, memory_pct: 0, cpu_pct: 0 },
});

describe("section Santé de la fiche d'une Freebox", () => {
  it("Système montre la partition, la température du processeur, la mémoire VM et l'état des VM ; Santé garde le niveau", () => {
    expect(renderToStaticMarkup(<HealthSection h={h} from={[]} />)).toContain("Niveau");
    const html = renderToStaticMarkup(<SystemSection h={h} from={[]} />);
    for (const t of ["NVME 32", "55<span class=\"ml-0.5 text-[0.8em] text-dim\">%</span>", "411 Go libres", "État du disque", "WD_BLACK SN770", "actif", "62 °C", "SMART en défaut", "60 °C", "Sondes", "Ventilateur", "600", "Mémoire VM", "0 en marche sur 1"]) expect(html, t).toContain(t);
  });
});

describe("section Mises à jour de la fiche d'une Freebox", () => {
  it("résume la mise à jour du firmware quand la box en propose une", () => {
    const upd = freeboxHealth(m, { connection: { state: "up" }, system: { update_available: true, latest_firmware: "4.14.0" } });
    const html = renderToStaticMarkup(<UpdatesSection h={upd} windows={false} from={[]} />);
    expect(html).toContain("Mise à jour du firmware disponible");
    expect(html).toContain("firmware → 4.14.0");
    expect(html).not.toContain("paquet");
  });
  it("n'affiche rien sans mise à jour, redémarrage ni firmware proposé", () => {
    expect(renderToStaticMarkup(<UpdatesSection h={h} windows={false} from={[]} />)).toBe("");
  });
});

describe("section Mises à jour quand rien n'attend mais qu'un souci la vise", () => {
  const card = (system: HealthHost["system"]) => renderToStaticMarkup(<UpdatesSection h={{ name: "PapoMintBeach (10.0.0.16)", system } as HealthHost} windows={false} from={[]} />);
  it("reste affichée pour des mises à jour automatiques en erreur, avec la ligne que vise le lien", () => {
    const html = card({ auto_upd: { available: true, enabled: true, days: 1, errors: ["sendmail missing"] } } as HealthHost["system"]);
    expect(html).toContain('data-sec="updates"');
    expect(html).toContain('data-watch="auto_upd"');
    expect(html).toContain("1 erreur(s)");
    expect(html).not.toContain("à jour</span>");
  });
  it("reste affichée pour un dernier passage trop ancien, un snap ou un service à redémarrer", () => {
    expect(card({ auto_upd: { available: true, enabled: true, days: 9 } } as HealthHost["system"])).toContain('data-sec="updates"');
    expect(card({ snap: { available: true, pending: 2, names: ["core"] } } as HealthHost["system"])).toContain('data-sec="updates"');
    expect(card({ needrestart: { available: true, services: ["cron"] } } as HealthHost["system"])).toContain('data-sec="updates"');
  });
  it("reste masquée pour des mises à jour automatiques saines ou coupées", () => {
    expect(card({ auto_upd: { available: true, enabled: true, days: 1 } } as HealthHost["system"])).toBe("");
    expect(card({ auto_upd: { available: true, enabled: false } } as HealthHost["system"])).toBe("");
  });
});

describe("section Lecture de la fiche d'une Freebox (pas de SSH)", () => {
  it("dit comment elle est lue, son adresse, les droits et les appareils", () => {
    const html = renderToStaticMarkup(<FreeboxAccessSection fb={{ system: { lan_ip: "10.0.0.254" }, hosts: 127, hosts_active: 1, missing_rights: [] }} from={[]} />);
    for (const t of ["MynetworK", "10.0.0.254", "tous accordés", "1 actifs / 127"]) expect(html, t).toContain(t);
    for (const t of ["Connexion", "Clé", "Sécurité"]) expect(html, t).not.toContain(`>${t}<`);   // none of the SSH rows
  });
  it("signale un droit manquant", () => {
    expect(renderToStaticMarkup(<FreeboxAccessSection fb={{ missing_rights: ["vm"] }} from={[]} />)).toContain("manquants : vm");
  });
});

describe("DHCP et DNS de la Freebox", () => {
  it("montre le serveur DHCP, sa plage et les DNS distribués", () => {
    const html = renderToStaticMarkup(<FreeboxNetwork dhcp={{ enabled: true, ip_range_start: "10.0.0.10", ip_range_end: "10.0.0.200", gateway: "10.0.0.254", netmask: "255.255.255.0", dns: ["10.0.0.254", "10.0.0.53"] }} />);
    for (const t of ["DHCP", "activé", "10.0.0.10 → 10.0.0.200", "passerelle 10.0.0.254", "masque 255.255.255.0", "DNS", "10.0.0.254 · 10.0.0.53"]) expect(html, t).toContain(t);
  });
  it("sans DNS annoncé : celui de la box ; sans bloc DHCP (MynetworK plus ancien) : rien", () => {
    expect(renderToStaticMarkup(<FreeboxNetwork dhcp={{ enabled: false, ip_range_start: null, ip_range_end: null, gateway: null, netmask: null, dns: [] }} />)).toContain("celui de la box");
    expect(renderToStaticMarkup(<FreeboxNetwork dhcp={undefined} />)).toBe("");
  });
});

describe("firmware de la Freebox dans la section Mises à jour", () => {
  const fb = { system: { firmware: "4.9.4", latest_firmware: "4.9.16", update_available: true }, firmware_update: { server: { installed: "4.9.4", latest: "4.9.16", update_available: true, date: "1 octobre 2026", changelog: null, url: "https://example.org/notes" } } };
  it("montre la version installée, puis celle proposée avec sa date et les notes de version", () => {
    const html = renderToStaticMarkup(<FreeboxFirmware fb={fb} />);
    for (const t of ["4.9.4", "→ 4.9.16", "1 octobre 2026", "notes de version", "https://example.org/notes"]) expect(html, t).toContain(t);
  });
  it("sans mise à jour : seulement la version ; version de l'offre inconnue de MynetworK : le dit", () => {
    const html = renderToStaticMarkup(<FreeboxFirmware fb={{ system: { firmware: "4.9.4", update_available: false } }} />);
    expect(html).toContain("4.9.4");
    expect(html).not.toContain("Disponible");
    expect(renderToStaticMarkup(<FreeboxFirmware fb={{ system: { firmware: "4.9.4", update_available: null } }} />)).toContain("non transmise par MynetworK");
  });
  it("la section Mises à jour de la fiche l'affiche, et le Système ne l'a plus", () => {
    const h2 = freeboxHealth(m, { connection: { state: "up" }, ...fb });
    expect(renderToStaticMarkup(<UpdatesSection h={h2} windows={false} from={[]} freebox={fb} />)).toContain("→ 4.9.16");
  });
});

describe("sondes côte à côte", () => {
  it("une case par sonde, dans l'ordre des noms (CPU 2 avant CPU 10), la valeur à part du nom", () => {
    const html = renderToStaticMarkup(<ProbeChips items={[{ name: "CPU 10", value: "61 °C", tone: "" }, { name: "CPU 2", value: "59 °C", tone: "" }, { name: "Disque", value: "92 °C", tone: "text-bad" }]} />);
    expect(html.indexOf("CPU 2")).toBeLessThan(html.indexOf("CPU 10"));
    expect(html.indexOf("CPU 10")).toBeLessThan(html.indexOf("Disque"));
    expect(html).toContain("text-bad");
    expect(html.match(/rounded-md/g)).toHaveLength(3);
  });
});

describe("état d'un disque interne", () => {
  it("le modèle, puis l'état, la température et SMART en marques séparées ; seul un problème est en couleur", () => {
    const ok = renderToStaticMarkup(<DriveStatus d={{ model: "SSD 1TB", state: "enabled", temperature: 50, smart_ok: true }} />);
    for (const x of ["SSD 1TB", "actif", "50 °C", "SMART OK"]) expect(ok, x).toContain(x);
    expect(ok).not.toContain("text-bad");
    const bad = renderToStaticMarkup(<DriveStatus d={{ model: "SSD", state: "error", temperature: 90, smart_ok: false }} />);
    expect(bad).toContain("SMART en défaut");
    expect(bad).toContain("error");
    expect(renderToStaticMarkup(<DriveStatus d={{ model: "SSD", state: "enabled", temperature: null, smart_ok: null }} />)).toContain("SMART inconnu");
  });
});

describe("Wi-Fi de la Freebox", () => {
  const wifi = { enabled: true, stations_count: 3,
    aps: [{ name: "5G1", state: "active", band: "5g", channel: 52, width: "160" }, { name: "2.4G", state: "disabled", band: "2d4g", channel: 0, width: "40" }],
    networks: [{ ssid: "Maison", enabled: true, hidden: false, state: "active", band: "5g" }, { ssid: "Cache", enabled: false, hidden: true, state: null, band: "2d4g" }] };
  it("compte les bandes actives, détaille la bande active et grise celle qui est désactivée", () => {
    const html = renderToStaticMarkup(<FreeboxWifi wifi={wifi} />);
    for (const x of ["1 bande(s) active(s) sur 2", "3 appareil(s)", "5G1", "5 GHz · ch. 52 · 160 MHz", "désactivée", "opacity-50", "Maison", "masqué"]) expect(html, x).toContain(x);
  });
  it("Wi-Fi coupé : le dit", () => {
    expect(renderToStaticMarkup(<FreeboxWifi wifi={{ enabled: false, aps: [], stations_count: null }} />)).toContain("coupé");
  });
});
