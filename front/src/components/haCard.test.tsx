import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ServiceStatus } from "../types";
import { ServiceCard } from "./ServiceStatusCards";

// Home Assistant card rendered without a browser, from the connector's output (home_assistant.py collect)
const base: ServiceStatus = {
  connector: "home-assistant", name: "ha", label: "Home Assistant", ok: true, stale: false, message: "OK", version: "2026.10.1", url: "http://ha:8123",
  state: "RUNNING", entities: 812, unavailable: 14, unavailable_names: ["Cave", "Garage"], batteries_low: ["Capteur porte"], automations: { on: 30, total: 34 },
  host: { cpu: 12, mem_pct: 85, temp: 52, disks: [{ mount: "/", used_pct: 40, size_gb: 100 }], ips: ["10.0.0.200"], boot: new Date(Date.now() - 3 * 86400e3).toISOString() },
  updates: [{ name: "Core", installed: "2026.10.1", latest: "2026.10.2", group: "core" }, { name: "ESPHome", installed: "1", latest: "2", group: "other" }],
};

describe("carte Home Assistant", () => {
  it("state, host gauges, key figures and folded lists", () => {
    const html = renderToStaticMarkup(<ServiceCard s={base} />);
    for (const t of ["Mise à jour disponible : 2026.10.2", "hôte allumé depuis 3 j", "85 %", "52 °C", "812", "30/34", "Piles faibles", "Capteur porte", "Cave", "… et 12 autres", "ESPHome"]) expect(html, t).toContain(t);
    expect(html).toContain("text-warn");   // memory at 85 %: warning tone
  });
  it("up to date, without System Monitor", () => {
    const html = renderToStaticMarkup(<ServiceCard s={{ ...base, updates: [], host: undefined, batteries_low: [] }} />);
    expect(html).toContain("Home Assistant à jour");
    expect(html).not.toContain("Processeur");
  });
  it("lists the add-ons installed, with their icon from the API and the update waiting", () => {
    const html = renderToStaticMarkup(<ServiceCard s={{ ...base, instance: "home-assistant", addons: [
      { name: "Mosquitto broker", slug: "core_mosquitto", version: "7.1.1" }, { name: "Zigbee2MQTT", slug: "45df7312_zigbee2mqtt", version: "2.1", latest: "2.2" }] }} />);
    expect(html).toContain("Mosquitto broker");
    expect(html).toContain("api/v1/ha/home-assistant/addon-icon/core_mosquitto");
    expect(html).toContain("→ 2.2");
  });
});
