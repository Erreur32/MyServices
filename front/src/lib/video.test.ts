import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import type { Host, ServiceStatus } from "../types";
import { cameraPlace, hasStream, recorderAt, streamAlerts, streamCameras, streamCards, streamFigures, streamFlows, streamStorage } from "./video";

const host = (h: Partial<Host>): Host => ({ id: 1, type: "local", enabled: true, domains: [], backend: { up: true, ms: 1 }, ...h } as Host);
const conn = (c: Partial<ServiceStatus>): ServiceStatus => ({ connector: "x", name: "x", label: "X", ok: true, stale: false, message: "OK", ...c });
const snap = (hosts: Host[], status: ServiceStatus[]): Snapshot =>
  ({ data: { hosts, services_status: status, machine_list: [{ ip: "10.0.0.20", name: "Tower" }] } } as unknown as Snapshot);

const frigate = conn({ connector: "frigate", name: "tower", url: "http://10.0.0.20:5000", problems: ["caméra « jardin » sans image"], stream: {
  role: "nvr", engine: "Frigate", snapshot: true, events: 12, labels: { person: 9, car: 3 }, detector_ms: 140, storage: { used: 930, total: 1000 },
  cameras: [{ name: "entree", up: true, detect: true, record: true, events: 10 }, { name: "jardin", up: false, detect: false, record: false }] } });
const go2rtc = conn({ connector: "go2rtc", name: "tower", url: "http://10.0.0.20:1984", stream: {
  role: "relay", engine: "go2rtc", streams: [{ name: "Entree", ready: true, codec: "H.264", readers: 2, kinds: ["RTSP"] }, { name: "portail", ready: false, readers: 0, kinds: [] }] } });
const owncast = conn({ connector: "owncast", name: "o", url: "http://10.0.0.20:8080", stream: { role: "live", engine: "Owncast", live: { online: true, viewers: 4 } } });

describe("where a camera films", () => {
  it("keeps the Netatmo cameras once when the connector and Home Assistant both read them", () => {
    const stream = { role: "nvr" as const, engine: "Netatmo", cameras: [{ name: "Salon", up: true }], snapshot: true };
    const ha = conn({ connector: "home-assistant", name: "Home", stream }), direct = conn({ connector: "netatmo", name: "netatmo", stream });
    const of = (list: ServiceStatus[]) => streamCameras(streamCards(snap([], list))).map((c) => c.card.conn?.connector);
    expect(of([ha])).toEqual(["home-assistant"]);
    expect(of([ha, direct])).toEqual(["netatmo"]);
  });

  it("the connector knows best, else the name tells", () => {
    expect(cameraPlace({ name: "jardin", place: "int" })).toBe("int");
    expect(cameraPlace({ name: "ext_360" })).toBe("ext");
    expect(cameraPlace({ name: "Netatmo int salon" })).toBe("int");
    expect(cameraPlace({ name: "cam32" })).toBe("other");
    expect(cameraPlace({ name: "texte" })).toBe("other");
  });
});

describe("Video page", () => {
  it("one card per video connector, then the video rows of Services none reads", () => {
    const hosts = [
      host({ id: 1, ip: "10.0.0.20", port: 5000, category: "Stream", app: { key: "frigate", label: "Frigate", confidence: "sure", connector: "frigate" } }),
      host({ id: 2, ip: "10.0.0.20", port: 8000, category: "Domotique", app: { key: "zoneminder", label: "ZoneMinder", confidence: "sure", connector: null } }),
      host({ id: 3, ip: "10.0.0.20", port: 8096, category: "Médias", name: "jellyfin" }),
    ];
    const cards = streamCards(snap(hosts, [go2rtc, frigate, owncast]));
    expect(cards.map((c) => [c.title, c.role, c.tone, c.unread])).toEqual([
      ["Frigate", "nvr", "warn", false], ["ZoneMinder", "nvr", "ok", true], ["go2rtc", "relay", "ok", false], ["Owncast", "live", "ok", false],
    ]);
  });

  it("a video connector written before the « stream » block still counts", () => {
    const [c] = streamCards(snap([], [conn({ connector: "shinobi", url: "http://10.0.0.20:8080" })]));
    expect([c.title, c.role]).toEqual(["Shinobi", "nvr"]);
    expect(hasStream(snap([], []))).toBe(false);
    expect(hasStream(snap([host({ category: "Stream" })], []))).toBe(true);
  });

  it("cameras: the silent ones first, with the relays that carry a stream of the same name", () => {
    const cards = streamCards(snap([], [frigate, go2rtc]));
    expect(streamCameras(cards).map((c) => [c.name, c.up, c.relays])).toEqual([["jardin", false, []], ["entree", true, ["go2rtc"]]]);
  });

  it("flows: the relayed streams with their camera, and the live broadcast", () => {
    const flows = streamFlows(streamCards(snap([], [frigate, go2rtc, owncast])));
    expect(flows.map((f) => [f.name, f.ready, f.camera, !!f.live])).toEqual([
      ["portail", false, undefined, false], ["Entree", true, "entree", false], ["Owncast", true, undefined, true],
    ]);
  });

  it("figures and storage: only what was read", () => {
    const cards = streamCards(snap([], [frigate, go2rtc]));
    expect(streamStorage(cards).map((s) => s.pct)).toEqual([93]);
    const f = streamFigures(cards);
    expect([f.cameras, f.filming, f.recording, f.detecting, f.events, f.labels, f.fullest?.pct]).toEqual([2, 1, 1, 1, 12, { person: 9, car: 3 }, 93]);
    expect(streamFigures(streamCards(snap([], [go2rtc]))).events).toBeNull();
  });

  it("alerts: problems, full storage, slow detector, stream without a source", () => {
    const lines = streamAlerts(streamCards(snap([], [frigate, go2rtc])));
    expect(lines.map((l) => [l.title, l.hash])).toEqual([
      ["Frigate : caméra « jardin » sans image", "#stream/cameras"],
      ["Enregistrements de Frigate à 93 %", "#stream/recordings"],
      ["Détecteur de Frigate lent : 140 ms par image", "#stream/cameras"],
      ["Flux « portail » sans source", "#stream/flows"],
    ]);
  });
});

describe("the recorder of a device", () => {
  const row = (connector: string) => ({ connector, instance: connector, name: connector, stream: { role: "nvr", engine: connector, snapshot: true, cameras: [{ name: `${connector} cam`, ip: "10.0.0.5", up: true }] } });
  it("takes a recorder before the Tapo connector's own picture", () => {
    const snap = { data: { services_status: [row("tapo"), row("frigate")] } } as unknown as Snapshot;
    expect(recorderAt(snap, "10.0.0.5")?.connector).toBe("frigate");
  });
  it("falls back on the Tapo connector", () => {
    expect(recorderAt({ data: { services_status: [row("tapo")] } } as unknown as Snapshot, "10.0.0.5")?.connector).toBe("tapo");
  });
});
