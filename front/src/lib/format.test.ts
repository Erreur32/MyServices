import { describe, expect, it } from "vitest";
import { appVersion, isDate, dur } from "./format";

describe("appVersion", () => {
  const sha = "8bb46cc28d56110fe3562d8654fbfde93de798c0";
  it("garde le tag d'une image publiée, sans l'empreinte du commit", () => {
    expect(appVersion(`v0.9.2-${sha}`)).toBe("v0.9.2");
    expect(appVersion(`v2.0.0-rc.2-${sha}`)).toBe("v2.0.0-rc.2");
  });
  it("montre la branche et le début du commit pour une image de branche", () => {
    expect(appVersion(`docker-${sha}`)).toBe("docker · 8bb46cc");
  });
  it("ajoute la dernière version publiée du journal à une image de branche", () => {
    expect(appVersion(`main-${sha}`, "0.10.1")).toBe("v0.10.1+ · main · 8bb46cc");
    expect(appVersion(`v0.10.1-${sha}`, "0.10.1")).toBe("v0.10.1");           // an image of a tag is already exact
    expect(appVersion("dev", "0.10.1")).toBe("dev");                          // development is untouched
  });
  it("laisse « dev » et le vide", () => {
    expect(appVersion("dev")).toBe("dev");
    expect(appVersion(undefined)).toBe("");
  });
});

describe("débit en bits par seconde", () => {
  it("comme la Freebox et MynetworK : unités décimales, bits", async () => {
    const { rate } = await import("./format");
    expect(rate(0)).toBe("0 b/s");
    expect(rate(125)).toBe("1,0 kb/s");         // 125 B/s = 1000 b/s: one decimal below 10
    expect(rate(1_250_000)).toBe("10 Mb/s");     // 10 Mb/s: a whole number from 10
    expect(rate(150_000)).toBe("1,2 Mb/s");      // 1,2 Mb/s: one decimal below 10
    expect(rate(null)).toBe("?");
  });
});

describe("isDate", () => {
  it("keeps a text the browser reads as a date", () => {
    expect(isDate("2026-10-22T22:03:21Z")).toBe(true);
  });
  it("drops an empty object, an empty text, a broken text or nothing", () => {
    expect(isDate({})).toBe(false);
    expect(isDate("")).toBe(false);
    expect(isDate("not a date")).toBe(false);
    expect(isDate(null)).toBe(false);
  });
});

describe("dur", () => {
  it("keeps the two largest units, minutes under a day", () => {
    expect([dur(12 * 86400 + 4 * 3600 + 59), dur(4 * 3600 + 20 * 60), dur(12 * 60 + 5), dur(30), dur(null)]).toEqual(["12 j 4 h", "4 h 20 min", "12 min", "0 min", "-"]);
  });
});
