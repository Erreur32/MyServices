import { describe, expect, it } from "vitest";
import { cleanAgentUrl, installCommand } from "./agentCommand";

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
});
