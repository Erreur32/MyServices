// The Fail2ban of every machine read by its agent or over SSH, on the Fail2ban page of Security: what each one bans now, its peak of 24 h and
// whether it goes up (the same rule as the « Jail qui monte » alert). A machine opens its page.
import { Server } from "lucide-react";
import { tx } from "../lib/i18n";
import type { F2bState, MachineF2b } from "../lib/machineFail2ban";
import { FoldPanel } from "./FoldPanel";
import { InfoNote } from "./InfoNote";
import { Badge, Dim } from "./ui";

const COLS = "grid gap-x-6 gap-y-1 md:grid-cols-[minmax(0,1.3fr)_4rem_minmax(0,2fr)_4.5rem_4.5rem_minmax(0,1.2fr)]";
const VIA: Record<string, string> = { agent: tx("agent"), ssh: "SSH" };
const STATE: Record<F2bState, [string, "warn" | "off" | "ok"]> = {
  rising: [tx("Monte"), "warn"], usual: [tx("Habituel"), "off"], calm: [tx("Calme"), "ok"], unread: [tx("Non lu"), "warn"], absent: [tx("Non installé"), "off"],
};

function stateNote(m: MachineF2b): string {
  if (m.state === "rising") return tx("{0} fois son habitude ({1})", Math.round(m.total / Math.max(1, m.usual ?? 1)), Math.round(m.usual ?? 0));
  if (m.state === "unread") return m.rule ? tx("règle sudo à ajouter : {0}", m.rule) : tx("Fail2ban ne répond pas");
  return "";
}

function Row({ m }: Readonly<{ m: MachineF2b }>) {
  const banning = m.jails.filter((j) => j.banned > 0), quiet = m.jails.length - banning.length;
  const [label, tone] = STATE[m.state], note = stateNote(m), read = m.state !== "absent" && m.state !== "unread";
  return (
    <li className={`${COLS} items-center px-2 py-2`}>
      <a href={`#machines/${m.ip}`} className="truncate font-semibold hover:underline">{m.name} <Dim>{m.ip}</Dim></a>
      <span className="text-xs text-muted">{VIA[m.via] ?? m.via}</span>
      <span className="flex flex-wrap items-center gap-1">
        {banning.map((j) => <Badge key={j.name} outline tone={m.state === "rising" ? "warn" : "off"}>{j.name} · {j.banned}</Badge>)}
        {read && quiet > 0 && <Dim>{banning.length ? tx("{0} autre(s) à 0", quiet) : tx("{0} jail(s), aucune IP bannie", quiet)}</Dim>}
      </span>
      <span className="flex items-center gap-2 md:block md:text-right"><span className="text-xs text-dim md:hidden">{tx("Bannies")}</span>
        {read ? <b className="tabular-nums">{m.total}</b> : <Dim>-</Dim>}</span>
      <span className="flex items-center gap-2 md:block md:text-right"><span className="text-xs text-dim md:hidden">{tx("Pic 24 h")}</span>
        {read && m.peak != null ? <span className="tabular-nums">{m.peak}</span> : <Dim>-</Dim>}</span>
      <span className="min-w-0"><Badge tone={tone}>{label}</Badge>{note && <span className="block truncate text-xs text-dim" title={note}>{note}</span>}</span>
    </li>
  );
}

/** One row per machine whose health pass looked for Fail2ban */
export function MachineFail2ban({ rows }: Readonly<{ rows: MachineF2b[] }>) {
  const rising = rows.filter((m) => m.state === "rising").length;
  return (
    <FoldPanel id="security.fail2ban.machines" icon={Server} title={tx("Fail2ban des machines")} count={rows.length} tone={rising ? "warn" : undefined}>
      <InfoNote className="mb-3">{tx("Lu sur chaque machine par son agent, ou par SSH sans agent, à chaque passe de santé. « Monte » : au moins 10 IP bannies et 3 fois le niveau habituel de la machine (moyenne des 6 jours d'avant).")}</InfoNote>
      <div className={`${COLS} mb-1 hidden border-b border-line px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-dim md:grid`} aria-hidden>
        <span>{tx("Machine")}</span><span>{tx("Lu par")}</span><span>{tx("Jails qui bannissent")}</span><span className="text-right">{tx("Bannies")}</span>
        <span className="text-right">{tx("Pic 24 h")}</span><span>{tx("État")}</span>
      </div>
      <ul className="flex flex-col divide-y divide-line/60 text-sm [&>li:nth-child(even)]:bg-bg/50">{rows.map((m) => <Row key={m.id} m={m} />)}</ul>
    </FoldPanel>
  );
}
