// Historique : ce qui fait du bruit, et comment le calmer sans rien perdre (affichage seulement, la base garde tout).
//   Masquages (choix gardé dans le navigateur) : menaces fail2ban, connecteur revenu en moins d'une heure, nouvel appareil du scan réseau.
//   Regroupements de la liste : les menaces d'un jour par jail, les coupures d'un même connecteur dans la journée.
import type { StoredEvent } from "../types";
import { dayKey } from "./format";
import { tx } from "./i18n";

export type NoiseId = "menace" | "flap" | "appareil";
export const NOISE: [NoiseId, string][] = [
  ["menace", tx("menaces fail2ban")], ["flap", tx("connecteurs revenus < 1 h")], ["appareil", tx("nouveaux appareils")],
];
export const NOISE_DEFAULT: NoiseId[] = ["menace", "flap", "appareil"];
const FLAP_S = 3600;

const UPDATE_SCOPE: Record<string, "docker" | "machines"> = { maj_image: "docker", maj_machine: "machines" };
const SERVICE_KEY = /^(local|proxy|redirect):/;

/** What the « Only » filter of the history groups an event under: updates of Docker images or machines, a service (a DNS event has its own family), and among those the ones that came or went */
export function scopeOf(e: Pick<StoredEvent, "kind" | "key">): string[] {
  if (UPDATE_SCOPE[e.kind]) return [UPDATE_SCOPE[e.kind]];
  if (e.kind === "dns" || !SERVICE_KEY.test(e.key)) return [];
  return e.kind === "nouveau" || e.kind === "disparu" ? ["services", "changes"] : ["services"];
}
const KEY = "ms.history.hidden";

export function savedHidden(): NoiseId[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return Array.isArray(v) ? v.filter((x): x is NoiseId => NOISE.some(([k]) => k === x)) : NOISE_DEFAULT;
  } catch {
    return NOISE_DEFAULT;
  }
}
export function saveHidden(v: NoiseId[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage refused: the choice lasts this visit */ }
}

/** Events of a connector that went down and came back within an hour (both ends), by their position in `events` */
function flaps(events: StoredEvent[]): Set<StoredEvent> {
  const out = new Set<StoredEvent>();
  const byKey = new Map<string, StoredEvent[]>();
  for (const e of events) if (e.kind === "connecteur" || e.kind === "connecteur_ok") byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  for (const list of byKey.values()) {
    const s = [...list].sort((a, b) => a.ts - b.ts);
    for (let i = 0; i + 1 < s.length; i++) {
      if (s[i].kind === "connecteur" && s[i + 1].kind === "connecteur_ok" && s[i + 1].ts - s[i].ts <= FLAP_S) { out.add(s[i]); out.add(s[i + 1]); }
    }
  }
  return out;
}

/** Which noise an event belongs to, if any */
export function noiseMap(events: StoredEvent[]): Map<StoredEvent, NoiseId> {
  const flap = flaps(events), out = new Map<StoredEvent, NoiseId>();
  for (const e of events) {
    if (e.kind === "menace") out.set(e, "menace");
    else if (e.kind === "appareil") out.set(e, "appareil");
    else if (flap.has(e)) out.set(e, "flap");
  }
  return out;
}

/** Events left once the hidden kinds of noise are removed, and how many of each were hidden */
export function unmasked(events: StoredEvent[], hidden: NoiseId[]): { shown: StoredEvent[]; counts: Record<NoiseId, number> } {
  const map = noiseMap(events), counts = { menace: 0, flap: 0, appareil: 0 } as Record<NoiseId, number>;
  const shown = events.filter((e) => {
    const n = map.get(e);
    if (n) counts[n] += 1;
    return !n || !hidden.includes(n);
  });
  return { shown, counts };
}

export type ListItem = { one: StoredEvent } | { title: string; detail: string; kind: string; ts: number; events: StoredEvent[] };

/** List of one day (newest first): threats of the same jails and cuts of the same connector become one line each, opened on demand */
export function collapse(events: StoredEvent[]): ListItem[] {
  const groups = new Map<string, StoredEvent[]>();
  const keyOf = (e: StoredEvent) => e.kind === "menace" ? `menace|${dayKey(e.ts * 1000)}|${e.target ?? ""}`
    : e.kind === "connecteur" || e.kind === "connecteur_ok" ? `conn|${dayKey(e.ts * 1000)}|${e.key}` : null;
  for (const e of events) {
    const k = keyOf(e);
    if (k) groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out: ListItem[] = [], done = new Set<string>();
  for (const e of events) {
    const k = keyOf(e), list = k ? groups.get(k)! : null;
    if (!k || !list || list.length < 2) { out.push({ one: e }); continue; }
    if (done.has(k)) continue;
    done.add(k);
    if (e.kind === "menace") {
      out.push({ title: tx("fail2ban : {0} nouvelles menaces", list.length), detail: e.target ? tx("jails {0}", e.target) : "", kind: "menace", ts: list[0].ts, events: list });
    } else {
      const cuts = list.filter((x) => x.kind === "connecteur").length, last = list[0];   // newest first
      out.push({ title: tx("{0} : {1} coupure(s)", last.label || last.key, cuts), detail: last.kind === "connecteur_ok" ? tx("rétabli") : tx("en panne"),
                 kind: last.kind, ts: last.ts, events: list });
    }
  }
  return out;
}
