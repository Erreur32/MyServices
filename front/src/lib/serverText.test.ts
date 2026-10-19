import { describe, expect, it } from "vitest";
import { serverText, translateConnectorMessages, translateLabels, withServerMessages } from "./serverText";

describe("server texts", () => {
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
