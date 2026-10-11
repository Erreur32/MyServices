import { describe, expect, it } from "vitest";
import { connectorsOf } from "./machineConnectors";

const c = (type: string, ip: string | undefined, ok = true) => ({ type, name: type, ok, message: ok ? "OK" : "panne", ip });

describe("connecteurs d'une machine", () => {
  it("garde ceux qui visent son IP, sans doublon", () => {
    const list = connectorsOf("10.0.0.5", [c("docker", "10.0.0.5"), c("process", "10.0.0.5"), c("docker", "10.0.0.9"), c("npm", undefined)], false);
    expect(list.map((x) => x.label)).toEqual(["Docker", "Ports"]);
  });

  it("ajoute MynetworK, l'agent et Beszel, mais pas SSH", () => {
    const list = connectorsOf("10.0.0.5", [], true, ["ssh", "agent", "beszel"]);
    expect(list.map((x) => x.label)).toEqual(["MynetworK", "Agent", "Beszel"]);
  });

  it("signale un connecteur en panne", () => {
    expect(connectorsOf("10.0.0.5", [c("proxmox", "10.0.0.5", false)], false)[0].ok).toBe(false);
    expect(connectorsOf("10.0.0.5", [c("beszel", "10.0.0.5", false)], false, ["beszel"])[0].ok).toBe(false);
  });
});
