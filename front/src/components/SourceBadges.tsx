// Qui lit une machine : un badge court par source (SSH, agent, connecteurs), vert si tout va bien, d'une autre couleur sinon ; le détail est dans
// l'infobulle. Utilisé par la page Machines (colonne « Sources ») et la carte de Réglages → Machines. L'accès SSH détaillé (compte, port, clé)
// reste dans le détail déplié.
import { Badge, type Tone } from "./ui";
import { MSTATE, mState } from "../lib/machines";
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import type { AgentInfo, Machine } from "../types";

type Src = { key: string; tone: Tone; label: string; tip: string };

/** Sources de la machine, dans l'ordre : état d'accès si elle est éteinte / injoignable / non suivie, SSH, agent, connecteurs */
export function sourcesOf(m: Machine, agent?: AgentInfo | null, extra: { type: string; name: string; label: string }[] = []): Src[] {
  const out: Src[] = [], st = mState(m);
  if (st === "down" || st === "off" || st === "disabled") out.push({ key: "state", tone: MSTATE[st][0], label: MSTATE[st][1], tip: MSTATE[st][2] });
  if (m.ssh) {
    const who = `${m.ssh.user || "?"}@${m.ip}:${m.ssh.port || 22}`;
    out.push(m.info
      ? { key: "ssh", tone: "ok", label: "SSH", tip: tx("Lue par SSH ({0}) : santé, Docker, services en écoute.", who) }
      : { key: "ssh", tone: st === "down" ? "bad" : "warn", label: "SSH", tip: `${MSTATE[st === "manual" ? "manual" : "refused"][2]} (${who})` });
  }
  if (agent || m.agent) {
    const state = agent?.state;
    const tone: Tone = state === "silencieux" ? "warn" : state === "en attente" ? "info" : state === "révoqué" ? "off" : "ok";
    out.push({ key: "agent", tone, label: tx("agent"), tip: agent
      ? tx("Agent MyServices v{0} : {1}. Dernier relevé : {2}.", agent.version ?? "?", agent.state, agent.last_seen ? dateTime(agent.last_seen * 1000) : "-")
      : tx("Agent MyServices : relevé récent, pas de SSH nécessaire.") });
  }
  const seen = new Set<string>();
  const add = (type: string, name: string, label: string, tone: Tone, tip: string) => { const k = `${type}/${name}`; if (!seen.has(k)) { seen.add(k); out.push({ key: k, tone, label, tip }); } };
  for (const a of m.api ?? []) add(a.type, a.name, a.label, a.ok ? "ok" : a.stale ? "warn" : "bad", `${a.label} (${a.name})${a.message ? ` : ${a.message}` : ""}`);
  for (const x of m.links?.sources ?? []) add(x.source, x.instance, x.label, x.ok === false ? "bad" : "ok", tx("{0} voit cette machine (rapprochée par {1}).", x.label, x.by === "mac" ? tx("adresse MAC") : x.by === "name" ? tx("nom") : "IP"));
  for (const x of extra) add(x.type, x.name, x.label, "ok", tx("{0} lit cette machine.", x.label));
  if (out.length === 0) { const [tone, label, tip] = MSTATE[st]; out.push({ key: "state", tone, label, tip }); }
  return out;
}

/** Source prioritaire : l'état d'accès s'il y en a un (éteinte, injoignable, non suivie), sinon la première source qui marche (SSH, agent, puis connecteurs),
 *  sinon la première tout court (en panne : on voit sa couleur) */
const primaryOf = (list: Src[]): Src => list[0].key === "state" ? list[0] : list.find((s) => s.tone === "ok") ?? list[0];

/** all : toutes les sources (carte dépliée) ; sinon seulement la prioritaire, avec « +N » (infobulle : les autres) */
export function SourceBadges({ m, agent, extra, all }: { m: Machine; agent?: AgentInfo | null; extra?: { type: string; name: string; label: string }[]; all?: boolean }) {
  const list = sourcesOf(m, agent, extra), first = primaryOf(list), shown = all ? list : [first], rest = list.filter((s) => s !== first);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((s) => <Badge key={s.key} tone={s.tone} title={s.tip}>{s.label}</Badge>)}
      {!all && rest.length > 0 && <span className="text-xs text-dim" title={rest.map((s) => `${s.label} : ${s.tip}`).join("\n")}>+{rest.length}</span>}
    </span>
  );
}
