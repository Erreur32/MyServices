import { describe, expect, it } from "vitest";
import { matchesFilter, softwareRows } from "./softwareRows";
import type { Host, Machine } from "../types";

const box = (name: string, up = true) => ({ name, image: `${name}:1`, status: "", up, host_net: false, ports: [], local_ports: [] });
const site = (domain: string, name: string, port: number, behind?: string) =>
  ({ type: "proxy", ip: "10.0.0.2", npm: "NPM", port, domains: [domain], service: { kind: "docker", name, behind: behind ? { kind: null, name: behind, addr: "" } : null } }) as unknown as Host;
const web = (label: string, name: string, mode: "docker" | "service") => ({ key: label, label, mode, name, ports: [80], up: true, host_net: false, target: null, behind: null });
const machine = { ip: "10.0.0.2", web: [web("Apache", "apache2", "service"), web("NPM", "npm", "docker")], containers: [box("npm"), box("kuma"), box("cache"), box("old", false)] } as unknown as Machine;
const hosts = [site("a.lan", "apache2 · a", 8443, "Anubis"), site("b.lan", "apache2 · b", 8443), site("k.lan", "kuma", 3001), site("x.lan", "other", 9000)];

describe("lignes de Logiciels et services", () => {
  const rows = softwareRows(machine, hosts);

  it("un conteneur déjà serveur web n'apparaît qu'une fois, les serveurs web d'abord", () => {
    expect(rows.map((r) => r.name)).toEqual(["Apache", "NPM", "kuma", "other", "cache", "old"]);
  });

  it("les sites d'Apache rejoignent sa ligne, avec leur chemin sur une ligne", () => {
    expect(rows[0].domains).toEqual(["a.lan", "b.lan"]);
    expect(rows[0].paths[0]).toBe("NPM → apache2 · a :8443 → Anubis");
  });

  it("un site sans conteneur connu garde sa ligne", () => {
    expect(rows.find((r) => r.name === "other")?.domains).toEqual(["x.lan"]);
  });

  it("les filtres : serveurs web, conteneurs, sans service", () => {
    const names = (f: "web" | "docker" | "alone") => rows.filter((r) => matchesFilter(r, f)).map((r) => r.name);
    expect(names("web")).toEqual(["Apache", "NPM"]);
    expect(names("docker")).toEqual(["NPM", "kuma", "cache", "old"]);
    expect(names("alone")).toEqual(["cache", "old"]);
  });

  it("une machine sans rien ne donne aucune ligne", () => {
    expect(softwareRows({ ip: "10.0.0.9" } as Machine, hosts)).toEqual([]);
  });

  describe("programmes et services systemd", () => {
    const proc = (name: string, port: number) => ({ type: "host", ip: "10.0.0.2", port, domains: [], service: { kind: "process", name } }) as unknown as Host;
    const units = [{ name: "apache2", own: false }, { name: "ssh", own: false }, { name: "backup-job", own: true }, { name: "cron", own: false }, { name: "tool", own: true }];
    const got = softwareRows({ ...machine, info: { units } } as Machine, [...hosts, proc("sshd", 22), proc("tool", 9100), proc("tool", 9101), proc("python", 8000)]);
    const line = (name: string) => got.find((r) => r.name === name);

    it("un process et son service font une ligne, sshd rejoint ssh", () => {
      expect(line("sshd")).toMatchObject({ mode: "service", ports: [22], system: false });
      expect(line("ssh")).toBeUndefined();
      expect(line("tool")).toMatchObject({ mode: "service", ports: [9100, 9101], own: true });
    });

    it("un process sans service connu reste un programme", () => {
      expect(line("python")).toMatchObject({ mode: "process", ports: [8000] });
    });

    it("un serveur web déjà listé n'a pas de seconde ligne", () => {
      expect(got.filter((r) => /apache/i.test(r.name)).map((r) => r.name)).toEqual(["Apache"]);
    });

    it("les services de paquet sans port sont rangés à part, les services maison restent visibles", () => {
      const names = (f: "all" | "program" | "system") => got.filter((r) => matchesFilter(r, f)).map((r) => r.name);
      expect(names("system")).toEqual(["cron"]);
      expect(names("all")).not.toContain("cron");
      expect(names("program")).toEqual(["backup-job", "python", "sshd", "tool"]);
    });
  });
});
