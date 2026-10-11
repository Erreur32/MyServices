import { describe, expect, it } from "vitest";
import { auditTone, counted, inPeriod } from "./audit";

const e = (ts: number, action = "connexion") => ({ ts, username: "a", ip: null, action, detail: null }) as never;

describe("journal d'audit", () => {
  it("gravité d'après le libellé", () => {
    expect(auditTone("connexion échouée")).toBe("bad");
    expect(auditTone("compte supprimé")).toBe("warn");
    expect(auditTone("mot de passe changé")).toBe("warn");
    expect(auditTone("connexion")).toBe("ok");
    expect(auditTone("passage demandé")).toBe("info");
  });
  it("période", () => {
    const now = 10 * 86400e3;
    const list = [e(now / 1000 - 3600), e(now / 1000 - 3 * 86400), e(now / 1000 - 20 * 86400)];
    expect(inPeriod(list, 1, now)).toHaveLength(1);
    expect(inPeriod(list, 7, now)).toHaveLength(2);
    expect(inPeriod(list, 0, now)).toHaveLength(3);
  });
  it("comptage, le plus fréquent d'abord", () => {
    expect(counted(["b", "a", "b", null, "c", "b", "a"])).toEqual([["b", 3], ["a", 2], ["c", 1]]);
  });
});
