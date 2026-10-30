// « Domotique › Tapo »: what the Tapo connector read (plugs with their power, cameras, lights, hub sensors), sorted for the page and the overview.
import type { Snapshot } from "../api";
import type { ServiceStatus, TapoDevice } from "../types";

export const tapoRows = (snap: Snapshot): ServiceStatus[] => (snap.data.services_status ?? []).filter((c) => c.connector === "tapo");
/** A Tapo connector is set up, whatever it read (its page then says why it reads nothing) */
export const hasTapo = (snap: Snapshot): boolean => tapoRows(snap).length > 0;

const sum = (ns: (number | null | undefined)[]): number | null => {
  const got = ns.filter((n): n is number => typeof n === "number");
  return got.length ? got.reduce((a, b) => a + b, 0) : null;
};

export function tapoDevices(snap: Snapshot): TapoDevice[] {
  return tapoRows(snap).flatMap((c) => c.devices ?? []);
}

export interface TapoSummary {
  watts: number | null;          // power of the plugs that are on, W
  today_kwh: number | null;
  month_kwh: number | null;
  cameras: { up: number; total: number };
  devices: number;
  offline: string[];             // names
  problems: string[];
}

/** The figures of the Tapo devices, null without a Tapo connector */
export function tapoSummary(snap: Snapshot): TapoSummary | null {
  if (!hasTapo(snap)) return null;
  const all = tapoDevices(snap), metered = all.filter((d) => d.power_w != null), cams = all.filter((d) => d.kind === "camera");
  const wh = (key: "today_wh" | "month_wh") => { const n = sum(metered.map((d) => d[key])); return n === null ? null : n / 1000; };
  return {
    watts: sum(metered.filter((d) => d.on !== false).map((d) => d.power_w)), today_kwh: wh("today_wh"), month_kwh: wh("month_wh"),
    cameras: { up: cams.filter((d) => d.online).length, total: cams.length }, devices: all.length,
    offline: all.filter((d) => !d.online).map((d) => d.name), problems: tapoRows(snap).flatMap((c) => c.problems ?? []),
  };
}

/** The devices by what they are: plugs (with a meter first), cameras, the rest (lights, hubs, sensors) */
export function tapoGroups(snap: Snapshot) {
  const all = tapoDevices(snap);
  return {
    all, plugs: all.filter((d) => d.kind === "plug").sort((a, b) => Number(b.power_w != null) - Number(a.power_w != null)),
    cameras: all.filter((d) => d.kind === "camera"), others: all.filter((d) => !["plug", "camera"].includes(d.kind)),
  };
}

export type TapoTone = "ok" | "warn" | "bad";
/** The state of the connector for the banner: the account works, the last read is old, or Tapo refused */
export function tapoState(snap: Snapshot): { tone: TapoTone; message: string } {
  const rows = tapoRows(snap), bad = rows.find((c) => !c.ok);
  if (bad) return { tone: "bad", message: bad.message };
  return rows.some((c) => c.stale) ? { tone: "warn", message: "stale" } : { tone: "ok", message: "" };
}

/** Wi-Fi signal as 0 to 4 bars from the RSSI in dBm */
export const wifiBars = (rssi: number | null | undefined): number => {
  if (rssi == null) return 0;
  const step = [-55, -65, -75].findIndex((limit) => rssi >= limit);
  return step < 0 ? 1 : 4 - step;
};
