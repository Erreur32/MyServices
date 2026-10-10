// Réglages → Journal d'audit : les actions (connexions, échecs, changements), filtrées par type, compte et texte, exportables en CSV.
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LOGIN, LoginRequired, read } from "../api";
import { Card, Dim } from "../components/ui";
import { dateTime, norm } from "../lib/format";
import { input, quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import type { AuditEntry } from "../types";

const tone = (a: string) => (/échou|refus/.test(a) ? "text-bad" : /supprim|désactiv|mot de passe/.test(a) ? "text-warn" : "");
const csvCell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState(""), [action, setAction] = useState(""), [user, setUser] = useState("");
  useEffect(() => {
    read<{ audit: AuditEntry[] }>("audit?limit=1000")
      .then((a) => setEntries(a.audit))
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  const all = entries ?? [];
  const actions = useMemo(() => [...new Set(all.map((a) => a.action))].sort(), [all]);
  const users = useMemo(() => [...new Set(all.map((a) => a.username).filter((u): u is string => !!u))].sort(), [all]);
  const shown = useMemo(() => {
    const n = norm(q);
    return all.filter((a) => (!action || a.action === action) && (!user || a.username === user)
      && (!n || norm(`${a.username} ${a.ip} ${a.action} ${a.detail}`).includes(n)));
  }, [all, q, action, user]);
  const exportCsv = () => {
    const rows = [["date", "compte", "action", "détail", "ip"], ...shown.map((a) => [new Date(a.ts * 1000).toISOString(), a.username, a.action, a.detail, a.ip])];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" }));
    a.download = `myservices-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  if (!entries) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{tx("Journal d'audit")} <Dim>· {shown.length} / {entries.length}</Dim></h2>
        <button type="button" className={quiet} disabled={!shown.length} onClick={exportCsv}><Download size={14} />{tx("Exporter (CSV)")}</button>
      </div>
      <p className="mb-2 text-xs text-dim">{tx("Connexions, échecs, passages demandés, changements de comptes ; gardé un an.")}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className={input} value={action} onChange={(e) => setAction(e.target.value)} aria-label={tx("Type d'action")}>
          <option value="">{tx("Tous les types")}</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className={input} value={user} onChange={(e) => setUser(e.target.value)} aria-label={tx("Compte")}>
          <option value="">{tx("Tous les comptes")}</option>
          {users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <input className={`${input} max-w-xs`} type="search" placeholder={tx("Filtrer (compte, IP, action…)")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-[520px] overflow-y-auto">
        <table className="w-full border-collapse text-sm">
          <tbody className="[&>tr]:border-b [&>tr]:border-line/60">
            {shown.map((a, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap py-1.5 pr-3 text-dim">{dateTime(a.ts * 1000)}</td>
                <td className="py-1.5 pr-3 font-medium">{a.username || "—"}</td>
                <td className={`py-1.5 pr-3 ${tone(a.action)}`}>{a.action}{a.detail && <Dim> · {a.detail}</Dim>}</td>
                <td className="hidden whitespace-nowrap py-1.5 font-mono text-xs text-dim sm:table-cell">{a.ip || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
