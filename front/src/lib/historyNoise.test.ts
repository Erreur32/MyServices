import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../types";
import { collapse, scopeOf, unmasked } from "./historyNoise";

const T = 1_791_600_000;   // same day for every event below
const ev = (kind: string, key: string, ts: number, more: Partial<StoredEvent> = {}): StoredEvent => ({ ts: T + ts, source: "watch", kind, key, label: key, ...more });

const list = [   // newest first, as the API answers
  ev("connecteur_ok", "connecteur:mynetwork/lan", 5000, { label: "mynetwork lan" }),
  ev("connecteur", "connecteur:mynetwork/lan", 4000, { label: "mynetwork lan" }),
  ev("menace", "menace:lv:ip:1", 3000, { target: "sshd" }),
  ev("menace", "menace:lv:ip:2", 2900, { target: "sshd" }),
  ev("appareil", "appareil:10.0.0.9", 2000),
  ev("panne", "proxy:7", 1000),
  ev("connecteur_ok", "connecteur:beszel/b", 900),
  ev("connecteur", "connecteur:beszel/b", -9000),   // back after 2 h 45: not a flap
];

describe("historique : bruit", () => {
  it("hides threats, quick connector flaps and scanned devices, counted", () => {
    const { shown, counts } = unmasked(list, ["menace", "flap", "appareil"]);
    expect(counts).toEqual({ menace: 2, flap: 2, appareil: 1 });
    expect(shown.map((e) => e.kind)).toEqual(["panne", "connecteur_ok", "connecteur"]);
    expect(unmasked(list, []).shown).toHaveLength(list.length);   // nothing hidden: everything back
  });
  it("one line per jail for threats and per connector for its cuts", () => {
    const items = collapse(list);
    const groups = items.filter((i) => "events" in i) as { title: string; detail: string; events: StoredEvent[] }[];
    expect(groups.map((g) => [g.title, g.detail, g.events.length])).toEqual([
      ["mynetwork lan : 1 coupure(s)", "rétabli", 2], ["fail2ban : 2 nouvelles menaces", "jails sshd", 2], ["connecteur:beszel/b : 1 coupure(s)", "rétabli", 2]]);
    expect(items).toHaveLength(5);   // 3 groups + the device + the outage
  });
});

describe("scopeOf", () => {
  it("sorts updates, services and what came or went", () => {
    expect(scopeOf(ev("maj_image", "maj_image:nginx", 0))).toEqual(["docker"]);
    expect(scopeOf(ev("maj_machine", "maj_machine:nas", 0))).toEqual(["machines"]);
    for (const [kind, key] of [["panne", "proxy:1"], ["retabli", "proxy:1"]]) expect(scopeOf(ev(kind, key, 0))).toEqual(["services"]);
    for (const [kind, key] of [["nouveau", "local:10.0.0.2:80"], ["disparu", "redirect:3"]]) expect(scopeOf(ev(kind, key, 0))).toEqual(["services", "changes"]);
    for (const [kind, key] of [["dns", "proxy:1"], ["menace", "menace:x"], ["hors_ligne", "machine:10.0.0.2"], ["connecteur", "connecteur:x"]]) expect(scopeOf(ev(kind, key, 0))).toEqual([]);
  });
});
