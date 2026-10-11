import { describe, expect, it } from "vitest";
import { localVia, originOf } from "./eventOrigin";

describe("origine d'un événement", () => {
  it("ping et SSH : lus par la collecte", () => {
    expect(originOf({ kind: "hors_ligne", key: "machine:10.0.0.5" })).toEqual({ method: "Ping", via: ["Collecte"] });
    expect(originOf({ kind: "ssh_ok", key: "machine:10.0.0.5" }).method).toBe("SSH");
  });

  it("santé : les sources de la machine", () => {
    expect(originOf({ kind: "health_crit", key: "health:pc" }, ["agent", "beszel"]).via).toEqual(["agent MyServices", "Beszel"]);
  });

  it("connecteur : son nom lisible", () => {
    expect(originOf({ kind: "connecteur", key: "connecteur:uptime-kuma/uptime-kuma" }).via).toEqual(["Uptime Kuma"]);
    expect(originOf({ kind: "connecteur", key: "connecteur:inconnu/x" }).via).toEqual(["inconnu"]);
  });

  it("services : NPM, ou ce qui lit réellement le port local (jamais Docker par défaut)", () => {
    expect(originOf({ kind: "nouveau", key: "local:10.0.0.5:8080" }).via).toEqual(["Collecte"]);   // ligne inconnue : on ne devine pas
    expect(originOf({ kind: "nouveau", key: "local:10.0.0.5:8080" }, [], localVia("docker")).via).toEqual(["Docker"]);
    expect(originOf({ kind: "nouveau", key: "local:10.0.0.5:445" }, [], localVia("process", true)).via).toEqual(["agent MyServices"]);   // PC Windows : pas de Docker
    expect(originOf({ kind: "nouveau", key: "local:10.0.0.5:22" }, [], localVia("process")).via).toEqual(["Ports (SSH)"]);
    expect(originOf({ kind: "retabli", key: "redirect:5" })).toEqual({ method: "Sonde HTTP", via: ["NPM"] });
    expect(originOf({ kind: "dns", key: "_dns" }).via).toEqual(["AdGuard Home"]);
  });
});
