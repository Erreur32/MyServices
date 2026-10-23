// Security › Wazuh: what Wazuh says of the home network at a glance. Figures on top (agents, alerts and serious ones over 24 h, critical
// vulnerabilities, compliance), the alerts per hour, the serious rules, then one row per machine (state, compliance, vulnerabilities as a bar).
import { ShieldCheck } from "lucide-react";
import type { Snapshot } from "../api";
import { hm } from "../lib/format";
import { tx } from "../lib/i18n";
import { scoreTone } from "../lib/wazuh";
import { averageScore, wazuhRows, type WazuhRow } from "../lib/wazuhPage";
import type { ServiceStatus } from "../types";
import { HeadTags } from "./HeadTags";
import { COLOR, StatTile } from "./StatTile";
import { Empty } from "./ui";

type Alerts = NonNullable<ServiceStatus["alerts"]>;

/** Alerts per hour over 24 h: one bar per hour, its serious part in red; a label every 6 hours */
function AlertsChart({ a }: Readonly<{ a: Alerts }>) {
  const max = Math.max(1, ...a.hours.map((h) => h.n)), W = 100 / Math.max(1, a.hours.length);
  return (
    <section className="rounded-xl border border-line bg-card p-4 shadow-sm" aria-label={tx("Alertes par heure, 24 h")}>
      <h2 className="flex flex-wrap items-baseline gap-x-3 font-bold">{tx("Alertes par heure, 24 h")}
        <span className="text-xs font-normal text-dim"><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-link/60" />{tx("toutes")}
          <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-sm bg-bad" />{tx("graves (niveau {0} et plus)", a.level)}</span>
      </h2>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-3 h-28 w-full" role="img" aria-label={tx("{0} alertes en 24 h, dont {1} graves", a.total, a.serious)}>
        {a.hours.map((h, i) => {
          const all = (h.n / max) * 40, bad = (h.serious / max) * 40;
          return (
            <g key={h.t}>
              <title>{`${hm(h.t * 1000)} : ${tx("{0} alertes, dont {1} graves", h.n, h.serious)}`}</title>
              <rect x={i * W + W * 0.1} width={W * 0.8} y={40 - all} height={all} className="fill-link/60" />
              {bad > 0 && <rect x={i * W + W * 0.1} width={W * 0.8} y={40 - Math.max(bad, 1)} height={Math.max(bad, 1)} className="fill-bad" />}
            </g>
          );
        })}
      </svg>
      <div className="relative mt-1 h-4 text-[10px] text-dim">
        {a.hours.map((h, i) => i % 6 === 0 && <span key={h.t} className="absolute" style={{ left: `${i * W}%` }}>{hm(h.t * 1000)}</span>)}
        <span className="absolute right-0">{tx("max {0}/h", max)}</span>
      </div>
    </section>
  );
}

/** The vulnerabilities of a machine as one bar, its length against the machine with the most, split by severity */
function VulnBar({ v, max }: Readonly<{ v: NonNullable<WazuhRow["m"]["vulns"]>; max: number }>) {
  const parts: [number, string, string][] = [[v.critical, "bg-bad", tx("critiques")], [v.high, "bg-warn", tx("hautes")], [v.medium, "bg-warn/40", tx("moyennes")], [v.low, "bg-line", tx("basses")]];
  const total = v.critical + v.high + v.medium + v.low;
  return (
    <div className="flex min-w-[10rem] items-center gap-2">
      <div className="flex h-2.5 flex-1 overflow-hidden rounded-sm bg-bg2" role="img" aria-label={parts.map(([n, , l]) => `${n} ${l}`).join(", ")}
        title={parts.map(([n, , l]) => `${n} ${l}`).join(" · ")}>
        <div className="flex h-full" style={{ width: `${(total / Math.max(1, max)) * 100}%` }}>
          {parts.map(([n, cls, l]) => n > 0 && <span key={l} className={`h-full ${cls}`} style={{ width: `${(n / total) * 100}%` }} />)}
        </div>
      </div>
      <span className="w-24 shrink-0 text-right text-xs tabular-nums"><b className={v.critical ? COLOR.bad : ""}>{v.critical}</b> / <span className={v.high ? COLOR.warn : ""}>{v.high}</span> <span className="text-dim">/ {total}</span></span>
    </div>
  );
}

