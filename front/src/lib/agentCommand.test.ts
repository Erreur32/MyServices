import { describe, expect, it } from "vitest";
import { cleanAgentUrl, installCommand, isPublicIp, outsideProblem } from "./agentCommand";

describe("commande d'installation de l'agent", () => {
  it("accepte une adresse http(s)://hôte[:port] et retire le « / » final", () => {
    expect(cleanAgentUrl("http://192.168.1.10:8091/")).toBe("http://192.168.1.10:8091");
    expect(cleanAgentUrl(" https://ms.lan ")).toBe("https://ms.lan");
    expect(cleanAgentUrl("http://[fd00::1]:8091")).toBe("http://[fd00::1]:8091");
  });
  it("refuse ce que le serveur refuserait (chemin, autre schéma, caractères dangereux)", () => {
    for (const bad of ["", "ftp://x", "http://x/chemin", "http://a b", "javascript:alert(1)", "http://x'; calc; '", "192.168.1.10:8091"]) {
      expect(cleanAgentUrl(bad), bad).toBeNull();
    }
  });
  it("la commande suit l'adresse saisie", () => {
    const fake = ["msv", "agent", "factice"].join("_"), a = installCommand("http://192.168.1.10:5180", fake), b = installCommand("http://192.168.1.10:8091/", fake);
    expect(a).toContain("$env:MSV_URL = 'http://192.168.1.10:5180'");
    expect(b).toContain("$env:MSV_URL = 'http://192.168.1.10:8091'");
    expect(b?.split("\n")[2]).toBe(`$env:MSV_TOKEN = '${fake}'`);   // le jeton figure dans la troisième ligne, tel quel
    expect(installCommand("n'importe quoi", "t")).toBeNull();
  });
  it("commande Linux : variables exportées puis installateur sous sudo", () => {
    const fake = ["msv", "agent", "factice"].join("_"), c = installCommand("http://192.168.1.10:8091/", fake, "linux")?.split("\n");
    expect(c?.[0]).toBe("export MSV_URL='http://192.168.1.10:8091'");
    expect(c?.[1]).toBe(`export MSV_TOKEN='${fake}'`);
    expect(c?.[2]).toContain("/agent/install.sh");
    expect(c?.[2]).toContain("sudo env");
    expect(installCommand("n'importe quoi", "t", "linux")).toBeNull();
  });

  it("adds the sudo rules to a Linux command only when asked", () => {
    expect(installCommand("http://192.168.1.10:8091", "t", "linux")).not.toContain("MSV_SUDO");
    expect(installCommand("http://192.168.1.10:8091", "t", "linux", true)).toContain("sudo env MSV_SUDO=1 MSV_URL=");
    expect(installCommand("http://192.168.1.10:8091", "t", "windows", true)).not.toContain("MSV_SUDO");
  });

  it("tells a machine outside the network from one inside", () => {
    expect(isPublicIp("203.0.113.7")).toBe(true);
    for (const ip of ["192.168.1.10", "10.0.0.2", "172.16.0.1", "100.100.1.1", "ms.lan"]) expect(isPublicIp(ip), ip).toBe(false);
  });

  it("names what a machine outside the network cannot use", () => {
    for (const url of ["http://192.168.1.10:8090", "http://myservices:8090", "https://ms.lan"]) expect(outsideProblem(url), url).toBe("private");
    expect(outsideProblem("http://ms.example.org")).toBe("clear");
    for (const url of ["https://ms.example.org", "http://100.100.1.1:8090", "http://ms.tail1234.ts.net:8090", "pas une adresse"]) expect(outsideProblem(url), url).toBeNull();
  });
});
