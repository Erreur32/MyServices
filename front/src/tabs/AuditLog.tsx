// Réglages → Journal d'audit : les actions (connexions, échecs, changements), filtrées par type, compte et texte, exportables en CSV.
import { Download, ScrollText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LOGIN, LoginRequired, read } from "../api";
import { Badge, Card, Count, Dim } from "../components/ui";
import { auditTone, counted, inPeriod, type AuditTone } from "../lib/audit";
import { dateTime, norm } from "../lib/format";
import { quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import type { AuditEntry } from "../types";
import { InfoNote } from "../components/InfoNote";

const TEXT: Record<AuditTone, string> = { bad: "text-bad", warn: "text-warn", ok: "", info: "" };
const DOT: Record<AuditTone, string> = { bad: "bg-bad", warn: "bg-warn", ok: "bg-ok", info: "bg-link" };
const csvCell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`;
const PERIODS: [number, string][] = [[1, tx("24 h")], [7, tx("7 jours")], [30, tx("30 jours")], [0, tx("Tout")]];

function Tile({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return <div className="rounded-xl bg-bg2/60 px-3 py-2"><div className={`font-mono text-xl font-bold leading-tight ${tone ?? "text-txt"}`}>{value}</div><div className="text-xs text-dim">{label}</div></div>;
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState(""), [action, setAction] = useState(""), [user, setUser] = useState(""), [days, setDays] = useState(7);
  useEffect(() => {
    read<{ audit: AuditEntry[] }>("audit?limit=1000")
      .then((a) => setEntries(a.audit))
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  const all = useMemo(() => entries ?? [], [entries]);
  const period = useMemo(() => inPeriod(all, days), [all, days]);
  const actions = useMemo(() => counted(period.map((a) => a.action)), [period]);
  const users = useMemo(() => counted(period.map((a) => a.username)), [period]);
  const shown = useMemo(() => {
    const n = norm(q);
    return period.filter((a) => (!action || a.action === action) && (!user || a.username === user) && (!n || norm(`${a.username} ${a.ip} ${a.action} ${a.detail}`).includes(n)));
  }, [period, q, action, user]);
  const exportCsv = () => {
    const rows = [["date", "compte", "action", "détail", "ip"], ...shown.map((a) => [new Date(a.ts * 1000).toISOString(), a.username, a.action, a.detail, a.ip])];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" }));
    a.download = `myservices-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  if (!entries) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  const fails = period.filter((a) => auditTone(a.action) === "bad").length;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold"><ScrollText size={16} aria-hidden />{tx("Journal d'audit")} <Count n={`${shown.length} / ${entries.length}`} /></h2>
          <button type="button" className={quiet} disabled={!shown.length} onClick={exportCsv}><Download size={14} />{tx("Exporter (CSV)")}</button>
        </div>
        <InfoNote className="mb-3">{tx("Connexions, échecs, passages demandés, changements de comptes ; gardé un an.")}</InfoNote>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile value={period.length} label={tx("événements sur la période")} />
          <Tile value={users.length} label={tx("comptes actifs")} />
          <Tile value={fails} label={tx("échecs ou refus")} tone={fails ? "text-bad" : "text-ok"} />
          <Tile value={counted(period.map((a) => a.ip)).length} label={tx("adresses IP")} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={tx("Période")}>
              {PERIODS.map(([d, l]) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={chip(days === d)}>{l}</button>)}
            </div>
            <label className="ml-auto flex min-w-[200px] max-w-xs flex-1 items-center gap-2 rounded-lg border border-line bg-bg2 px-3 py-1.5 focus-within:border-link">
              <Search size={14} className="text-dim" aria-hidden />
              <input className="w-full bg-transparent text-sm outline-none placeholder:text-dim" type="search" placeholder={tx("Filtrer (compte, IP, action…)")} value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          </div>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">{tx("Type d'action")}</legend>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={!action} onClick={() => setAction("")} className={chip(!action)}>{tx("Tous")}<span className="font-mono text-[11px] text-dim">{period.length}</span></button>
              {actions.map(([a, n]) => (
                <button key={a} type="button" aria-pressed={action === a} onClick={() => setAction(action === a ? "" : a)} className={chip(action === a)}>
                  <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[auditTone(a)]}`} />{a}<span className="font-mono text-[11px] text-dim">{n}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">{tx("Compte")}</legend>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={!user} onClick={() => setUser("")} className={chip(!user)}>{tx("Tous")}</button>
              {users.map(([u, n]) => (
                <button key={u} type="button" aria-pressed={user === u} onClick={() => setUser(user === u ? "" : u)} className={chip(user === u)}>
                  <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full bg-link/20 text-[10px] font-bold uppercase text-link">{u.slice(0, 1)}</span>{u}<span className="font-mono text-[11px] text-dim">{n}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </Card>

      <Card>
        {shown.length === 0 ? <p className="text-sm text-muted">{tx("Aucune entrée pour ce filtre.")}</p> : (
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-dim"><th className="pb-1.5 pr-3">{tx("Date")}</th><th className="pb-1.5 pr-3">{tx("Compte")}</th><th className="pb-1.5 pr-3">{tx("Action")}</th><th className="hidden pb-1.5 sm:table-cell">IP</th></tr></thead>
              <tbody className="[&>tr]:border-b [&>tr]:border-line/60">
                {shown.map((a, i) => {
                  const t = auditTone(a.action);
                  return (
                    <tr key={i}>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-dim">{dateTime(a.ts * 1000)}</td>
                      <td className="py-1.5 pr-3 font-medium">{a.username || "-"}</td>
                      <td className={`py-1.5 pr-3 ${TEXT[t]}`}><span aria-hidden className={`mr-2 inline-block h-2 w-2 rounded-full ${DOT[t]}`} />{a.action}{a.detail && <Dim> · {a.detail}</Dim>}</td>
                      <td className="hidden whitespace-nowrap py-1.5 font-mono text-xs text-dim sm:table-cell">{a.ip ? <Badge tone="off">{a.ip}</Badge> : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
