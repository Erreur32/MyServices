// The name and the address of a service: what is set by hand on its page wins over the detection
import { describe, expect, it } from "vitest";
import type { Host } from "../types";
import { autoUrl, detectedName, hostName, openUrl } from "./status";

const row = (extra: Partial<Host>): Host => ({ id: 1, type: "local", enabled: true, domains: [], ip: "10.0.0.2", port: 8096, ...extra });

describe("service name and address", () => {
  it("the display name set by hand, else the first domain", () => {
    expect(hostName(row({ domains: ["tv.lan"] }))).toBe("tv.lan");
    expect(hostName(row({ domains: ["tv.lan"], display_name: "Films" }))).toBe("Films");
    expect(detectedName(row({ display_name: "Films" }))).toBe("10.0.0.2:8096");
  });
  it("the address set by hand, else the domain in HTTPS, else the backend", () => {
    expect(autoUrl(row({ scheme: "http" }))).toBe("http://10.0.0.2:8096/");
    expect(openUrl(row({ domains: ["tv.lan"] }))).toBe("https://tv.lan/");
    expect(openUrl(row({ domains: ["tv.lan"], open_url: "https://tv.lan/web" }))).toBe("https://tv.lan/web");
  });
});
