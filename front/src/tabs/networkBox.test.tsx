import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NetworkBox } from "./NetworkBox";
import type { BoxReading, ServiceStatus } from "../types";

const EMPTY: BoxReading = { model: null, line: null, connected: null, down_bps: null, up_bps: null, line_down_bps: null, line_up_bps: null, public_ip: null, uptime_s: null,
  firmware: null, update_available: null, latest_firmware: null, devices: null, wifi: null, temperature: null };
const card = (box: Partial<BoxReading>) => ({ connector: "upnp-box", name: "b", instance: "b", label: "Box internet (UPnP IGD)", ok: true, stale: false, message: "OK", box: { ...EMPTY, ...box } }) as ServiceStatus;
const show = (box: Partial<BoxReading>) => renderToStaticMarkup(<NetworkBox cards={[card(box)]} stamp="2026-10-30T12:00:00" />);

describe("NetworkBox", () => {
  it("a generic box: the public address in clear, no empty section", () => {
    const html = show({ model: "Acme Box 7", line: "dsl", connected: true, down_bps: 18_400_000, up_bps: 1_200_000, line_down_bps: 40_000_000, line_up_bps: 2_000_000, public_ip: "1.1.1.42", uptime_s: 3600 });
    expect(html).toContain("Acme Box 7");
    expect(html).toContain("1.1.1.42");
    expect(html).toContain("Débits");
    expect(html).not.toContain("Système");
    expect(html).not.toContain("Température");
  });

  it("a full box shows its system", () => {
    const html = show({ firmware: "4.9.2", update_available: true, latest_firmware: "4.9.3", devices: 27, wifi: true, temperature: 51 });
    expect(html).toContain("4.9.2");
    expect(html).toContain("→ 4.9.3");
    expect(html).toContain("Système");
  });

  it("a line that is down: its state, no current rates", () => {
    const html = show({ connected: false, down_bps: 1000, line_down_bps: 40_000_000 });
    expect(html).toContain("coupée");
    expect(html).not.toContain("Débits");
  });
});
