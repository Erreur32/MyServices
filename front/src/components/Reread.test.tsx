import { describe, expect, it } from "vitest";
import { tryNote } from "./Reread";

const said = { up: true, ms: 12, code: null, error: null };

describe("tryNote", () => {
  it("says a service down, with why", () => expect(tryNote("Nas", { ...said, up: false, ms: null, error: "timeout" })).toMatchObject({ ok: false, text: expect.stringContaining("timeout") }));
  it("takes an open port for a service that answers", () => expect(tryNote("Nas", said)?.ok).toBe(true));
  it("takes a page asking for a login for a service that answers", () => expect(tryNote("Nas", { ...said, code: 401 })?.ok).toBe(true));
  it("takes a server error for a failure", () => expect(tryNote("Nas", { ...said, code: 502 })?.ok).toBe(false));
  it("takes a port open with a web page that fails for a failure", () => expect(tryNote("Nas", { ...said, error: "SSLError" })?.ok).toBe(false));
});
