import { describe, expect, it } from "vitest";
import { agentBoxes, cleanAgentUrl, installCommand, isPublicIp, npmProblem, outsideProblem, type AgentOptions } from "./agentCommand";

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
    expect(installCommand("http://192.168.1.10:8091", "t", "linux", { sudo: true })).toContain("sudo env MSV_SUDO=1 MSV_URL=");
    expect(installCommand("http://192.168.1.10:8091", "t", "windows", { sudo: true })).not.toContain("MSV_SUDO");
  });
  it("adds the backup and NPM options, and only safe paths", () => {
    const env = (o: AgentOptions) => /sudo env (.*)MSV_URL=/.exec(installCommand("http://192.168.1.10:8091", "t", "linux", o) ?? "")?.[1];
    expect(env({ backups: true, backupDirs: "/mnt/a, /mnt/b" })).toBe("MSV_BACKUPS=1 MSV_BACKUP_DIRS=/mnt/a,/mnt/b ");
    expect(env({ backups: true, backupDirs: "/mnt/a;rm -rf /" })).toBe("MSV_BACKUPS=1 ");
    expect(env({ backups: false, backupDirs: "/mnt/a" })).toBe("");
    expect(env({ dns: true })).toBe("MSV_DNS=1 ");
    expect(env({ borgmatic: true })).toBe("MSV_BORGMATIC=1 ");
    expect(env({ npm: "" })).toBe("MSV_NPM=install ");
    expect(env({ npm: " ", npmUrl: "http://127.0.0.1:8081" })).toBe("MSV_NPM=install MSV_NPM_URL=http://127.0.0.1:8081 ");
    expect(env({ npm: "/opt/npm-api.sh", npmUrl: "http://x:1" })).toBe("MSV_NPM=/opt/npm-api.sh ");
    expect(env({ npm: "/opt/$(id)" })).toBe("");
    expect(env({ npm: "", npmUrl: "https://x" })).toBe("");
    expect(npmProblem({ npm: "relatif/npm-api.sh" })).toBe(true);
    expect(npmProblem({})).toBe(false);
  });

  it("adds the plain-http choice only for an address the installer would refuse", () => {
    const cmd = (url: string, kind: "linux" | "windows", allowHttp = true) => installCommand(url, "msv_agent_x", kind, { allowHttp, sudo: true });
    expect(cmd("http://203.0.113.7:8032", "linux")).toContain("sudo env MSV_ALLOW_HTTP=1 MSV_SUDO=1 MSV_URL=");
    expect(cmd("http://203.0.113.7:8032", "windows")).toContain("$env:MSV_ALLOW_HTTP = '1'\n$env:MSV_URL");
    expect(cmd("http://203.0.113.7:8032", "linux", false)).not.toContain("ALLOW_HTTP");
    for (const url of ["https://ms.example.org", "http://192.168.1.10:8090", "http://100.100.1.1:8090"]) {
      expect(cmd(url, "linux"), url).not.toContain("ALLOW_HTTP");
      expect(cmd(url, "windows"), url).not.toContain("ALLOW_HTTP");
    }
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

describe("cases d'un agent", () => {
  const on = (o?: AgentOptions) => agentBoxes(o).filter((b) => b.on).map((b) => b.label);
  it("montre toutes les cases, cochées ou non", () => {
    expect(agentBoxes()).toHaveLength(5);
    expect(on()).toEqual([]);
    expect(on({ sudo: true, npm: "/a/npm-api.sh" })).toEqual(["sudo", "NPM"]);
    expect(on({ npm: "" })).toEqual(["NPM"]);   // empty: the script was set by the install, still read
  });
  it("garde le chemin de NPM", () => {
    expect(agentBoxes({ npm: "/a/npm-api.sh" }).at(-1)?.detail).toBe("/a/npm-api.sh");
  });
});
