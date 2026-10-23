// Machines → SSH connections: every machine read over SSH, where it connects (account@address:port), whether its last read went through,
// and whether SSH is still needed there: an agent reads the same health every minute, SSH stays useful only for what the agent does not read
// (backups, NPM, AdGuard, a hypervisor). Each access is set on a page of its own (#settings/machines/ssh/<ip>, « + » for a new one: the
// other machines are not listed meanwhile); the app's key lives in Administration → Accounts and access.
import { KeyRound, Plus, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { read, type Snapshot } from "../api";
import type { AgentInfo, MachinesSettings } from "../types";
import { Badge, Card, Count, Dim, type Tone } from "../components/ui";
import { StatTile } from "../components/StatTile";
import { InfoNote } from "../components/InfoNote";
import { MachineIcon } from "../components/MachineIcon";
import { sshRows, type SshState } from "../lib/accessLists";
import { tx } from "../lib/i18n";
import { SettingsLink } from "../components/SettingsLink";
import { primary } from "../lib/forms";

/** What needs SSH on a machine, in words (codes from the server, access_advice.ssh_uses) */
const USE: Record<string, string> = { backups: tx("sauvegardes"), npm: "NPM", adguard: "AdGuard", borgmatic: "borgmatic", proxmox: "Proxmox", esxi: "ESXi",
  virsh: "KVM", incus: "Incus", lxc: "LXD", vboxmanage: "VirtualBox" };
export const useText = (codes: string[]) => codes.map((c) => USE[c] ?? c).join(", ");

const STATE: Record<SshState, [Tone, string]> = {
  ok: ["ok", tx("lue")],
  refused: ["bad", tx("refusée")],
  unread: ["info", tx("pas encore lue")],
  off: ["off", tx("coupée à la main")],
};

/** Whether SSH is still needed: with an agent and nothing that needs SSH, it is optional; without an agent, the agent is offered */
function AgentAdvice({ ip, agent, uses }: Readonly<{ ip: string; agent: boolean; uses: string[] }>) {
  if (!agent) return <a href={`#machines/${ip}/access`} className="text-xs text-link hover:underline">{tx("Installer l'agent")} ›</a>;
  if (uses.length) return <span className="text-xs text-muted" title={tx("L'agent ne lit pas cela : gardez le SSH")}>{tx("agent installé · SSH utile : {0}", useText(uses))}</span>;
  return (
    <span className="text-xs">
      <Badge tone="info">{tx("SSH facultatif : l'agent suffit")}</Badge>{" "}
      <a href={`#settings/machines/ssh/${ip}`} className="text-link hover:underline">{tx("Couper le SSH")} ›</a>
    </span>
  );
}

export function SshConnections({ st, snap }: Readonly<{ st: MachinesSettings; snap: Snapshot }>) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  useEffect(() => { read<{ agents: AgentInfo[] }>("agents").then((r) => setAgents(r.agents)).catch(() => undefined); }, []);
  const withAgent = new Set(agents.filter((a) => a.state !== "révoqué").map((a) => a.ip));
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
          <span className="flex flex-wrap items-center gap-3">
            <a href="#settings/ssh" className="inline-flex items-center gap-1.5 text-sm text-link hover:underline"><KeyRound size={14} aria-hidden />{tx("Clé SSH de l'app")} ›</a>
            <a href="#settings/machines/ssh/new" className={`${primary} no-underline`}><Plus size={14} aria-hidden />{tx("Connexion SSH")}</a>
          </span>
        </div>
        <InfoNote className="mt-2">{tx("L'agent MyServices fait les mêmes relevés de santé chaque minute, sans clé SSH sur la machine. Gardez le SSH seulement pour ce que l'agent ne lit pas : sauvegardes, Proxmox ou ESXi, NPM, AdGuard. L'icône de réglage ouvre l'accès d'une machine.")}</InfoNote>
        {rows.length === 0 && <p className="mt-2 text-sm text-dim">{tx("Aucune machine lue par SSH pour l'instant : l'accès s'active sur la page d'une machine, onglet Accès.")}</p>}
        {rows.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
                <th className="px-3 py-2">{tx("Machine")}</th><th className="px-3 py-2">{tx("Connexion")}</th><th className="px-3 py-2">{tx("État")}</th><th className="px-3 py-2">{tx("Agent")}</th><th className="px-3 py-2" />
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
                      <td className="px-3 py-2"><AgentAdvice ip={r.ip} agent={withAgent.has(r.ip)} uses={st.ssh_uses?.[r.ip] ?? []} /></td>
                      <td className="px-3 py-2 text-right"><SettingsLink href={`#settings/machines/ssh/${r.ip}`} of={r.name} /></td>
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
