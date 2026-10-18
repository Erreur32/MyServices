// A Fail2ban / LogviewR source on the security page: its jails, the threats that are active now and the latest bans on aligned, striped columns.
import { Ban, ShieldAlert } from "lucide-react";
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import type { SecurityConnector } from "../types";
import { Badge, Card, Count, Dim } from "./ui";

const BAN_COLS = "grid items-center gap-x-6 md:grid-cols-[minmax(0,12rem)_10rem_7rem_minmax(0,1fr)]";
const BANS_SHOWN = 15;

const banKey = (b: NonNullable<SecurityConnector["bans"]>[number]): string => `${b.ip}/${b.jail}/${b.time ?? 0}/${b.failures ?? 0}`;

function BanRow({ b }: Readonly<{ b: NonNullable<SecurityConnector["bans"]>[number] }>) {
  return (
    <li className={`${BAN_COLS} gap-y-1 px-2 py-1.5`}>
      <code className="truncate font-mono text-xs">{b.ip}</code>
      <span><Badge outline tone="off">{b.jail}</Badge></span>
      <span className="text-xs text-muted">{b.failures ? `${b.failures} ${tx("échecs")}` : <Dim>-</Dim>}</span>
      <span className="text-xs text-dim md:text-right">{b.time ? dateTime(b.time * 1000) : ""}</span>
    </li>
  );
}

/** The latest bans, newest first, on aligned columns: the first ones in view, the others folded */
function LastBans({ bans }: Readonly<{ bans: NonNullable<SecurityConnector["bans"]> }>) {
  const sorted = [...bans].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 50);
  return (
    <div className="mt-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">{tx("Derniers bannissements")} <Count n={bans.length} tone="off" /></h3>
      <div className={`${BAN_COLS} border-b border-line px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim max-md:hidden`} aria-hidden>
        <span>{tx("Adresse")}</span><span>{tx("Jail")}</span><span>{tx("Échecs")}</span><span className="text-right">{tx("Quand")}</span>
      </div>
      <ul className="flex flex-col divide-y divide-line/50 text-sm [&>li:nth-child(even)]:bg-bg/50">{sorted.slice(0, BANS_SHOWN).map((b) => <BanRow key={banKey(b)} b={b} />)}</ul>
      {sorted.length > BANS_SHOWN && (
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer px-1 py-1 text-xs font-semibold text-muted hover:text-txt">{tx("Voir les {0} suivants", sorted.length - BANS_SHOWN)}</summary>
          <ul className="flex flex-col divide-y divide-line/50 text-sm [&>li:nth-child(even)]:bg-bg/50">{sorted.slice(BANS_SHOWN).map((b) => <BanRow key={banKey(b)} b={b} />)}</ul>
        </details>
      )}
    </div>
  );
}

/** One Fail2ban / LogviewR connector: jails, active threats and the latest bans (shared with the new security page) */
export function Fail2banCard({ c }: Readonly<{ c: SecurityConnector }>) {
  const byJail = new Map<string, number>();
  (c.bans ?? []).forEach((b) => byJail.set(b.jail, (byJail.get(b.jail) ?? 0) + 1));
  return (
    <Card className={c.ok ? "" : "border-bad/40"}>
      <h2 className="flex flex-wrap items-center gap-2 font-bold"><Ban size={16} aria-hidden />{tx("Fail2ban")} <Dim>· {c.label} {c.name}</Dim>
        <Badge tone={c.ok ? "ok" : "bad"}>{c.ok ? tx("en ligne") : tx("illisible")}</Badge>{c.stale && <Badge tone="warn">{tx("relevé périmé")}</Badge>}</h2>
      {!c.ok && !c.stale ? <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{c.message}</p> : <>
        {(c.jails ?? []).length > 0 && <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">{c.jails!.map((j) => <Badge key={j} tone={byJail.has(j) ? "warn" : "off"}>{j}{byJail.has(j) && ` · ${byJail.get(j)}`}</Badge>)}</p>}
        {(c.threats ?? []).length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-bad"><ShieldAlert size={14} aria-hidden />{tx("Menaces actives")} <Count n={c.threats!.length} tone="bad" /></h3>
            <ul className="flex flex-col gap-1 text-sm">
              {c.threats!.map((t) => (
                <li key={t.key} className="flex flex-wrap items-baseline gap-2 rounded-lg bg-bad/5 px-3 py-1.5">
                  <Badge tone="bad">{t.kind === "ip_escalation" ? tx("IP sur plusieurs jails") : tx("campagne {0}", t.asn ?? "")}</Badge>
                  <code className="font-mono text-xs">{t.ips.slice(0, 5).join(", ")}{t.ip_count > 5 ? ` +${t.ip_count - 5}` : ""}</code>
                  <Dim>{t.jails.join(", ")}{t.bans != null ? ` · ${t.bans} ${tx("bannissement(s)")}` : ""}{t.last ? ` · ${tx("dernier")} ${dateTime(t.last * 1000)}` : ""}</Dim>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(c.bans ?? []).length > 0 && <LastBans bans={c.bans!} />}
      </>}
    </Card>
  );

}
