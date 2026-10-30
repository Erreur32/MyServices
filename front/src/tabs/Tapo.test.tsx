import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { Tapo } from "./Tapo";

// The Tapo page rendered without a browser, from a connector row in the shape of data.json
const snap = {
  me: { role: "admin" },
  data: { services_status: [{ connector: "tapo", name: "t", label: "Tapo", ok: true, stale: false, message: "OK", problems: ["C310 ne répond plus"], devices: [
    { id: "p1", name: "Prise bureau", model: "P110M", kind: "plug", online: true, on: true, ip: "192.0.2.21", rssi: -58, fw: "1.3.2", power_w: 86, today_wh: 1840, month_wh: 41200, peak_w: 142, series: [[0, 40], [3600, 142]] },
    { id: "c1", name: "C310", model: "C310", kind: "camera", online: false }, { id: "s1", name: "Chambre", model: "T315", kind: "sensor", online: true, temperature: 19.4, humidity: 52, parent: "Hub" },
  ] }] },
} as unknown as Snapshot;

describe("Tapo page", () => {
  it("shows the plug figures, the offline camera and the table", () => {
    const html = renderToStaticMarkup(<Tapo snap={snap} />);
    for (const text of ["Prise bureau", "86", "1,84 kWh", "142 W", "C310", "Hors ligne", "192.0.2.21", "Compte Tapo connecté", "1 appareils Tapo".replace("1", "3")]) expect(html).toContain(text);
  });

  it("says why when the account is refused", () => {
    const refused = { data: { services_status: [{ connector: "tapo", ok: false, stale: false, message: "Tapo refuse ce compte", devices: [] }] }, me: { role: "user" } } as unknown as Snapshot;
    expect(renderToStaticMarkup(<Tapo snap={refused} />)).toContain("Tapo refuse ce compte");
  });
});
