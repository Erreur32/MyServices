import { describe, expect, it } from "vitest";
import { dnsSync } from "./status";

const NOW = Date.parse("2026-10-17T18:45:00Z");
const dns = (sync: object) => ({ servers: { a: {}, b: {} }, rewrites_diff: [], user_rules_diff: [], sync: { a: { container: "s", last_done: { b: "2026-10-17T18:40:01.411Z" }, interval_min: 5, ...sync } } }) as never;

describe("état de la synchro AdGuard", () => {
  it("une vieille erreur fermée par une synchro réussie n'allume rien", () => {
    expect(dnsSync(dns({ errors_24h: 1, errors_open: 0 }), NOW)).toEqual({ cls: "ok", label: "synchro à jour" });
  });
  it("une erreur plus récente que la dernière synchro réussie reste une erreur", () => {
    expect(dnsSync(dns({ errors_24h: 1, errors_open: 1 }), NOW)).toEqual({ cls: "bad", label: "synchro en erreur" });
  });
  it("un ancien serveur qui n'envoie que errors_24h garde l'ancien comportement", () => {
    expect(dnsSync(dns({ errors_24h: 1 }), NOW).cls).toBe("bad");
  });
  it("une synchro en retard passe en rouge même sans erreur", () => {
    expect(dnsSync(dns({ last_done: { b: "2026-10-17T17:00:00Z" } }), NOW)).toEqual({ cls: "bad", label: "synchro en retard" });
  });
});