function MachinesTable({ rows }: Readonly<{ rows: WazuhRow[] }>) {
  const max = Math.max(0, ...rows.map((r) => r.vulns));
  return (
    <section className="overflow-x-auto rounded-xl border border-line bg-card p-4 shadow-sm" aria-label={tx("Machines vues par Wazuh")}>
      <h2 className="font-bold">{tx("Machines vues par Wazuh")} <span className="text-sm font-normal text-dim">{rows.length}</span></h2>
      <table className="mt-2 w-full text-sm">
        <thead><tr className="text-left text-xs text-muted">
          <th className="py-1 pr-3 font-semibold">{tx("Machine")}</th><th className="py-1 pr-3 font-semibold">{tx("Agent")}</th>
          <th className="py-1 pr-3 font-semibold" title={tx("Score le plus bas des contrôles de configuration (SCA)")}>{tx("Conformité")}</th>
          <th className="py-1 font-semibold" title={tx("critiques / hautes / total")}>{tx("Vulnérabilités (critiques / hautes / total)")}</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const active = r.m.status === "active", worst = r.m.vulns?.worst ?? [];
            return (
              <tr key={r.ip} className={`border-t border-line/60 even:bg-bg/50 align-top ${active ? "" : "opacity-60"}`}>
                <td className="py-1.5 pr-3">
                  {r.machine ? <a href={`#machines/${r.machine.ip}`} className="font-semibold text-txt hover:text-link">{r.machine.name}</a> : <b className="font-semibold">{r.m.agent ?? r.ip}</b>}
                  <span className="block font-mono text-[11px] text-dim">{r.ip}</span>
                </td>
                <td className="py-1.5 pr-3"><span className={active ? COLOR.ok : COLOR.warn}>{active ? tx("actif") : (r.m.status ?? "?")}</span></td>
                <td className="py-1.5 pr-3">{r.score != null ? (
                  <span className="flex min-w-[6rem] items-center gap-2" title={(r.m.sca ?? []).map((p) => `${p.name} : ${p.score} %`).join("\n")}>
                    <span className="h-1.5 w-12 overflow-hidden rounded-sm bg-bg2"><span className={`block h-full ${scoreTone(r.score) === "ok" ? "bg-ok" : scoreTone(r.score) === "warn" ? "bg-warn" : "bg-bad"}`} style={{ width: `${r.score}%` }} /></span>
                    <span className={`tabular-nums ${COLOR[scoreTone(r.score)]}`}>{r.score} %</span>
                  </span>) : <span className="text-dim">-</span>}
                </td>
                <td className="py-1.5">
                  {r.m.vulns ? <VulnBar v={r.m.vulns} max={max} /> : <span className="text-dim">-</span>}
                  {worst.length > 0 && (
                    <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">{tx("Les plus graves")}</summary>
                      <ul className="mt-1 flex flex-col gap-0.5">{worst.map((c) => <li key={c.id}><span className={c.severity === "Critical" ? COLOR.bad : COLOR.warn}>{c.id}</span>{c.package && <span className="text-muted"> · {c.package}</span>}</li>)}</ul>
                    </details>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function WazuhPage({ snap, admin }: Readonly<{ snap: Snapshot; admin: boolean }>) {
  const list = (snap.data.services_status ?? []).filter((s) => s.connector === "wazuh");
  const w = list[0], rows = wazuhRows(list, snap.data.machine_list);
  const crit = rows.reduce((n, r) => n + (r.m.vulns?.critical ?? 0), 0), high = rows.reduce((n, r) => n + (r.m.vulns?.high ?? 0), 0);
  const avg = averageScore(rows), a = w?.alerts, ag = w?.agents, hasVulns = rows.some((r) => r.m.vulns);
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck size={18} aria-hidden />Wazuh</h1>
        {w && <HeadTags sources={[`${w.instance ?? w.name}${w.version ? ` ${w.version}` : ""}`]} others={w.stale ? [tx("relevé périmé")] : []} at={snap.data.generated} />}
        {admin && <a href="#settings/connectors" className="ml-auto text-sm text-link hover:underline">{tx("Connecteurs")} ›</a>}
      </div>
      {!w ? <Empty>{tx("Aucun Wazuh n'est relié : ajoutez le connecteur Wazuh dans Réglages, Connecteurs.")}</Empty> : <>
        <div className="flex flex-wrap gap-2">
          {ag && <StatTile n={`${ag.active}/${ag.total}`} label={tx("Agents actifs")} tone={ag.disconnected ? "bad" : "ok"} sub={ag.disconnected ? tx("{0} déconnecté(s)", ag.disconnected) : tx("tous connectés")} />}
          <StatTile n={a ? a.total : "-"} label={tx("Alertes 24 h")} sub={a ? undefined : tx("indexeur non réglé")} />
          <StatTile n={a ? a.serious : "-"} label={tx("Alertes graves 24 h")} tone={a ? (a.serious ? "bad" : "ok") : undefined} sub={a ? tx("niveau {0} et plus", a.level) : undefined} />
          <StatTile n={hasVulns ? crit : "-"} label={tx("Vulnérabilités critiques")} tone={hasVulns ? (crit ? "bad" : "ok") : undefined} sub={hasVulns ? tx("{0} hautes", high) : tx("indexeur non réglé")} />
          <StatTile n={avg != null ? `${avg} %` : "-"} label={tx("Conformité moyenne")} tone={avg != null ? scoreTone(avg) : undefined} sub={tx("contrôles de configuration (SCA)")} />
        </div>
        {a && a.hours.length > 0 && <AlertsChart a={a} />}
        {a && a.rules.length > 0 && (
          <section className="rounded-xl border border-line bg-card p-4 shadow-sm" aria-label={tx("Alertes graves, 24 h")}>
            <h2 className="font-bold">{tx("Alertes graves, 24 h")}</h2>
            <ul className="mt-2 flex flex-col divide-y divide-line/60 text-sm">
              {a.rules.map((r) => <li key={r.name} className="flex flex-wrap items-baseline gap-x-3 py-1.5"><span className={`font-semibold ${COLOR.bad}`}>{r.count}×</span><span className="min-w-0 flex-1">{r.name}</span><span className="text-xs text-dim">{tx("niveau {0}", r.level)}</span></li>)}
            </ul>
          </section>
        )}
        {rows.length > 0 && <MachinesTable rows={rows} />}
      </>}
    </div>
  );
}
