import { describe, expect, it } from "vitest";
import type { Finding } from "./securityFindings";
import { watchRows } from "./securityWatch";

const f = (o: Partial<Finding>): Finding => ({ sev: "warn", area: "sites", title: "a.lan", detail: "pas de HSTS", fix: "x", ...o });

describe("security « to watch » rows", () => {
  it("groups public sites by gap, a site with two gaps in two rows", () => {
    const rows = watchRows([f({ title: "a.lan", detail: "pas de HSTS · en-têtes de sécurité faibles" }), f({ title: "b.lan", detail: "pas de HSTS" }), f({ title: "c.lan", detail: "en-têtes de sécurité faibles" })]);
    expect(rows.map((r) => [r.title, r.sub, r.detail])).toEqual([["pas de HSTS", "2 site(s)", "a.lan, b.lan"], ["en-têtes de sécurité faibles", "2 site(s)", "a.lan, c.lan"]]);
    expect(rows[0].fix).toContain("HSTS");
  });
  it("names together the machines with the same weak SSH setting, keeps the others apart, red first", () => {
    const rows = watchRows([
      f({ area: "ssh", title: "Proxmox", detail: "root autorisé · mot de passe autorisé", sub: "10.0.0.1" }),
      f({ area: "ssh", title: "Tower", detail: "mot de passe autorisé" }), f({ area: "ssh", title: "Jarvis", detail: "mot de passe autorisé" }),
      f({ area: "ports", title: "nas", detail: "445 SMB" }), f({ sev: "bad", area: "fail2ban", title: "Une IP attaque plusieurs services", detail: "1.2.3.4" }),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["Une IP attaque plusieurs services", "Tower, Jarvis", "Proxmox", "nas"]);
    expect(rows[1].sub).toBe("2 machine(s)");
    expect(rows[2].sub).toBe("10.0.0.1");
    expect(rows[1].items).toHaveLength(2);
  });
});
