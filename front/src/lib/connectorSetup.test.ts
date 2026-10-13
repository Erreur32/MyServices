import { describe, expect, it } from "vitest";
import { serviceAt, setupCommand } from "./connectorSetup";
import type { Host } from "../types";

describe("setupCommand: the command for the Nextcloud that was found", () => {
  it("site of a web server: its folder, run as the owner of config.php", () => {
    const c = setupCommand("nextcloud", { kind: "apache", docroot: "/home/nextcloud/nextcloud/" })!;
    expect(c.code).toContain('sudo -u "$(stat -c %U /home/nextcloud/nextcloud/config/config.php)" php /home/nextcloud/nextcloud/occ config:app:set serverinfo token');
  });
  it("container: its name, and the right form for its image", () => {
    expect(setupCommand("nextcloud", { kind: "docker", name: "cloud", image: "nextcloud:30" })!.code).toContain("docker exec -u www-data cloud php occ");
    expect(setupCommand("nextcloud", { kind: "docker", name: "nc", image: "lscr.io/linuxserver/nextcloud" })!.code).toContain("docker exec nc occ");
    expect(setupCommand("nextcloud", { kind: "docker", name: "nextcloud-aio-nextcloud", image: "nextcloud/aio-nextcloud" })!.title).toContain("All-in-One");
  });
  it("unknown install or another connector: nothing", () => {
    expect(setupCommand("nextcloud", { kind: "process" })).toBeNull();
    expect(setupCommand("arcane", { kind: "docker", name: "x" })).toBeNull();
    expect(setupCommand("nextcloud", null)).toBeNull();
  });
});

describe("serviceAt: the install behind the address typed", () => {
  const hosts = [{ id: 1, ip: "10.0.0.5", port: 8150, service: { kind: "apache", docroot: "/srv/nc" }, app: { key: "nextcloud", label: "Nextcloud", confidence: "sure", connector: "nextcloud" } },
    { id: 2, ip: "10.0.0.5", port: 443, service: { kind: "docker", name: "proxy" } }] as unknown as Host[];
  it("same IP and port", () => expect(serviceAt("http://10.0.0.5:8150/", hosts, "nextcloud")?.docroot).toBe("/srv/nc"));
  it("default port of https", () => expect(serviceAt("https://10.0.0.5", hosts, "nextcloud")?.name).toBe("proxy"));
  it("nothing there, or not an address", () => {
    expect(serviceAt("http://10.0.0.9:1", hosts, "nextcloud")).toBeUndefined();
    expect(serviceAt("pas une adresse", hosts, "nextcloud")).toBeUndefined();
  });
});
