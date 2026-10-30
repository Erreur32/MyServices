import { describe, expect, it } from "vitest";
import type { ConnectorType } from "../types";
import { serverText, translateConnectorMessages, translateConnectorTypes, translateLabels, withServerMessages } from "./serverText";

describe("server texts", () => {
  it("translates the figures and the problems of a connector row", () => {
    const [row] = withServerMessages([{ facts: [{ label: "introuvable", value: "introuvable" }], problems: ["introuvable"] }], "en")!;
    expect(row).toEqual({ facts: [{ label: "not found", value: "not found" }], problems: ["not found"] });
  });
  it("translates a connector form but never the values of a choice", () => {
    const type = { type: "x", label: "introuvable", kinds: [], tested: [], guide: ["introuvable"], modes: [{ id: "a", label: "introuvable", help: "", fields: [], required: [] }],
      fields: [{ name: "n", label: "introuvable", kind: "choice", required: false, secret: false, default: null, help: "introuvable", choices: ["introuvable"] }] } as ConnectorType;
    const [t] = translateConnectorTypes({ types: [type] }, "en").types;
    expect([t.label, t.guide?.[0], t.modes?.[0].label, t.fields[0].label, t.fields[0].help]).toEqual(Array(5).fill("not found"));
    expect(t.fields[0].choices).toEqual(["introuvable"]);
    expect(translateConnectorTypes({ types: [type] }, "fr").types[0]).toBe(type);
  });

  it("stay French in French", () => {
    expect(serverText("introuvable", "fr")).toBe("introuvable");
  });
  it("fixed sentences and families are translated in English", () => {
    expect(serverText("introuvable", "en")).toBe("not found");
    expect(serverText("réponse inattendue : l'adresse ne mène pas à Jellyfin", "en")).toBe("unexpected answer: the address does not lead to Jellyfin");
  });
  it("translates the steps of the collection shown by the header orb", () => {
    expect(serverText("sondes TCP, HTTPS et web (1er passage)", "en")).toBe("TCP, HTTPS and web probes (first pass)");
  });
  it("a text built with a value stays as it is", () => {
    expect(serverText("quelque chose de 42", "en")).toBe("quelque chose de 42");
  });
  it("translates the message of each row and keeps the rest", () => {
    expect(withServerMessages([{ message: "introuvable", name: "a" }, { name: "b" }] as { message?: string; name: string }[], "en"))
      .toEqual([{ message: "not found", name: "a" }, { name: "b" }]);
  });
  it("translates the message of every connector list of the data, and nothing else", () => {
    const data = { infra: [{ name: "a", message: "introuvable" }], hosts: [{ id: 1 }], page: { title: "x" } };
    expect(translateConnectorMessages(data, "en")).toEqual({ infra: [{ name: "a", message: "not found" }], hosts: [{ id: 1 }], page: { title: "x" } });
    expect(translateConnectorMessages(data, "fr")).toBe(data);
  });
  it("translates the event labels", () => {
    expect(translateLabels({ down: "🔴 Panne", other: "libre" }, "en")).toEqual({ down: "🔴 Down", other: "libre" });
  });
});
