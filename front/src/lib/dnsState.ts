// The DNS tab in « state » mode: the four figures and the rows to watch, worked out from the snapshot (data.dns and the dns part of
// each NPM host). One row per problem; the differences, orphans and invalid rewrites are grouped, their items in the detail.
import type { Dns, Host } from "../types";
import { tx } from "./i18n";
import { dnsSync, hostName } from "./status";

export interface DnsRow { key: string; sev: "bad" | "warn"; area: string; title: string; detail: string; anchor: string }
export interface DnsFigures { domains: number; domainsOk: number; servers: number; serversUp: number; sync: { cls: "ok" | "warn" | "bad"; label: string }; rewrites: number | null; diff: number }

/** A server answers: an AdGuard whose configuration is read and whose queries all answer, or a plain resolver that answered everything */
export const serverUp = (s: Dns["servers"][string]): boolean => (s.resolver ? !s.silent : s.readable && !s.silent);

const ISSUE: Record<string, string> = { absent: tx("ne résout pas"), ecart: tx("réponses différentes selon le serveur"), hors_lan: tx("résout hors du LAN"), bloque: tx("bloqué par une règle"), nom: tx("nom invalide") };

export function dnsFigures(g: Dns, hosts: Host[], at = Date.now()): DnsFigures {
  const checked = hosts.filter((r) => r.enabled && r.dns);
  const servers = Object.values(g.servers);
  const counts = servers.map((s) => s.rewrites).filter((n): n is number => n != null);
  const diff = [...g.rewrites_diff, ...g.user_rules_diff].filter((x) => !x.waiting).length;
  return { domains: checked.length, domainsOk: checked.filter((r) => !r.dns!.issues.length).length, servers: servers.length, serversUp: servers.filter(serverUp).length,
    sync: dnsSync(g, at), rewrites: counts.length ? Math.max(...counts) : null, diff };
}

export function dnsWatch(g: Dns, hosts: Host[], at = Date.now()): DnsRow[] {
  const out: DnsRow[] = [];
  for (const [ip, s] of Object.entries(g.servers)) {
    if (serverUp(s)) continue;
    const why = s.resolver || s.readable ? tx("{0} requête(s) sans réponse", s.silent) : tx("configuration illisible");
    out.push({ key: `srv/${ip}`, sev: "bad", area: tx("Instance"), title: s.name, detail: `${ip} · ${why}`, anchor: "servers" });
  }
  const sync = dnsSync(g, at);
  if (sync.cls === "bad") out.push({ key: "sync", sev: "bad", area: tx("Synchro"), title: sync.label, detail: Object.values(g.sync ?? {})[0]?.last_error?.split("\t")[0] ?? "", anchor: "servers" });
  for (const r of hosts.filter((x) => x.enabled && x.dns?.issues.length)) {
    const kinds = r.dns!.issues.map((i) => String(i[0]));
    out.push({ key: `host/${r.type}${r.id}`, sev: kinds.includes("absent") ? "bad" : "warn", area: tx("Domaine"), title: hostName(r), detail: kinds.map((k) => ISSUE[k] ?? k).join(" · "), anchor: "domains" });
  }
  const elsewhere = (g.machines ?? []).filter((m) => m.state === "ailleurs");
  for (const m of elsewhere) out.push({ key: `m/${m.ip}`, sev: "warn", area: tx("Machine"), title: m.name, detail: tx("son nom résout vers {0}, pas vers {1}", m.answer.join(", "), m.ip), anchor: "machines" });
  const diff = [...g.rewrites_diff, ...g.user_rules_diff].filter((x) => !x.waiting);
  if (diff.length) out.push({ key: "diff", sev: "warn", area: tx("Réécritures"), title: tx("{0} différence(s) entre instances", diff.length), detail: diff.slice(0, 4).map((x) => x.rule ?? x.domain).join(", ") + (diff.length > 4 ? "…" : ""), anchor: "diff" });
  if (g.orphans.length) out.push({ key: "orphans", sev: "warn", area: tx("Réécritures"), title: tx("{0} vers un host NPM inactif", g.orphans.length), detail: g.orphans.slice(0, 4).map((x) => x.domain).join(", ") + (g.orphans.length > 4 ? "…" : ""), anchor: "orphans" });
  if (g.invalid?.length) out.push({ key: "invalid", sev: "warn", area: tx("Réécritures"), title: tx("{0} au nom invalide", g.invalid.length), detail: g.invalid.slice(0, 4).map((x) => x.domain).join(", "), anchor: "invalid" });
  return out.sort((a, b) => Number(b.sev === "bad") - Number(a.sev === "bad"));
}
