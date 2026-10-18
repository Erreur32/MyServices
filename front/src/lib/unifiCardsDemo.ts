// Sample UniFi devices in the shape of MynetworK's GET /api/plugins/unifi/card-devices (a gateway, a switch and an access point).
// Used to preview the cards without any controller, and by the tests. The names, addresses and MACs are made up.
const GATEWAY_MAC = "aa:bb:cc:00:00:01", SWITCH_MAC = "aa:bb:cc:00:00:02";

const port = (n: number, up: boolean, speed: number, rx: number, tx: number, extra: Record<string, unknown> = {}) =>
  ({ port_idx: n, name: `Port ${n}`, up, speed: up ? speed : 0, media: "GE", "rx_bytes-r": up ? rx : 0, "tx_bytes-r": up ? tx : 0, ...extra });
const poe = (n: number, up: boolean, watts: number, rx: number, tx: number) =>
  port(n, up, 1000, rx, tx, { port_poe: true, poe_enable: up, poe_power: up ? watts : 0 });

export const DEMO_UNIFI_DEVICES: Record<string, unknown>[] = [
  {
    mac: GATEWAY_MAC, name: "Passerelle", type: "udm", model: "UCGFIBER", model_name: "Cloud Gateway Fiber", ip: "192.168.1.1", state: 1,
    version: "4.1.13", uptime: 1_209_600, num_sta: 41, general_temperature: 52, "system-stats": { cpu: 9.5, mem: 43.1, temps: { CPU: 52 } },
    wan1: { name: "WAN", ifname: "eth6", up: true, speed: 10000, type: "wire" },
    port_table: [port(1, true, 2500, 120_000, 480_000), port(2, false, 0, 0, 0), port(3, true, 1000, 8_000, 12_000), port(4, true, 2500, 1_500_000, 3_200_000),
      port(5, true, 10000, 9_000_000, 22_000_000, { name: "WAN", media: "SFP+" })],
  },
  {
    mac: SWITCH_MAC, name: "Switch salon", type: "usw", model: "USWED37", model_name: "USW Flex 2.5G 8 PoE", hw_version: "1", ip: "192.168.1.4", state: 1,
    version: "7.0.50", uptime: 864_000, num_sta: 12, general_temperature: 41, "system-stats": { cpu: 13.2, mem: 40.5, temps: { CPU: 48 } },
    uplink: { type: "wire", uplink_mac: GATEWAY_MAC, uplink_remote_port: 4, port_idx: 9, speed: 2500 },
    port_table: [poe(1, true, 3.2, 11_116, 185_617), poe(2, true, 7.9, 450_000, 90_000), port(3, true, 1000, 3_000, 4_000), port(4, false, 0, 0, 0),
      poe(5, true, 12.4, 2_300_000, 640_000), port(6, true, 2500, 880_000, 1_900_000), port(7, false, 0, 0, 0), port(8, true, 1000, 20_000, 15_000),
      port(9, true, 2500, 1_700_000, 3_100_000, { name: "Uplink", is_uplink: true })],
  },
  { mac: "aa:bb:cc:00:00:03", name: "Borne couloir", type: "uap", model: "U6LR", model_name: "U6 Long-Range", ip: "192.168.1.5", state: 1, version: "6.6.77",
    uptime: 432_000, num_sta: 7, "system-stats": { cpu: 6.1, mem: 35.4 }, uplink: { type: "wire", uplink_mac: SWITCH_MAC, uplink_remote_port: 3, speed: 1000 } },
];
