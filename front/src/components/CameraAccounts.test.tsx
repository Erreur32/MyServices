import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { accountsText, CameraAccounts, parseAccounts } from "./CameraAccounts";

describe("CameraAccounts", () => {
  it("reads and writes the saved text like the connector", () => {
    const rows = parseAccounts("192.168.1.11 cam pass word; 192.168.1.12 cam2 x ; broken");
    expect(rows).toEqual([{ ip: "192.168.1.11", user: "cam", password: "pass word" }, { ip: "192.168.1.12", user: "cam2", password: "x" }, { ip: "broken", user: "", password: "" }]);
    expect(accountsText(rows)).toBe("192.168.1.11 cam pass word; 192.168.1.12 cam2 x");   // the incomplete row is left out
    expect(accountsText([{ ip: "192.168.1.13", user: "c", password: "a;b" }])).toBe("");    // « ; » would split the entry
  });
  it("keeps saved accounts hidden until shown", () => {
    const out = renderToStaticMarkup(<CameraAccounts value="" kept reveal={async () => ""} devices={[]} box="" put={() => undefined} />);
    expect(out).toContain("cachés");
    expect(out).not.toContain("Ajouter une caméra");
    const fresh = renderToStaticMarkup(<CameraAccounts value="" kept={false} devices={[{ id: "c", name: "Cour", model: "", kind: "other", online: true, ip: "192.168.1.11" }]} box="" put={() => undefined} />);
    expect(fresh).toContain("Ajouter une caméra");
    expect(fresh).toContain("modèle non annoncé");
  });
});
