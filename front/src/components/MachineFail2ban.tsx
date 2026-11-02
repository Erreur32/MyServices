// The Fail2ban of every machine read by its agent or over SSH, on the Fail2ban page of Security: what each one bans now, its peak of 24 h and
// whether it goes up (the same rule as the « Jail qui monte » alert). A machine opens its page.
import { Server } from "lucide-react";
import { tx } from "../lib/i18n";
import { STATE_ORDER, type F2bState, type MachineF2b } from "../lib/machineFail2ban";
import { FoldPanel } from "./FoldPanel";
import { InfoNote } from "./InfoNote";
import { useSort } from "../lib/filter";
import { Badge, Dim, Th } from "./ui";

const VIA: Record<string, string> = { agent: tx("agent"), ssh: "SSH" };
const STATE: Record<F2bState, [string, "warn" | "off" | "ok"]> = {
  rising: [tx("Monte"), "warn"], usual: [tx("Habituel"), "off"], calm: [tx("Calme"), "ok"], unread: [tx("Non lu"), "warn"], absent: [tx("Non installé"), "off"],
};

function stateNote(m: MachineF2b): string {
  if (m.state === "rising") return tx("{0} fois son habitude ({1})", Math.round(m.total / Math.max(1, m.usual ?? 1)), Math.round(m.usual ?? 0));
  if (m.state === "unread") return m.rule ? tx("règle sudo à ajouter : {0}", m.rule) : tx("Fail2ban ne répond pas");
  return "";
}

const rowKey = (m: MachineF2b, k: string): string | number => {
  if (k === "name") return m.name;
  if (k === "via") return m.via;
  if (k === "state") return STATE_ORDER.indexOf(m.state) * 1e6 - m.total;   // the ones to look at first, then the most banned
  return (k === "peak" ? m.peak : m.total) ?? -1;
};

function Row({ m }: Readonly<{ m: MachineF2b }>) {
  const banning = m.jails.filter((j) => j.banned > 0), quiet = m.jails.length - banning.length;
  const [label, tone] = STATE[m.state], note = stateNote(m), read = m.state !== "absent" && m.state !== "unread";
  return (
    <tr className="border-t border-line/60 even:bg-bg/50 hover:bg-bg2/40">
      <td className="max-w-0 px-3 py-2"><a href={`#machines/${m.ip}`} className="block truncate font-semibold hover:underline">{m.name} <Dim>{m.ip}</Dim></a></td>
      <td className="px-3 py-2 text-xs text-muted">{VIA[m.via] ?? m.via}</td>
      <td className="px-3 py-2"><span className="flex flex-wrap items-center gap-1">
        {banning.map((j) => <Badge key={j.name} outline tone={m.state === "rising" ? "warn" : "off"}>{j.name} · {j.banned}</Badge>)}
        {read && quiet > 0 && <Dim>{banning.length ? tx("{0} autre(s) à 0", quiet) : tx("{0} jail(s), aucune IP bannie", quiet)}</Dim>}
      </span></td>
      <td className="px-3 py-2 text-right tabular-nums">{read ? <b>{m.total}</b> : <Dim>-</Dim>}</td>
      <td className="px-3 py-2 text-right tabular-nums">{read && m.peak != null ? m.peak : <Dim>-</Dim>}</td>
      <td className="px-3 py-2"><Badge tone={tone}>{label}</Badge>{note && <span className="mt-0.5 block truncate text-xs text-dim" title={note}>{note}</span>}</td>
    </tr>
  );
}

/** One row per machine whose health pass looked for Fail2ban, every column sorts */
export function MachineFail2ban({ rows }: Readonly<{ rows: MachineF2b[] }>) {
  const rising = rows.filter((m) => m.state === "rising").length;
  const { sorted, ...sort } = useSort(rows, rowKey, "state");
  return (
    <FoldPanel id="security.fail2ban.machines" icon={Server} title={tx("Fail2ban des machines")} count={rows.length} tone={rising ? "warn" : undefined}>
      <InfoNote className="mb-3">{tx("Lu sur chaque machine par son agent, ou par SSH sans agent, à chaque passe de santé. « Monte » : au moins 10 IP bannies et 3 fois le niveau habituel de la machine (moyenne des 6 jours d'avant).")}</InfoNote>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
          <colgroup><col className="w-[22%]" /><col className="w-20" /><col /><col className="w-24" /><col className="w-24" /><col className="w-[22%]" /></colgroup>
          <thead><tr>
            <Th k="name" sort={sort}>{tx("Machine")}</Th><Th k="via" sort={sort}>{tx("Lu par")}</Th><Th>{tx("Jails qui bannissent")}</Th>
            <Th k="total" sort={sort} className="text-right">{tx("Bannies")}</Th><Th k="peak" sort={sort} className="text-right">{tx("Pic 24 h")}</Th><Th k="state" sort={sort}>{tx("État")}</Th>
          </tr></thead>
          <tbody>{sorted.map((m) => <Row key={m.id} m={m} />)}</tbody>
        </table>
      </div>
    </FoldPanel>
  );
}
