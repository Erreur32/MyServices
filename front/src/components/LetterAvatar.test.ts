import { describe, expect, it } from "vitest";
import { hueOf, letterOf } from "./LetterAvatar";

describe("LetterAvatar", () => {
  it("takes the first letter of the name, not of www", () => {
    expect(letterOf("www.immich.example.test")).toBe("I");
    expect(letterOf("m.blog.example.test")).toBe("B");
    expect(letterOf("adguard.example.test")).toBe("A");
    expect(letterOf("")).toBe("?");
  });

  it("keeps a colour per domain", () => {
    expect(hueOf("a.test")).toBe(hueOf("a.test"));
    expect(hueOf("a.test")).not.toBe(hueOf("b.test"));
    expect(hueOf("x".repeat(500))).toBeLessThan(360);
  });
});
