// Qui lit une machine : un badge court par source (SSH, agent, connecteurs), vert si tout va bien, d'une autre couleur sinon ; le détail est dans
// l'infobulle. Utilisé par la page Machines (colonne « Sources ») et la carte de Réglages → Machines. L'accès SSH détaillé (compte, port, clé)
// reste dans le détail déplié.
import { Badge, type Tone } from "./ui";
import { MSTATE, mState, stateBadge } from "../lib/machines";
import { dateTime } from "../lib/format";
import { appIcon } from "../lib/appIcons";
import { tx } from "../lib/i18n";
import type { AgentInfo, Machine } from "../types";

type Src = { key: string; tone: Tone; label: string; tip: string };
type Extra = { type: string; name: string; label: string };

const AGENT_TONE: Record<string, Tone> = { silencieux: "warn", "en attente": "info", révoqué: "off" };
const MATCHED_BY: Record<string, () => string> = { mac: () => tx("adresse MAC"), name: () => tx("nom") };

/** Badge d'état d'accès quand la machine est éteinte, injoignable ou non suivie */
function accessState(st: ReturnType<typeof mState>): Src[] {
  return st === "down" || st === "off" || st === "disabled" ? [{ key: "state", tone: MSTATE[st][0], label: MSTATE[st][1], tip: MSTATE[st][2] }] : [];
}

function sshSource(m: Machine, st: ReturnType<typeof mState>): Src[] {
  if (!m.ssh) return [];
  const who = `${m.ssh.user || "?"}@${m.ip}:${m.ssh.port || 22}`;
  if (m.info) return [{ key: "ssh", tone: "ok", label: "SSH", tip: tx("Lue par SSH ({0}) : santé, Docker, services en écoute.", who) }];
  const why = MSTATE[st === "manual" ? "manual" : "refused"][2];
  return [{ key: "ssh", tone: st === "down" ? "bad" : "warn", label: "SSH", tip: `${why} (${who})` }];
}

function agentSource(m: Machine, agent?: AgentInfo | null): Src[] {
  if (!agent && !m.agent) return [];
  const last = agent?.last_seen ? dateTime(agent.last_seen * 1000) : "-";
  const tip = agent ? tx("Agent MyServices v{0} : {1}. Dernier relevé : {2}.", agent.version ?? "?", agent.state, last) : tx("Agent MyServices : relevé récent, pas de SSH nécessaire.");
  return [{ key: "agent", tone: AGENT_TONE[agent?.state ?? ""] ?? "ok", label: tx("agent"), tip }];
}

const apiTip = (a: { label: string; name: string; message?: string | null }) => `${a.label} (${a.name})${a.message ? " : " + a.message : ""}`;

function apiTone(a: { ok: boolean; stale?: boolean }): Tone {
  if (a.ok) return "ok";
  return a.stale ? "warn" : "bad";
}

/** Connecteurs de la machine : leurs API, les outils réseau rapprochés, puis ceux que l'appelant ajoute (la Freebox, lue par son nom), sans doublon */
function connectorSources(m: Machine, extra: Extra[]): Src[] {
  const out: Src[] = [], seen = new Set<string>();
  const add = (type: string, name: string, label: string, tone: Tone, tip: string) => {
    const key = `${type}/${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, tone, label, tip });
  };
  for (const a of m.api ?? []) add(a.type, a.name, a.label, apiTone(a), apiTip(a));
  for (const x of m.links?.sources ?? []) {
    const by = MATCHED_BY[x.by]?.() ?? "IP";
    add(x.source, x.instance, x.label, x.ok === false ? "bad" : "ok", tx("{0} voit cette machine (rapprochée par {1}).", x.label, by));
  }
  for (const x of extra) add(x.type, x.name, x.label, "ok", tx("{0} lit cette machine.", x.label));
  return out;
}

/** Sources de la machine, dans l'ordre : état d'accès si elle est éteinte / injoignable / non suivie, SSH, agent, connecteurs */
export function sourcesOf(m: Machine, agent?: AgentInfo | null, extra: Extra[] = []): Src[] {
  const st = mState(m);
  const out = [...accessState(st), ...sshSource(m, st), ...agentSource(m, agent), ...connectorSources(m, extra)];
  if (out.length > 0) return out;
  const [tone, label, tip] = stateBadge(m);
  return [{ key: "state", tone, label, tip }];
}

/** Source prioritaire : l'état d'accès s'il y en a un (éteinte, injoignable, non suivie), sinon la première source qui marche (SSH, agent, puis connecteurs),
 *  sinon la première tout court (en panne : on voit sa couleur) */
const primaryOf = (list: Src[]): Src => (list[0].key === "state" ? list[0] : list.find((s) => s.tone === "ok") ?? list[0]);

const ICON_SSH = `${import.meta.env.BASE_URL}icons/ssh.svg`;
const MARK: Record<Tone, string> = { ok: "✓", warn: "⚠", bad: "✕", info: "•", off: "–" };

/** Info-bulle de la liste des sources : un titre, puis une ligne par source (logo, état, nom en gras, explication) */
function listTip(list: Src[], first: Src): string {
  const ordered = [first, ...list.filter((s) => s !== first)];   // la source prioritaire d'abord
  const lines = ordered.map((s, i) => {
    const icon = s.key === "ssh" ? ICON_SSH : appIcon([s.label]);
    return [icon ? `![](${icon})` : "", `[[${s.tone}:${MARK[s.tone]}]]`, `**${s.label}**`, i === 0 ? `**${tx("prioritaire")}**` : `[[off:${tx("complément")}]]`, s.tip].join("\t");
  });
  return [tx("Sources de lecture"), ...lines].join("\n");
}

/** all : toutes les sources (carte dépliée) ; sinon seulement la prioritaire, avec « +N » (infobulle : les autres) */
export function SourceBadges({ m, agent, extra, all }: Readonly<{ m: Machine; agent?: AgentInfo | null; extra?: Extra[]; all?: boolean }>) {
  const list = sourcesOf(m, agent, extra), first = primaryOf(list), shown = all ? list : [first], rest = list.filter((s) => s !== first);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((s) => <Badge key={s.key} tone={s.tone} title={s.tip}>{s.label}</Badge>)}
      {!all && rest.length > 0 && <span className="inline-flex cursor-help items-center rounded-md border border-line bg-bg2 px-1.5 py-0.5 text-xs font-semibold text-muted hover:border-link hover:text-txt" title={listTip(list, first)}>+{rest.length}</span>}
    </span>
  );
}
