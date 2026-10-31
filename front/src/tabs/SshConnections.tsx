// Machines → SSH connections: every machine read over SSH, where it connects (account@address:port), whether its last read went through,
// and whether SSH is still needed there: an agent reads the same health every minute, SSH stays useful only for what the agent does not read
// (backups, NPM, AdGuard, a hypervisor). Each access is set on a page of its own (#settings/machines/ssh/<ip>, « + » for a new one: the
// other machines are not listed meanwhile). The app's key is the band on top, and each row tells which key the machine signs in with.
import { Cpu, Plus, Terminal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { read, type Snapshot } from "../api";
import type { Advice, AgentInfo, MachinesSettings, SystemState } from "../types";
import { AppKeyBand, keyOf } from "../components/AppKey";
import { Badge, Dim, type Tone } from "../components/ui";
import { StatTile } from "../components/StatTile";
import { InfoNote } from "../components/InfoNote";
import { FoldPanel } from "../components/FoldPanel";
import { PageHead } from "../components/PageHead";
import { MachineIcon } from "../components/MachineIcon";
import { sshNeed, sshRows, type SshNeed, type SshRow, type SshState } from "../lib/accessLists";
import { tx } from "../lib/i18n";
import { SettingsLink } from "../components/SettingsLink";
import { primary } from "../lib/forms";

/** What needs SSH on a machine, in words (codes from the server, access_advice.ssh_uses) */
const USE: Record<string, string> = { backups: tx("sauvegardes"), npm: "NPM", adguard: "AdGuard", borgmatic: "borgmatic", proxmox: "Proxmox", esxi: "ESXi",
  virsh: "KVM", incus: "Incus", lxc: "LXD", vboxmanage: "VirtualBox" };
const useText = (codes: string[]) => codes.map((c) => USE[c] ?? c).join(", ");

const STATE: Record<SshState, [Tone, string]> = {
  ok: ["ok", tx("lue")],
  refused: ["bad", tx("refusée")],
  unread: ["info", tx("pas encore lue")],
  off: ["off", tx("coupée à la main")],
};

/** The two lines of a machine that must keep its SSH: why it does, and what can still be done */
function KeepSsh({ why, children }: Readonly<{ why: string; children?: ReactNode }>) {
  return (
    <span className="flex flex-col items-start gap-0.5 text-xs">
      <Badge tone="warn">{tx("SSH à garder")}</Badge>
      <span className="text-muted">{why}</span>
      {children}
    </span>
  );
}

function SshAdvice({ ip, need, uses, canInstall }: Readonly<{ ip: string; need: SshNeed; uses: string[]; canInstall: boolean }>) {
  const install = <a href={`#machines/${ip}/agent`} className="inline-flex items-center gap-1 text-xs text-link hover:underline"><Cpu size={13} aria-hidden />{tx("Installer l'agent")} ›</a>;
  const agentPage = <a href={`#machines/${ip}/agent`} className="text-link hover:underline">{tx("Page de l'agent")} ›</a>;
  switch (need) {
    case "cut": return <Dim>-</Dim>;
    case "offer_agent": return install;
    case "no_agent": return <KeepSsh why={tx("Aucun agent ne s'installe sur ce système.")} />;
    case "silent": return <KeepSsh why={tx("L'agent n'envoie plus de relevé : le SSH prend le relais.")}>{agentPage}</KeepSsh>;
    case "uses": return <KeepSsh why={tx("L'agent ne lit pas : {0}", useText(uses))}>{canInstall && install}</KeepSsh>;
    default: return (
      <span className="flex flex-col items-start gap-0.5 text-xs">
        <Badge tone="info">{tx("SSH facultatif : l'agent suffit")}</Badge>
        <span className="text-muted">{tx("Vous pouvez retirer le SSH de cette machine : « Couper le SSH » le désactive, rien n'est coupé tout seul.")}</span>
        <span className="flex gap-3">{agentPage}<a href={`#settings/machines/ssh/${ip}`} className="text-link hover:underline">{tx("Couper le SSH")} ›</a></span>
      </span>
    );
  }
}

/** The key a machine signs in with: the app's (or its ESXi one), another key, none; refused when the read does not go through */
const KEY: Record<ReturnType<typeof keyOf>, [Tone, string]> = {
  app: ["ok", tx("clé de l'app")],
  esxi: ["ok", tx("clé ESXi")],
  other: ["info", tx("autre clé")],
  none: ["off", tx("aucune (accès manuel)")],
};

export function SshConnections({ st, snap }: Readonly<{ st: MachinesSettings; snap: Snapshot }>) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [key, setKey] = useState<SystemState["ssh"] | null>(null);
  const [advice, setAdvice] = useState<Record<string, Advice>>({});
  useEffect(() => {
    read<{ agents: AgentInfo[] }>("agents").then((r) => setAgents(r.agents)).catch(() => undefined);
    read<SystemState>("system").then((r) => setKey(r.ssh)).catch(() => undefined);
    read<{ advice: Record<string, Advice> }>("machines/advice").then((r) => setAdvice(r.advice)).catch(() => undefined);
  }, []);
  const withAgent = new Set(agents.filter((a) => a.state !== "révoqué").map((a) => a.ip));
  const working = new Set(agents.filter((a) => a.state === "actif").map((a) => a.ip));
  const list = snap.data.machine_list ?? [];
  const rows = sshRows(st.machines, st.aliases, list, snap.data.connectors ?? []);
  const count = (s: SshState) => rows.filter((r) => r.state === s).length;
  const refused = count("refused");
  const usesOf = (ip: string) => st.ssh_uses?.[ip] ?? [];
  const needOf = (r: SshRow) => sshNeed(r.state === "off", usesOf(r.ip), withAgent.has(r.ip), working.has(r.ip), advice[r.ip]?.agent_possible);
  const needs = rows.map(needOf);
  const keep = needs.filter((n) => n === "uses" || n === "no_agent" || n === "silent").length;
  return (
    <div className="flex flex-col gap-4">
      <PageHead icon={Terminal} title={tx("Connexions SSH")} tags={<span className="flex flex-wrap items-center gap-1.5 text-sm"><Badge tone="info" outline>{tx("{0} connexion(s)", rows.length)}</Badge></span>}
        actions={<a href="#settings/machines/ssh/new" className={`${primary} py-1 no-underline`}><Plus size={14} aria-hidden />{tx("Connexion SSH")}</a>} />
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        <StatTile n={count("ok")} label={tx("Lues")} tone="ok" />
        <StatTile n={refused} label={tx("Refusées")} tone={refused ? "bad" : undefined} />
        <StatTile n={count("unread")} label={tx("Pas encore lues")} />
        <StatTile n={count("off")} label={tx("Coupées à la main")} />
        <StatTile n={keep} label={tx("SSH à garder")} tone={keep ? "warn" : undefined} />
        <StatTile n={needs.filter((n) => n === "optional").length} label={tx("SSH facultatif")} />
      </div>
      {key && <AppKeyBand ssh={key} />}
      <FoldPanel id="ssh-list" icon={Terminal} title={tx("Connexions SSH")} count={rows.length} pinned>
        <InfoNote>{tx("L'agent MyServices fait les mêmes relevés de santé et d'inventaire, sans clé SSH sur la machine. Gardez le SSH pour ce qu'il ne lit pas : sauvegardes, Proxmox ou ESXi, NPM, AdGuard. « SSH à garder » signale aussi un système sans agent possible et un agent qui n'envoie plus de relevé. Sur « SSH facultatif », vous pouvez retirer le SSH avec « Couper le SSH » : rien n'est coupé tout seul.")}</InfoNote>
        {rows.length === 0 && <p className="mt-2 text-sm text-dim">{tx("Aucune machine lue par SSH pour l'instant : l'accès s'active sur la page d'une machine, onglet Accès.")}</p>}
        {rows.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
                <th className="px-3 py-2">{tx("Machine")}</th><th className="px-3 py-2">{tx("Connexion")}</th><th className="px-3 py-2">{tx("Clé")}</th><th className="px-3 py-2">{tx("État")}</th><th className="px-3 py-2">{tx("Besoin du SSH")}</th><th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const [tone, label] = STATE[r.state];
                  const seen = list.find((x) => x.ip === r.ip);
                  const [keyTone, keyLabel] = KEY[keyOf(key, seen?.ssh?.identity, seen?.ssh?.key_fp)];
                  return (
                    <tr key={r.ip} className="border-t border-line/60 align-middle even:bg-bg/50 hover:bg-bg2/40">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2"><MachineIcon m={{ ...seen, name: r.name, os: st.machines[r.ip]?.os }} reserve /><b className="truncate">{r.name}</b><Dim>{r.ip}</Dim></span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.access || <Dim>-</Dim>}</td>
                      <td className="px-3 py-2">{r.state === "off" || !seen?.ssh ? <Dim>-</Dim> : <Badge tone={keyTone} title={seen.ssh.key_fp ?? undefined}>{keyLabel}</Badge>}</td>
                      <td className="px-3 py-2"><Badge tone={tone} title={r.message || undefined}>{label}</Badge></td>
                      <td className="px-3 py-2"><SshAdvice ip={r.ip} need={needOf(r)} uses={usesOf(r.ip)} canInstall={!withAgent.has(r.ip) && advice[r.ip]?.agent_possible !== false} /></td>
                      <td className="px-3 py-2 text-right"><SettingsLink href={`#settings/machines/ssh/${r.ip}`} of={r.name} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </FoldPanel>
    </div>
  );
}
