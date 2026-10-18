import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { exposedSites, securityFindings, siteIssues } from "./securityFindings";

const snap = (data: object, health?: object): Snapshot => ({ data: { hosts: [], machine_list: [], security: [], network: [], ...data }, health } as unknown as Snapshot);
const site = (o: object) => ({ type: "proxy", enabled: true, domains: ["a.lan"], ssl: true, ssl_forced: true, block_exploits: true, ...o });

describe("security findings", () => {
  it("nothing wrong, nothing listed", () => {
    expect(securityFindings(snap({ hosts: [site({})] }))).toEqual([]);
  });
  it("a site behind an access list is not public; one without is checked", () => {
    expect(exposedSites([site({}), site({ acl: 4 }), site({ type: "stream" })] as never)).toHaveLength(1);
    expect(siteIssues(site({ ssl_forced: false, block_exploits: false }) as never)).toEqual(["HTTPS non forcé", "« Block exploits » coupé"]);
  });
  it("worst first: an invalid certificate and a threat before weak SSH and open ports", () => {
    const got = securityFindings(snap({
      hosts: [site({ webcheck: { cert_valid: false } })],
      security: [{ threats: [{ kind: "ip_escalation", ips: ["203.0.113.5"], ip_count: 1, jails: ["sshd"] }] }],
      machine_list: [{ name: "srv", ip: "10.0.0.2", info: { sshd: { permitrootlogin: "yes", passwordauthentication: "yes" } } }],
      network: [{ devices: [{ ip: "10.0.0.9", hostname: "tv", ports: [445, 80] }] }],
    }));
    expect(got.map((f) => [f.sev, f.area])).toEqual([["bad", "fail2ban"], ["bad", "certs"], ["warn", "ssh"], ["warn", "ports"]]);
    expect(got[2].detail).toBe("root autorisé · mot de passe autorisé");
    expect(got[3].detail).toBe("445 SMB");
  });
  it("many refused SSH logins is red", () => {
    const got = securityFindings(snap({ machine_list: [{ name: "srv", ip: "10.0.0.2" }] }, { hosts: [{ name: "srv · 10.0.0.2", ssh_auth: { available: true, failed_24h: 120 } }] }));
    expect(got).toMatchObject([{ sev: "bad", area: "ssh" }]);
  });
});
