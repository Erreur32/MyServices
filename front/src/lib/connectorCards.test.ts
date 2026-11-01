// A connector card tells its state in one word and keeps its figures short; the long values wait for the open card.
import { describe, expect, it } from "vitest";
import type { ConnectorInstance, ServiceStatus } from "../types";
import { connectorAdvice } from "./connectorAdvice";
import { cardNotice, cardsTitle, cardView, noticeTip, toWatch } from "./connectorCards";

const inst = (status: Partial<NonNullable<ConnectorInstance["status"]>> | null, enabled = true) => ({
  type: "x", label: "X", name: "x", config: {}, set: {}, enabled,
  status: status && { type: "x", name: "x", ok: true, message: "OK", version: null, version_tested: null, stale: false, failures: 0, ...status },
}) as ConnectorInstance;
const card = (over: Partial<ServiceStatus>) => over as ServiceStatus;

describe("connector cards", () => {
  it("names what is counted and hides the counters of its own lists", () => {
    const v = cardView(inst({ found: [{ name: "facts", count: 4 }, { name: "problems", count: 0 }, { name: "hosts", count: 110 }, { name: "dead", count: 2 }, { name: "custom", count: 1 }] }));
    expect(v.figures.map((f) => [f.label, f.value, f.tone])).toEqual([["hôtes", "110", undefined], ["morts", "2", "warn"], ["custom", "1", undefined]]);
  });

  it("a watched counter at zero says nothing", () => {
    expect(cardView(inst({ found: [{ name: "dead", count: 0 }] })).figures).toEqual([]);
  });

  it("short facts come first, long ones only in the open card", () => {
    const facts = [{ label: "GPU chaud", value: "59 °C (NVIDIA GeForce RTX 3090 Ti)" }, { label: "GPU", value: "3" }];
    const v = cardView(inst({}), card({ facts }));
    expect(v.figures.map((f) => f.label)).toEqual(["GPU"]);
    expect(v.facts).toHaveLength(2);
  });

  it("the state follows the worst news", () => {
    expect(cardView(inst({}, false)).tone).toBe("off");
    expect(cardView(inst(null)).state).toBe("Pas encore lu");
    expect(cardView(inst({ ok: false })).tone).toBe("bad");
    expect(cardView(inst({ stale: true })).state).toBe("Périmé");
    expect(cardView(inst({}), card({ problems: ["a", "b"] })).state).toBe("2 points");
    expect(cardView(inst({}), card({ problems: [] })).tone).toBe("ok");
  });

  it("a connector switched off is not to watch, whatever it said last", () => {
    expect(toWatch(cardView(inst({}, false), card({ problems: ["a"] })))).toBe(false);
  });

  it("the title counts failures and points to look at", () => {
    const ok = cardView(inst({})), bad = cardView(inst({ ok: false })), warn = cardView(inst({ stale: true }));
    expect(cardsTitle([ok, ok])).toBe("2 connecteurs, aucun en échec.");
    expect(cardsTitle([ok, bad, warn])).toBe("3 connecteurs, 1 en échec. 1 à vérifier.");
  });
});

describe("the trouble of a connector", () => {
  const short = (m: string) => connectorAdvice(m).short;
  it("says the cause in plain words, whatever the tool wrote", () => {
    expect(short("NPM a (http://127.0.0.1:81/api/tokens via ssh b) : curl: (22) The requested URL returned error: 502")).toBe("Le service ne répond pas (502)");
    expect(short("HTTP 403")).toBe("Accès refusé");
    expect(short("identifiants refusés")).toBe("Accès refusé");
    expect(short("HTTP 404")).toBe("Adresse de l'API introuvable");
    expect(short("<urlopen error [Errno 111] Connection refused>")).toBe("Rien n'écoute sur ce port");
    expect(short("délai dépassé (120 s)")).toBe("Pas de réponse à temps");
    expect(short("curl: (6) Could not resolve host: x")).toBe("Nom de machine inconnu");
    expect(short("certificate verify failed")).toBe("Certificat refusé");
    expect(short("ssh: root@x: Permission denied (publickey)")).toBe("Connexion SSH refusée");
    expect(short("quelque chose d'imprévu")).toBe("Lecture impossible");
  });
  it("a port number in an address is not an HTTP code", () => {
    expect(short("http://10.0.0.1:502 : réponse illisible")).toBe("Lecture impossible");
  });
  it("gives one line to a failure, an old reading, a warning or a point, none to a healthy or switched off card", () => {
    const notice = (status: Parameters<typeof inst>[0], enabled = true, c?: ServiceStatus) => { const i = inst(status, enabled); return cardNotice(i, cardView(i, c)); };
    expect(notice({ ok: false, message: "HTTP 502" })).toMatchObject({ tone: "bad", text: "Le service ne répond pas (502)", raw: "HTTP 502" });
    expect(notice({ stale: true, message: "HTTP 502" })?.tone).toBe("warn");
    expect(notice({ warning: "lecture partielle" })).toEqual({ text: "lecture partielle", tone: "warn" });
    expect(notice({}, true, card({ problems: ["a", "b"] }))).toEqual({ text: "a", tone: "warn" });
    expect(notice({})).toBeNull();
    expect(notice({ ok: false, message: "x" }, false)).toBeNull();
    expect(notice({ pending: true, ok: false, message: "x" })).toBeNull();
  });
  it("the hover of the state gives its name, the trouble, the tool's words and the other points", () => {
    const tip = (status: Parameters<typeof inst>[0], c?: ServiceStatus) => { const i = inst(status), v = cardView(i, c); return noticeTip(cardNotice(i, v), v); };
    expect(tip({})).toBeUndefined();
    expect(tip({}, card({ problems: ["a", "b"] }))).toBe("2 points\n[[warn:a]]\n• b");
    expect(tip({ ok: false, message: "HTTP 502" })).toBe("En échec\n[[bad:Le service ne répond pas (502)]]\n`HTTP 502`");
  });
});
