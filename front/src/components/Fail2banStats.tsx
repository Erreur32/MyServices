// Security -> Fail2ban: the statistics of the bans of the last 7 days (worked out by the connector): bans per hour and per day, per jail, the IPs banned most.
import { CalendarDays, Clock, Globe, Radar, ShieldAlert } from "lucide-react";
import type { Fail2banStats as Stats, SecurityConnector } from "../types";
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import { InfoNote } from "./InfoNote";
import { ChartToggle } from "./ChartToggle";
import { FoldPanel } from "./FoldPanel";
import { MiniBars } from "./MiniBars";
import { Badge } from "./ui";

/** The same domain seen by several sources counts once, with the numbers added */
function mergeDomains(rows: NonNullable<Stats["by_domain"]>): NonNullable<Stats["by_domain"]> {
  const by = new Map<string, { domain: string; hits: number; ips: number }>();
  for (const r of rows) {
    const cur = by.get(r.domain) ?? { domain: r.domain, hits: 0, ips: 0 };
    by.set(r.domain, { domain: r.domain, hits: cur.hits + r.hits, ips: cur.ips + r.ips });
  }
  return [...by.values()].sort((a, b) => b.ips - a.ips || b.hits - a.hits);
}

/** Several LogviewR / Fail2ban sources: their numbers add up (the IP and jail lists are merged) */
export function mergeStats(list: Stats[]): Stats {
  const sumOf = (lists: number[][]): number[] => lists.reduce<number[]>((acc, l) => acc.map((n, i) => n + (l[i] ?? 0)), lists[0].map(() => 0));
  const jails = new Map<string, { jail: string; d1: number; d7: number }>();
  for (const j of list.flatMap((s) => s.by_jail)) {
    const cur = jails.get(j.jail) ?? { jail: j.jail, d1: 0, d7: 0 };
    jails.set(j.jail, { jail: j.jail, d1: cur.d1 + j.d1, d7: cur.d7 + j.d7 });
  }
  return {
    hours: sumOf(list.map((s) => s.hours)), days: sumOf(list.map((s) => s.days)),
    by_jail: [...jails.values()].sort((a, b) => b.d7 - a.d7),
    top_ips: list.flatMap((s) => s.top_ips).sort((a, b) => b.bans - a.bans).slice(0, 10),
    unique_1d: list.reduce((n, s) => n + s.unique_1d, 0), unique_7d: list.reduce((n, s) => n + s.unique_7d, 0),
    repeat: list.reduce((n, s) => n + s.repeat, 0), failures_1d: list.reduce((n, s) => n + s.failures_1d, 0),
    by_domain: mergeDomains(list.flatMap((s) => s.by_domain ?? [])),
  };
}

function Tile({ value, label, tone }: Readonly<{ value: number; label: string; tone: "ok" | "warn" | "bad" }>) {
  const color = { ok: "text-ok", warn: "text-warn", bad: "text-bad" }[tone];
  return <div className="rounded-xl border border-line bg-card px-4 py-3"><div className={`font-mono text-xl font-bold leading-tight ${color}`}>{value}</div><div className="text-xs text-dim">{label}</div></div>;
}

function JailBars({ jails }: Readonly<{ jails: Stats["by_jail"] }>) {
  const max = Math.max(1, ...jails.map((j) => j.d7));
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {jails.map((j) => (
        <li key={j.jail} className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-3">
          <span className="truncate font-semibold">{j.jail}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-line/60" title={tx("{0} sur 7 jours, {1} sur 24 h", j.d7, j.d1)}>
            <span className="block h-full rounded-full bg-warn/70" style={{ width: `${(j.d7 / max) * 100}%` }} />
          </span>
          <span className="whitespace-nowrap text-xs text-dim"><b className="text-txt">{j.d7}</b> {tx("sur 7 j")} · {j.d1} {tx("sur 24 h")}</span>
        </li>
      ))}
    </ul>
  );
}

/** The domains the banned addresses went after: how many addresses and how many log lines each */
function Domains({ rows }: Readonly<{ rows: NonNullable<Stats["by_domain"]> }>) {
  const max = Math.max(1, ...rows.map((r) => r.hits));
  return (
    <ul className="flex flex-col divide-y divide-line/50 text-sm [&>li:nth-child(even)]:bg-bg/50">
      {rows.map((r) => (
        <li key={r.domain} className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)_auto] items-center gap-x-4 px-2 py-1.5 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]">
          <span className="truncate font-semibold">{r.domain}</span>
          <span className="h-2 overflow-hidden rounded-full bg-line/60"><span className="block h-full rounded-full bg-bad/70" style={{ width: `${(r.hits / max) * 100}%` }} /></span>
          <span className="whitespace-nowrap text-xs text-dim"><b className="text-txt">{r.ips}</b> {tx("adresse(s)")} · {r.hits} {tx("ligne(s)")}</span>
        </li>
      ))}
    </ul>
  );
}

