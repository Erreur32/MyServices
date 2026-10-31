import { describe, expect, it, vi } from "vitest";
import { onHeaderNote, sayInHeader, toHeader } from "./headerNote";

describe("note dans l'en-tête", () => {
  const bus = new EventTarget();
  vi.stubGlobal("addEventListener", bus.addEventListener.bind(bus));
  vi.stubGlobal("removeEventListener", bus.removeEventListener.bind(bus));
  vi.stubGlobal("dispatchEvent", bus.dispatchEvent.bind(bus));

  it("une réussite va dans l'en-tête, une erreur reste dans la page", () => {
    const heard: string[] = [], page = vi.fn(), stop = onHeaderNote((t) => heard.push(t));
    toHeader(page)({ ok: true, text: "demandée" });
    toHeader(page)({ ok: false, text: "refusée" });
    expect(heard).toEqual(["demandée"]);
    expect(page).toHaveBeenCalledExactlyOnceWith({ ok: false, text: "refusée" });
    stop();
    sayInHeader("plus personne");
    expect(heard).toEqual(["demandée"]);
  });
});
