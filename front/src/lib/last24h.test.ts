import { describe, expect, it } from "vitest";
import type { Host } from "../types";
import { imageService, last24h, logoOf, plainLabel, serviceOfEvent, serviceOfRow } from "./last24h";

const NOW = Date.parse("2026-10-10T12:00:00+02:00");
const at = (h: number) => new Date(NOW - h * 3600e3).toISOString();

describe("last 24 hours", () => {
  it("nothing happened", () => {
    expect(last24h([], {}, {}, NOW)).toMatchObject({ total: 0, rows: [] });
  });
  it("one row per kind, worst first, names once, old events ignored", () => {
    const events = [
      { ts: at(1), kind: "panne", label: "plex.lan" }, { ts: at(2), kind: "panne", label: "plex.lan" }, { ts: at(3), kind: "panne", label: "sonarr.lan" },
      { ts: at(30), kind: "panne", label: "vieux.lan" },
    ];
    const got = last24h(events, { panne: "🔴 Panne" }, { panne: 3 }, NOW);
    expect(got.total).toBe(3);
    expect(got.rows.map((r) => [r.label, r.count, r.who])).toEqual([["Panne", 3, ["plex.lan", "sonarr.lan"]]]);
    expect(got.hours).toHaveLength(24);
    expect(got.hours.reduce((n, h) => n + h.n, 0)).toBe(3);
    expect(got.hours[22].n).toBe(1);   // one hour ago: the last bars are the most recent hours
  });
  it("only what is still a problem: a return to normal shows nothing and settles the failure before it", () => {
    const events = [
      { ts: at(5), kind: "hors_ligne", key: "m1", label: "revenue" }, { ts: at(4), kind: "en_ligne", key: "m1", label: "revenue" },
      { ts: at(3), kind: "hors_ligne", key: "m2", label: "tombee" }, { ts: at(2), kind: "en_ligne", key: "m2", label: "tombee" }, { ts: at(1), kind: "hors_ligne", key: "m2", label: "tombee" },
      { ts: at(2), kind: "panne", key: "s1", label: "toujours" }, { ts: at(1), kind: "en_ligne", key: "s1", label: "autre type" },
      { ts: at(1), kind: "vm_marche", key: "v1", label: "vm" },
    ];
    const got = last24h(events, {}, {}, NOW);
    expect(got.rows.map((r) => [r.kind, r.count, r.who])).toEqual([["hors_ligne", 1, ["tombee"]], ["panne", 1, ["toujours"]]]);
  });
  it("finds the service of an event by its key, nothing for a machine", () => {
    const hosts = [{ type: "proxy", id: 348 }, { type: "local", id: "10.0.0.1:80" }] as unknown as Host[];
    expect(serviceOfEvent(hosts, "proxy:348")).toBe(hosts[0]);
    expect(serviceOfEvent(hosts, "local:10.0.0.1:80")).toBe(hosts[1]);
    expect(serviceOfEvent(hosts, "machine:10.0.0.1")).toBeUndefined();
    expect(serviceOfEvent(hosts)).toBeUndefined();
  });
  it("an image to update finds its service by the container's name, else keeps its image", () => {
    const hosts = [{ type: "local", id: "10.0.0.1:80", service: { name: "paperless" } }] as unknown as Host[];
    const row = { kind: "maj_image", keys: { paperless: "maj_image:x:paperless", redis: "maj_image:x:redis" }, targets: { redis: "docker.io/redis:7" } };
    expect(serviceOfRow(hosts, row, "paperless")).toBe(hosts[0]);
    expect(serviceOfRow(hosts, row, "redis")).toBeUndefined();
    expect(serviceOfRow(hosts, { ...row, kind: "panne" }, "paperless")).toBeUndefined();
    expect(imageService(row, "redis")).toEqual({ service: { name: "redis", image: "docker.io/redis:7", kind: "docker" } });
    expect(imageService({ ...row, kind: "panne" }, "redis")).toBeNull();
  });
  it("a domain never takes the logo of the Docker behind it, a local service does", () => {
    const service = { kind: "docker", name: "immich_server" };
    expect(logoOf({ type: "proxy", service } as unknown as Host).service?.kind).toBeUndefined();
    expect(logoOf({ type: "local", service } as unknown as Host).service?.kind).toBe("docker");
  });
  it("new means never seen: what the history already knows is left out, even after it disappeared", () => {
    const events = [
      { ts: at(1), kind: "nouveau", key: "s1", label: "vraiment" }, { ts: at(2), kind: "nouveau", key: "s2", label: "revenu" },
      { ts: at(200), kind: "nouveau", key: "s2", label: "revenu" }, { ts: at(199), kind: "disparu", key: "s2", label: "revenu" },
      { ts: at(1), kind: "nouveau", label: "sans clé" },
    ];
    expect(last24h(events, {}, {}, NOW).rows[0].who).toEqual(["vraiment", "sans clé"]);
  });
  it("keeps what each name is about", () => {
    const got = last24h([{ ts: at(1), kind: "panne", label: "plex.lan", key: "proxy:1" }], {}, {}, NOW);
    expect(got.rows[0].keys).toEqual({ "plex.lan": "proxy:1" });
  });
  it("drops the emoji of a label", () => {
    expect(plainLabel("🔴 Panne")).toBe("Panne");
    expect(plainLabel("Sans emoji")).toBe("Sans emoji");
  });
});
