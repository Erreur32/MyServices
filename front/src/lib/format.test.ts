import { describe, expect, it } from "vitest";
import { appVersion } from "./format";

describe("appVersion", () => {
  const sha = "8bb46cc28d56110fe3562d8654fbfde93de798c0";
  it("garde le tag d'une image publiée, sans l'empreinte du commit", () => {
    expect(appVersion(`v0.9.2-${sha}`)).toBe("v0.9.2");
    expect(appVersion(`v2.0.0-rc.2-${sha}`)).toBe("v2.0.0-rc.2");
  });
  it("montre la branche et le début du commit pour une image de branche", () => {
    expect(appVersion(`docker-${sha}`)).toBe("docker · 8bb46cc");
  });
  it("laisse « dev » et le vide", () => {
    expect(appVersion("dev")).toBe("dev");
    expect(appVersion(undefined)).toBe("");
  });
});
