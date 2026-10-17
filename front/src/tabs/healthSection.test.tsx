import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Machine } from "../types";
import { freeboxHealth } from "../lib/freebox";
import { FreeboxAccessSection, FreeboxNetwork, HealthSection, UpdatesSection } from "./Machines";

const m = { ip: "10.0.0.254", name: "Freebox", ping: true, off: false, services: 0, npm: 0, down: 0 } as Machine;
const h = freeboxHealth(m, {
  connection: { state: "up", media: "ftth" },
  system: { model: "Freebox v9 (r1)", uptime: 508155, fans: [{ id: "fan0", name: "Ventilateur 1", value: 600 }], sensors: [{ id: "temp_cpu0", name: "CPU 0", value: 58 }, { id: "temp_cpu1", name: "CPU 1", value: 60 }, { id: "temp_hdd", name: "Disque", value: 62 }] },
  storage: { disks: [], partitions: [{ label: "NVME 32", fstype: "ext4", total_bytes: 917e9, used_bytes: 506e9, free_bytes: 411e9, used_pct: 55 }] },
  vms: [{ id: 0, name: "FreeMachine", status: "stopped", vcpus: 2, memory_mb: 2048, os: "debian" }],
  vm_system: { total_memory_mb: 2048, used_memory_mb: 0, total_cpus: 2, used_cpus: 0, memory_pct: 0, cpu_pct: 0 },
});

describe("section Santé de la fiche d'une Freebox", () => {
  it("montre le niveau, la partition, la température du processeur, la mémoire VM et l'état des VM", () => {
    const html = renderToStaticMarkup(<HealthSection h={h} from={[]} />);
    for (const t of ["NVME 32", "55 %", "411 Go libres", "60 °C", "Sondes", "Disque 62 °C", "Ventilateur", "600", "Mémoire VM", "0 en marche sur 1"]) expect(html, t).toContain(t);
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
  it("dit « à jour » sans mise à jour", () => {
    expect(renderToStaticMarkup(<UpdatesSection h={h} windows={false} from={[]} />)).toContain("à jour");
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
