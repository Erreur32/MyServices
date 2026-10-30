// Settings › Connectors: what a compact card says, from the collection's own figures, and how the list is filtered.
import type { ConnectorInstance, ServiceStatus } from "../types";
import { tx } from "./i18n";

export type CardTone = "ok" | "warn" | "bad" | "off";
export interface CardFigure { label: string; value: string; tone?: "ok" | "warn" | "bad" }
export interface CardView {
  tone: CardTone; state: string; figures: CardFigure[]; facts: CardFigure[]; problems: string[];
}

// Plain words for what a connector counts; `facts` and `problems` are told by the card itself, the others say the same number twice
const HIDDEN = new Set(["facts", "problems", "unavailable_names", "threat_count", "bans", "stats", "metrics", "log_sources"]);
const WATCHED = new Set(["dead", "unavailable", "batteries_low"]);   // above zero: worth a look
const WORDS = (): Record<string, string> => ({
  hosts: tx("hôtes"), redirects: tx("redirections"), dead: tx("morts"), streams: tx("flux"), acls: tx("listes d'accès"), monitors: tx("sondes"),
  rewrites: tx("réécritures DNS"), user_rules: tx("règles"), entities: tx("entités"), unavailable: tx("indisponibles"), batteries_low: tx("piles faibles"),
  automations: tx("automatisations"), updates: tx("mises à jour"), addons: tx("modules"), machines: tx("machines"), agents: tx("agents"), alerts: tx("alertes"),
  devices: tx("appareils"), online: tx("en ligne"), unifi: "UniFi", freebox: "Freebox", jails: tx("prisons"), bans_24h: tx("bannis sur 24 h"), threats: tx("menaces"),
  stream: tx("caméras"), modules: tx("appareils"), rooms: tx("pièces"), ai: tx("lignes IA"), host: tx("relevés"), frigate: "Frigate", checks: tx("contrôles"), environments: tx("environnements"),
});
const SHORT = 14;   // longer values wait for the open card

export function cardView(inst: ConnectorInstance, card?: ServiceStatus): CardView {
  const s = inst.status, words = WORDS();
  const counted: CardFigure[] = (s?.found ?? []).filter((f) => !HIDDEN.has(f.name) && (f.count || !WATCHED.has(f.name)))
    .map((f) => ({ label: words[f.name] ?? f.name, value: String(f.count), tone: WATCHED.has(f.name) ? "warn" : undefined }));
  const facts: CardFigure[] = (card?.facts ?? []).map((f) => ({ label: f.label, value: f.value, tone: f.tone }));
  const problems = card?.problems ?? [];
  const figures = [...facts.filter((f) => f.value.length <= SHORT), ...counted].slice(0, 3);
  const base = { figures, facts: facts.length ? facts : counted, problems };   // facts already tell what the counters say
  if (!inst.enabled) return { ...base, tone: "off", state: tx("Coupé") };
  if (!s) return { ...base, tone: "off", state: tx("Pas encore lu") };
  if (s.pending) return { ...base, tone: "off", state: tx("Relecture") };
  if (!s.ok) return { ...base, tone: "bad", state: tx("En échec") };
  if (s.stale) return { ...base, tone: "warn", state: tx("Périmé") };
  if (s.warning) return { ...base, tone: "warn", state: tx("Partiel") };
  if (problems.length) return { ...base, tone: "warn", state: problems.length > 1 ? tx("{0} points", problems.length) : tx("1 point") };
  return { ...base, tone: "ok", state: tx("Lu") };
}

export const toWatch = (v: CardView) => v.tone === "warn" || v.tone === "bad";

/** The sentence above the list */
export function cardsTitle(views: CardView[]): string {
  const failing = views.filter((v) => v.tone === "bad").length, watch = views.filter((v) => v.tone === "warn").length;
  const head = failing ? tx("{0} connecteurs, {1} en échec.", views.length, failing) : tx("{0} connecteurs, aucun en échec.", views.length);
  return watch ? `${head} ${tx("{0} à vérifier.", watch)}` : head;
}
