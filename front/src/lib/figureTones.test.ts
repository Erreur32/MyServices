import { describe, expect, it } from "vitest";
import { levelTone, scoreTone, shareTone } from "./figureTones";

describe("tones", () => {
  it("warns a level from its limit, says nothing when not read", () => {
    expect([levelTone(null, 80), levelTone(79, 80), levelTone(80, 80)]).toEqual([undefined, "ok", "warn"]);
  });
  it("is ok when all answer, else the short tone, nothing without a total", () => {
    expect([shareTone(0, 0), shareTone(3, 3), shareTone(2, 3), shareTone(2, 3, "bad")]).toEqual([undefined, "ok", "warn", "bad"]);
  });
  it("grades a score", () => {
    expect([scoreTone(100, 80, 50), scoreTone(80, 80, 50), scoreTone(50, 80, 50), scoreTone(49, 80, 50)]).toEqual(["ok", "ok", "warn", "bad"]);
  });
});
