// Machines → SSH connections: every machine read over SSH, where it connects (account@address:port) and whether its last read went
// through. Its access is set on the page of the machine (Access tab); the app's key lives in Administration → Accounts and access.
import { KeyRound, Terminal } from "lucide-react";
import type { Snapshot } from "../api";
import type { MachinesSettings } from "../types";
import { Badge, Card, Count, Dim, type Tone } from "../components/ui";
import { StatTile } from "../components/StatTile";
import { InfoNote } from "../components/InfoNote";
import { MachineIcon } from "../components/MachineIcon";
import { sshRows, type SshState } from "../lib/accessLists";
import { tx } from "../lib/i18n";

const STATE: Record<SshState, [Tone, string]> = {
  ok: ["ok", tx("lue")],
  refused: ["bad", tx("refusée")],
  unread: ["info", tx("pas encore lue")],
  off: ["off", tx("coupée à la main")],
};

export function SshConnections({ st, snap }: Readonly<{ st: MachinesSettings; snap: Snapshot }>) {
  const list = snap.data.machine_list ?? [];
  const rows = sshRows(st.machines, st.aliases, list, snap.data.connectors ?? []);
  const count = (s: SshState) => rows.filter((r) => r.state === s).length;
  const refused = count("refused");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        <StatTile n={count("ok")} label={tx("Lues")} tone="ok" />
        <StatTile n={refused} label={tx("Refusées")} tone={refused ? "bad" : undefined} />
        <StatTile n={count("unread")} label={tx("Pas encore lues")} />
        <StatTile n={count("off")} label={tx("Coupées à la main")} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold"><Terminal size={16} aria-hidden />{tx("Connexions SSH")} <Count n={rows.length} /></h2>
          <a href="#settings/ssh" className="inline-flex items-center gap-1.5 text-sm text-link hover:underline"><KeyRound size={14} aria-hidden />{tx("Clé SSH de l'app")} ›</a>
        </div>
        <InfoNote className="mt-2">{tx("Chaque machine lue par SSH : le compte et l'adresse utilisés, et si le dernier relevé est passé. L'accès se règle sur la page de la machine, onglet Accès.")}</InfoNote>
        {rows.length === 0 && <p className="mt-2 text-sm text-dim">{tx("Aucune machine lue par SSH pour l'instant : l'accès s'active sur la page d'une machine, onglet Accès.")}</p>}
        {rows.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
                <th className="px-3 py-2">{tx("Machine")}</th><th className="px-3 py-2">{tx("Connexion")}</th><th className="px-3 py-2">{tx("État")}</th><th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const [tone, label] = STATE[r.state];
                  const seen = list.find((x) => x.ip === r.ip);
                  return (
                    <tr key={r.ip} className="border-t border-line/60 align-middle even:bg-bg/50 hover:bg-bg2/40">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2"><MachineIcon m={{ ...seen, name: r.name, os: st.machines[r.ip]?.os }} reserve /><b className="truncate">{r.name}</b><Dim>{r.ip}</Dim></span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.access || <Dim>-</Dim>}</td>
                      <td className="px-3 py-2"><Badge tone={tone} title={r.message || undefined}>{label}</Badge></td>
                      <td className="px-3 py-2 text-right"><a href={`#machines/${r.ip}/access`} className="text-xs text-link hover:underline">{tx("Régler")} ›</a></td>
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
