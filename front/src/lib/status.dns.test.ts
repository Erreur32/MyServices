// A failed lookup is « DNS absent » only when the DNS servers of the page do not answer for the name either
import { describe, expect, it } from "vitest";
import type { Host } from "../types";
import { checks, errText, status } from "./status";

const row = (pub: Host["public"]): Host => ({ id: 1, type: "proxy", enabled: true, domains: ["a.lan"], ip: "10.0.0.2", port: 8081, backend: { up: true }, public: pub });

describe("failed lookup", () => {
  it("is a missing DNS when nothing answers, with its cause", () => {
    const s = status(row({ err: "gaierror", errno: -2 }));
    expect(s.slice(0, 2)).toEqual(["warn", "DNS absent"]);
    expect(s[2]).toContain("nom inconnu du DNS");
    expect(checks(row({ err: "gaierror" }))).toContain("dns");
  });

  it("is grey and no point to fix when the DNS servers answer", () => {
    const r = row({ err: "gaierror", errno: -3, dns_ok: true });
    expect(status(r)[0]).toBe("off");
    expect(status(r)[2]).toContain("pas de réponse du DNS à temps");
    expect(checks(r)).not.toContain("dns");
  });

  it("a redirect on a name absent from the DNS is the same « DNS absent », not a red error", () => {
    const r: Host = { ...row({ err: "gaierror", errno: -2 }), type: "redirect", target: "https://x.fr" };
    expect(status(r).slice(0, 2)).toEqual(["warn", "DNS absent"]);
    expect(checks(r)).toEqual(expect.arrayContaining(["dns"]));
    expect(checks(r)).not.toContain("down");
  });
});

describe("probe error in words", () => {
  it("says the Python exception name in words, keeps an unknown one", () => {
    expect([errText("ConnectionRefusedError"), errText("BrandNewError"), errText(null)]).toEqual(["connexion refusée (rien n'écoute sur ce port)", "BrandNewError", "?"]);
  });
});