function TopIps({ ips }: Readonly<{ ips: Stats["top_ips"] }>) {
  return (
    <ul className="flex flex-col divide-y divide-line/50 text-sm [&>li:nth-child(even)]:bg-bg/50">
      {ips.map((w) => (
        <li key={w.ip} className="grid grid-cols-[minmax(0,13rem)_4rem_minmax(0,1fr)_auto] items-center gap-3 px-2 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5"><code className="truncate font-mono text-xs">{w.ip}</code>
            {w.country && <Badge outline tone="off" title={[w.country, w.asn, w.org].filter(Boolean).join(" · ")}>{w.country}</Badge>}</span>
          <Badge tone={w.bans > 2 ? "bad" : "warn"}>{w.bans} {tx("ban(s)")}</Badge>
          <span className="flex min-w-0 flex-wrap gap-1">
            {w.jails.map((j) => <Badge key={j} outline tone="off">{j}</Badge>)}
            {(w.org || w.asn) && <Badge outline tone="off" title={w.asn ?? undefined}>{w.org ?? w.asn}</Badge>}
            {(w.domains ?? []).map((d) => <Badge key={d.domain} outline tone="info" title={tx("{0} ligne(s) de journal", d.hits)}><Globe size={11} aria-hidden />{d.domain}</Badge>)}
          </span>
          <span className="whitespace-nowrap text-xs text-dim">{w.failures ? `${w.failures} ${tx("échecs")} · ` : ""}{dateTime(w.last * 1000)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Fail2banStats({ sources }: Readonly<{ sources: SecurityConnector[] }>) {
  const stats = sources.map((c) => c.stats).filter((s): s is Stats => !!s);
  if (!stats.length) {
    return <InfoNote>{tx("Pas de statistiques : elles demandent LogviewR avec l'historique des bannissements (7 jours).")}</InfoNote>;
  }
  const s = stats.length > 1 ? mergeStats(stats) : stats[0];
  const bans24 = s.hours.reduce((n, v) => n + v, 0), bans7 = s.days.reduce((n, v) => n + v, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Tile value={bans24} label={tx("bannissements en 24 h")} tone={bans24 ? "warn" : "ok"} />
        <Tile value={bans7} label={tx("bannissements en 7 jours")} tone={bans7 ? "warn" : "ok"} />
        <Tile value={s.unique_1d} label={tx("adresses différentes en 24 h")} tone="ok" />
        <Tile value={s.repeat} label={tx("adresses revenues (7 jours)")} tone={s.repeat ? "bad" : "ok"} />
        <Tile value={s.failures_1d} label={tx("échecs de connexion en 24 h")} tone={s.failures_1d ? "warn" : "ok"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <FoldPanel id="security.f2b.hours" icon={Clock} title={tx("Par heure, sur 24 h")}>
          <MiniBars values={s.hours} color="bg-warn" label={tx("Bannissements par heure sur 24 h")} from={tx("il y a 24 h")} to={tx("maintenant")}
            titleOf={(i, n) => tx("{0} bannissement(s), il y a {1} h", n, 23 - i)} />
        </FoldPanel>
        <FoldPanel id="security.f2b.days" icon={CalendarDays} title={tx("Par jour, sur 7 jours")}>
          <MiniBars values={s.days} color="bg-bad/80" label={tx("Bannissements par jour sur 7 jours")} from={tx("il y a 7 j")} to={tx("aujourd'hui")}
            titleOf={(i, n) => tx("{0} bannissement(s), il y a {1} j", n, 6 - i)} />
        </FoldPanel>
      </div>
      {(s.by_jail.length > 0 || (s.by_domain ?? []).length > 0) && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {s.by_jail.length > 0 && (
            <ChartToggle id="security.f2b.jails" icon={ShieldAlert} startFolded title={tx("Par jail")} rows={s.by_jail.map((j) => ({ key: j.jail, label: j.jail, value: j.d7, detail: tx("{0} sur 7 jours, {1} sur 24 h", j.d7, j.d1) }))}
              list={<JailBars jails={s.by_jail} />} />
          )}
          {(s.by_domain ?? []).length > 0 && (
            <ChartToggle id="security.f2b.domains" icon={Globe} startFolded title={tx("Domaines visés")} rows={s.by_domain!.map((d) => ({ key: d.domain, label: d.domain, value: d.hits }))} list={<Domains rows={s.by_domain!} />} />
          )}
        </div>
      )}
      {(s.by_domain ?? []).length === 0 && s.top_ips.length > 0 && <InfoNote>{tx("Domaine visé inconnu : LogviewR doit lire les journaux de Nginx Proxy Manager ou d'Apache pour relier une adresse à un domaine.")}</InfoNote>}
      {s.top_ips.length > 0 && <FoldPanel id="security.f2b.ips" icon={Radar} startFolded title={tx("Adresses les plus bannies")} count={s.top_ips.length}><TopIps ips={s.top_ips} /></FoldPanel>}
    </div>
  );
}
