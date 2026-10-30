// Machines → Agents → « Agent » button (#settings/machines/agents/new): the known machines that have no agent, the ones where an agent is advised on
// top; « Installer l'agent » creates it and shows its command on the same page. The advice is the one of the machine's Access tab (GET machines/advice).
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { read } from "../api";
import { AgentInstall, type InstallTarget } from "../components/AgentInstall";
import { BackButton } from "../components/BackButton";
import { InfoNote } from "../components/InfoNote";
import { MachineIcon } from "../components/MachineIcon";
import { Badge, Card, Dim, Loading } from "../components/ui";
import { agentCandidates, type AgentCandidate } from "../lib/agentCandidates";
import { describeAdvice } from "../lib/access";
import { primary, quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import type { Advice, AgentsState, MachineConf } from "../types";

const toAgents = () => { location.hash = "settings/machines/agents"; };

function Row({ c, conf, onInstall }: Readonly<{ c: AgentCandidate; conf?: MachineConf; onInstall: (t: InstallTarget) => void }>) {
  const kind = c.advice.agent_kind;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-sm">
      <MachineIcon m={{ name: c.name, os: conf?.os ?? kind ?? undefined }} reserve />
      <span className="min-w-0 flex-1">
        <b className="block truncate">{c.name}</b>
        <span className="block truncate text-xs text-dim" title={describeAdvice(c.ip, c.advice).why}>{c.ip} · {describeAdvice(c.ip, c.advice).why}</span>
      </span>
      {c.tier === "advised" && <Badge tone="ok">{tx("conseillé")}</Badge>}
      {kind && <Badge tone="off">{kind === "windows" ? "Windows" : "Linux"}</Badge>}
      {kind && <button type="button" className={c.tier === "advised" ? primary : quiet} onClick={() => onInstall({ ip: c.ip, name: c.name, kind, auto: true })}><Plus size={14} aria-hidden />{tx("Installer l'agent")}</button>}
    </li>
  );
}

function Group({ title, hint, list, machines, onInstall }: Readonly<{ title: string; hint?: string; list: AgentCandidate[]; machines: Record<string, MachineConf>; onInstall: (t: InstallTarget) => void }>) {
  if (!list.length) return null;
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="flex items-center gap-2 text-sm font-bold">{title} <Dim>{list.length}</Dim></h3>
      {hint && <InfoNote className="mt-1">{hint}</InfoNote>}
      <ul className="mt-1 divide-y divide-line/60">{list.map((c) => <Row key={c.ip} c={c} conf={machines[c.ip]} onInstall={onInstall} />)}</ul>
    </section>
  );
}

export function NewAgentPage({ machines }: Readonly<{ machines: Record<string, MachineConf> }>) {
  const [advice, setAdvice] = useState<Record<string, Advice> | null>(null), [agents, setAgents] = useState<AgentsState["agents"] | null>(null);
  const [install, setInstall] = useState<InstallTarget | null>(null);
  const reload = useCallback(() => { read<AgentsState>("agents").then((r) => setAgents(r.agents)).catch(() => setAgents([])); }, []);
  useEffect(() => {
    reload();
    read<{ advice: Record<string, Advice> }>("machines/advice").then((r) => setAdvice(r.advice)).catch(() => setAdvice({}));
  }, [reload]);
  const list = advice && agents ? agentCandidates(machines, advice, agents) : null;
  const tier = (t: AgentCandidate["tier"]) => (list ?? []).filter((c) => c.tier === t);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <BackButton label={tx("Agents")} onClick={toAgents} />
        <h2 className="text-lg font-bold">{tx("Nouvel agent")}</h2>
      </div>
      {install && <AgentInstall key={install.ip} target={install} onChanged={reload} onClose={() => { setInstall(null); toAgents(); }} />}
      {!install && !list && <Loading />}
      {!install && list && (
        <>
          <InfoNote>{tx("Les machines que MyServices connaît déjà et qui n'ont pas encore d'agent. L'agent lit leur santé chaque minute, sans clé SSH ; « conseillé » veut dire que c'est la meilleure façon de la lire. Une machine absente de la liste s'ajoute d'abord dans Machines, « Ajouter une machine ».")}</InfoNote>
          {list.length === 0 && <p className="mt-3 text-sm text-dim">{tx("Toutes les machines suivies ont déjà un agent, ou n'en acceptent pas.")}</p>}
          <Group title={tx("Conseillés")} list={tier("advised")} machines={machines} onInstall={setInstall} />
          <Group title={tx("Possibles")} hint={tx("Déjà lues autrement (SSH, connecteur) : un agent donnerait une lecture régulière sans clé SSH.")} list={tier("possible")} machines={machines} onInstall={setInstall} />
          <Group title={tx("Pas d'agent possible")} list={tier("impossible")} machines={machines} onInstall={setInstall} />
        </>
      )}
    </Card>
  );
}
