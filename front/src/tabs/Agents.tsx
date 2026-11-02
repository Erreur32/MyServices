// Gestion des agents MyServices (petit script en lecture seule, sans SSH) : le bloc d'une machine (sa page, onglet Accès) et la page
// Machines → Agents (tous les agents avec leurs gestes, agents révoqués). Un agent = un jeton lié à la machine, montré une seule fois avec la commande à coller.
// Gérés seulement depuis une session admin.
import { AgentTodo } from "../components/AgentGaps";
import { ArrowUpCircle, Check, KeyRound, MonitorUp, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { read, send } from "../api";
import { NoteLine } from "../components/form";
import { MachineIcon } from "../components/MachineIcon";
import { AgentInstall, type AgentKind, type InstallTarget } from "../components/AgentInstall";
import { agentBoxes } from "../lib/agentCommand";
import { NewAgentPage } from "./NewAgent";
import { act, danger, primary, quiet, type Note } from "../lib/forms";
import { Badge, Dim, Loading, SortTh } from "../components/ui";
import { useSort } from "../lib/filter";
import { StatTile } from "../components/StatTile";
import { HistoryTile, useAgentsHistory } from "../components/HistoryTile";
import { PeriodSwitch, usePeriod } from "../components/PeriodSwitch";
import type { TilePoint } from "../lib/tileHistory";
import { agentDown, agentHealth, agentNews, agentSummary } from "../lib/accessLists";
import { toHeader } from "../lib/headerNote";
import { scoreTone } from "../lib/figureTones";
import { dateTime, ipNum } from "../lib/format";
import type { AgentInfo, AgentsState, Machine, MachineConf } from "../types";
import { tx } from "../lib/i18n";
import { InfoNote } from "../components/InfoNote";
import { FoldPanel } from "../components/FoldPanel";
import { PageHead } from "../components/PageHead";
import { AccessChoice } from "../components/AccessChoice";

const STATE: Record<AgentInfo["state"], ["ok" | "warn" | "info" | "off", string]> = {
  actif: ["ok", tx("actif")],
  silencieux: ["warn", tx("silencieux")],
  "en attente": ["info", tx("en attente du premier relevé")],
  révoqué: ["off", tx("révoqué")],
};

const iconBtn = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border disabled:opacity-40";

/** The health of an agent in words: the worst of its three problems (late reports, old script, host to confirm), all of them in the pointer */
const healthTone = (n: number) => scoreTone(n, 80, 50);
type Down = ReturnType<typeof agentDown>;
function HealthBadge({ a, down }: Readonly<{ a: AgentInfo; down: Down }>) {
  const h = agentHealth(a);
  if (!h) return <Dim>-</Dim>;
  if (down === "off") return <Badge tone="off" title={tx("Réglée « souvent éteinte » : rien à faire. L'agent reprend ses relevés au rallumage, et se met à jour si la mise à jour automatique est active.")}>⏻ {tx("Machine éteinte")}</Badge>;
  if (down === "offline") return <Badge tone="off" title={tx("La machine ne répond plus : l'agent n'y est pour rien. Si elle est souvent coupée, réglez-la « souvent éteinte » dans Réglages › Machines.")}>◌ {tx("Hors ligne")}</Badge>;
  const why = h.why.length ? h.why.join(" · ") : tx("relevés à l'heure, script à jour, machine reconnue");
  if (a.state === "en attente") return <Badge tone="off" title={why}>… {tx("En attente")}</Badge>;
  if (a.state !== "actif") return <Badge tone="bad" title={why}>✕ {tx("Relevés en retard")}</Badge>;
  if (a.outdated) return <Badge tone="warn" title={why}>⚠ {tx("Script en retard")}</Badge>;
  if (a.host_pending) return <Badge tone="warn" title={why}>⚠ {tx("Nom à confirmer")}</Badge>;
  return <Badge tone="ok" title={why}>✓ {tx("Bon")}</Badge>;
}

const AgentVersion = ({ a, down }: Readonly<{ a: AgentInfo; down?: Down }>) => {
  if (!a.version) return <>-</>;
  return down ? <Dim>v{a.version}</Dim> : <>v{a.version}</>;   // what to do about it is in the Update column
};

/** Rank of the update state for sorting: what needs a look first */
const updateRank = (a: AgentInfo) => {
  if (!a.outdated) return 4;
  if (a.update_stuck) return 0;
  if (a.auto_update) return 3;
  return a.update_requested ? 2 : 1;
};

/** Where the update of an agent stands, in words; in manual with an old script, the button that asks for it */
function UpdateState({ a, down, busy, onRequest }: Readonly<{ a: AgentInfo; down?: Down; busy: boolean; onRequest: () => void }>): ReactNode {
  if (!a.version) return null;
  if (!a.outdated) return <Badge tone="ok">✓ {tx("à jour")}</Badge>;
  if (down) return <Dim>{a.auto_update || a.update_requested ? tx("au rallumage") : tx("v{0} disponible", a.latest_version ?? "?")}</Dim>;
  if (a.update_stuck) return <Badge tone="warn" title={tx("Deux relevés sont passés sans changer de version : regardez agent.log sur la machine (droits du dossier de l'agent, adresse du serveur).")}>⚠ {tx("non appliquée")}</Badge>;
  if (a.update_requested) return <Badge tone="info" title={tx("L'agent prend le nouveau script à son prochain relevé (au plus tard dans {0} min)", Math.round(a.interval / 60))}>⏳ {tx("demandée")}</Badge>;
  if (a.auto_update) return <Dim>{tx("v{0} au prochain relevé", a.latest_version ?? "?")}</Dim>;
  return (
    <button type="button" disabled={busy} onClick={onRequest} title={agentNews(a) ?? tx("Mettre à jour maintenant : l'agent récupère le nouveau script à son prochain relevé (au plus tard dans {0} min)", Math.round(a.interval / 60))}
      className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg border border-link/60 bg-link/10 px-2 text-xs font-semibold text-link hover:bg-link/20 disabled:opacity-40">
      <ArrowUpCircle size={13} aria-hidden />v{a.latest_version}
    </button>
  );
}

/** The update of an agent: Auto or Manual, then its state in words (up to date, next report, requested, not applied) or, in manual, the button */
function AgentUpdate({ a, down, onChanged }: Readonly<{ a: AgentInfo; down?: Down; onChanged: () => void }>) {
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string) => { setBusy(true); const ok = await act(fn, done, toHeader(setNote)); setBusy(false); if (ok) onChanged(); };
  const pick = (auto: boolean) => {
    if (auto !== !!a.auto_update) void run(() => send("PATCH", `agents/${a.id}`, { auto_update: auto }), auto ? tx("mise à jour automatique activée") : tx("mise à jour automatique coupée"));
  };
  const request = () => void run(() => send("POST", `agents/${a.id}/update`), tx("demandée : l'agent se mettra à jour à son prochain relevé"));
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <span role="radiogroup" aria-label={tx("Mise à jour de l'agent")} className="inline-flex overflow-hidden rounded-lg border border-line">
          {[true, false].map((auto) => (
            <button key={String(auto)} type="button" role="radio" aria-checked={!!a.auto_update === auto} disabled={busy} onClick={() => pick(auto)}
              title={auto ? tx("L'agent prend le nouveau script dès qu'il est plus ancien") : tx("L'agent ne se met à jour que sur demande")}
              className={`whitespace-nowrap px-2 py-1 text-xs font-semibold disabled:opacity-40 ${!!a.auto_update === auto ? "bg-link/15 text-link" : "bg-bg2 text-muted hover:text-txt"}`}>
              {auto ? tx("Auto") : tx("Manuel")}
            </button>
          ))}
        </span>
        <UpdateState a={a} down={down} busy={busy} onRequest={request} />
      </span>
      <NoteLine note={note} />
    </span>
  );
}


/** Le jeton arrive d'un poste qui porte un autre nom que le premier vu (machine renommée, ou jeton copié ailleurs) : ses relevés sont refusés tant que l'admin n'a pas confirmé. */
function HostConfirm({ a, reload, setNote }: Readonly<{ a: AgentInfo; reload: () => void; setNote: (n: Note) => void }>) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/50 bg-warn/10 px-2.5 py-1.5 text-xs text-txt" role="alert">
      <span className="min-w-0 flex-1">{tx("Relevés refusés : le poste s'appelle maintenant {0} (connu : {1}). Machine renommée, ou jeton copié sur un autre PC ?", a.host_pending ?? "?", a.hostname ?? "?")}</span>
      <button type="button" disabled={busy} className="inline-flex h-8 items-center gap-2 rounded-lg border border-warn/60 bg-bg2 px-2.5 font-semibold leading-none hover:border-link disabled:opacity-50"
        onClick={() => { setBusy(true); void act(() => send("POST", `agents/${a.id}/confirm-host`), tx("nom de poste confirmé"), setNote).then((ok) => { setBusy(false); if (ok) reload(); }); }}>
        <Check size={14} className="shrink-0" aria-hidden /><span className="leading-none">{tx("Confirmer ce nom")}</span>
      </button>
    </div>
  );
}


/** L'agent d'une machine, dans sa fenêtre (onglet Accès) : état, version, dernier relevé et gestes (mise à jour, nouveau jeton, révocation), ou son installation */
/** The boxes of the agent's install, seen without a new command. An agent too old to send them says nothing about them: not shown as unticked */
function AgentOptionBoxes({ a }: Readonly<{ a: AgentInfo }>) {
  if (a.kind !== "linux" || !a.last_seen) return null;
  if (a.outdated && Object.keys(a.options ?? {}).length === 0) return <Dim>{tx("connues après sa mise à jour")}</Dim>;
  return <span className="flex flex-wrap gap-1">{agentBoxes(a.options).map((b) => <Badge key={b.label} tone={b.on ? "ok" : "off"} outline title={b.on ? b.detail : tx("non installé")}>{b.label}</Badge>)}</span>;
}

/** The gestures of an agent, as buttons: new command (a new token), revoke (with a confirmation); its update is AgentUpdate. On the machine's
 *  page (its Access block) and on its row of Machines → Agents; the new command is shown by the caller (onInstall) */
function AgentActions({ a, kind, onChanged, onInstall }: Readonly<{ a: AgentInfo; kind: AgentKind; onChanged: () => void; onInstall: (t: InstallTarget) => void }>) {
  const [confirm, setConfirm] = useState<"" | "renew" | "revoke">(""), [note, setNote] = useState<Note>(null);
  return (
    <div className="flex flex-col items-end gap-1">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {confirm === "" && <>
            <button type="button" aria-label={tx("Nouvelle commande")} title={tx("Crée un nouveau jeton et révoque l'ancien : à refaire sur le PC avec la nouvelle commande")}
              onClick={() => setConfirm("renew")} className={`${iconBtn} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`}><KeyRound size={14} aria-hidden /></button>
            <button type="button" aria-label={tx("Révoquer")} title={tx("Révoquer")} onClick={() => setConfirm("revoke")}
              className={`${iconBtn} border-bad/50 text-bad hover:bg-bad/10`}><Trash2 size={14} aria-hidden /></button>
          </>}
          {confirm !== "" && <>
            <span className="text-xs text-muted">{confirm === "renew" ? tx("L'ancien jeton cessera de marcher.") : tx("La machine n'enverra plus rien.")}</span>
            <button type="button" className={danger} onClick={() => {
              if (confirm === "renew") { setConfirm(""); onInstall({ ip: a.ip, name: a.name, kind: a.kind ?? kind, auto: true, sudo: !!a.rights?.length || !!a.gaps?.includes("sudo"), options: a.options, url: a.url ?? undefined }); }
              else void act(() => send("DELETE", `agents/${a.id}`), tx("révoqué"), setNote).then((ok) => ok && onChanged());
            }}>{tx("Confirmer")}</button>
            <button type="button" className={quiet} onClick={() => setConfirm("")}>{tx("Annuler")}</button>
          </>}
        </div>
      <NoteLine note={note} />
    </div>
  );
}

/** `create`: the agent is created as soon as the block shows (the add-machine wizard, once « Agent » was chosen), no second click */
export function AgentBlock({ ip, name, kind, agent, create, onChanged }: Readonly<{ ip: string; name: string; kind: AgentKind; agent?: AgentInfo; create?: boolean; onChanged: () => void }>) {
  const [install, setInstall] = useState<InstallTarget | null>(create && !agent ? { ip, name, kind, auto: true } : null), [note, setNote] = useState<Note>(null);
  const [pointed, setPointed] = useState(() => location.hash === `#machines/${ip}/agent`), box = useRef<HTMLDivElement>(null);   // a link to this machine's agent: its frame opens, nothing is created before a choice
  useEffect(() => { if (pointed) box.current?.scrollIntoView({ block: "center" }); }, [pointed]);
  const frame = install ?? (pointed && !agent ? { ip, name, kind, choose: true } : null);
  if (frame) return <div ref={box}><AgentInstall key={frame.auto ? "renew" : "new"} target={frame} onChanged={onChanged} onClose={() => { setInstall(null); setPointed(false); }} /></div>;
  if (!agent) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line/60 bg-bg2/70 p-3 text-sm">
        <b>{tx("Agent")}</b><Dim>{tx("aucun : utile si le SSH est impossible")}</Dim>
        <button type="button" className={`${quiet} ml-auto`} onClick={() => setInstall({ ip, name, kind, choose: true })}><Plus size={14} aria-hidden />{tx("Installer un agent")}</button>
      </div>
    );
  }
  const [tone, label] = STATE[agent.state];
  return (
    <div ref={box} className="flex flex-col gap-2 rounded-lg border border-line/60 bg-bg2/70 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b>{tx("Agent")}</b><Badge tone={tone}>{label}</Badge>
        {agent.host_pending && <Badge tone="warn" title={tx("Nom de poste différent : {0} au lieu de {1}", agent.host_pending, agent.hostname ?? "?")}>{tx("nom à confirmer")}</Badge>}
        <span className="inline-flex items-center gap-1 text-xs" title={agent.outdated ? tx("Agent v{0} : la v{1} est disponible", agent.version ?? "?", agent.latest_version ?? "?") : undefined}>
          <AgentVersion a={agent} />
        </span>
        <AgentUpdate a={agent} onChanged={onChanged} />
        <Dim>{agent.last_seen ? tx("dernier relevé {0}", dateTime(agent.last_seen * 1000)) : tx("en attente du premier relevé")} · {tx("toutes les {0} min", Math.round(agent.interval / 60))}</Dim>
        <code className="font-mono text-xs text-dim" title={tx("Jeton")}>{tx("msv_")}agent_…{agent.hint}</code>
      </div>
      <AgentOptionBoxes a={agent} />
      {agent.host_pending && <HostConfirm a={agent} reload={onChanged} setNote={setNote} />}
      <NoteLine note={note} />
      <AgentActions a={agent} kind={kind} onChanged={onChanged} onInstall={setInstall} />
    </div>
  );
}

/** « Accès aux machines » : agent, SSH ou connecteur, lequel choisir. Shown from the icon in the header of Réglages → Machines */
export function AccessGuide() {
  return (
    <div className="mt-3 border-t border-line/60 pt-3">
      <h3 className="flex items-center gap-2 font-bold"><MonitorUp size={16} aria-hidden />{tx("Accès aux machines")}</h3>
      <InfoNote className="mt-1">
        {tx("Deux façons de lire la santé d'une machine, toujours en lecture seule.")} <b className="text-txt">{tx("Agent")}</b> {tx(": un petit script (PowerShell sur un PC Windows, Python sur une machine Linux), installé sur la machine, qui envoie lui-même sa santé à MyServices (disques, services, processeur, mémoire, mises à jour, journal) ; pas de SSH à ouvrir, et un PC souvent éteint se signale dès qu'il se rallume.")}{" "}
        <b className="text-txt">SSH</b> {tx(": pour les machines Linux, MyServices s'y connecte avec sa clé (santé, Docker, services en écoute).")}
      </InfoNote>
      <AccessChoice className="mt-3" />
      <InfoNote className="mt-1">{tx("Chaque machine se règle dans sa fenêtre, onglet Accès.")}</InfoNote>
    </div>
  );
}

/** Vue d'ensemble, en bas de Réglages → Machines : comment choisir entre agent, SSH et connecteur, et les agents révoqués */
/** One agent in the list of Machines → Agents: its machine, type, state, version, last report and its gestures in the row; a new command
 *  (new token) is shown under the row */
function AgentRow({ a, conf, down, onChanged, lit }: Readonly<{ a: AgentInfo; conf?: MachineConf; down: Down; onChanged: () => void; lit: boolean }>) {
  const [tone, label] = STATE[a.state], name = conf?.name ?? a.name;
  const [install, setInstall] = useState<InstallTarget | null>(null);
  return (
    <>
    <tr className={`border-t border-line/60 align-middle even:bg-bg/50 hover:bg-bg2/40 ${lit ? "ring-2 ring-inset ring-link/60" : ""}`}>
      <td className="px-3 py-2"><a href={`#machines/${a.ip}`} className="flex items-center gap-2 text-txt no-underline hover:text-link"><MachineIcon m={{ name, os: conf?.os ?? a.kind ?? "windows", osName: a.os }} reserve /><b className="truncate">{name}</b></a></td>
      <td className="px-3 py-2 font-mono text-xs tabular-nums text-dim">{a.ip}</td>
      <td className="px-3 py-2 text-xs">{a.kind === "linux" ? "Linux" : "Windows"}</td>
      <td className="px-3 py-2"><span className="flex flex-wrap gap-1"><Badge tone={tone}>{label}</Badge>{a.host_pending && <Badge tone="warn">{tx("nom à confirmer")}</Badge>}</span></td>
      <td className="px-3 py-2 text-xs"><span className="inline-flex items-center gap-1"><AgentVersion a={a} down={down} />{!down && <AgentTodo a={a} ssh={typeof conf?.ssh === "string"} />}</span></td>
      <td className="px-3 py-2"><AgentUpdate a={a} down={down} onChanged={onChanged} /></td>
      <td className="px-3 py-2"><AgentOptionBoxes a={a} /></td>
      <td className="px-3 py-2"><HealthBadge a={a} down={down} /></td>
      <td className="px-3 py-2 text-xs text-dim">{a.last_seen ? dateTime(a.last_seen * 1000) : tx("en attente du premier relevé")}</td>
      <td className="px-3 py-2"><AgentActions a={a} kind={a.kind ?? "windows"} onChanged={onChanged} onInstall={setInstall} /></td>
    </tr>
    {install && <tr><td colSpan={10} className="border-t border-line/60 bg-bg/40 px-3 py-3"><AgentInstall target={install} onChanged={onChanged} onClose={() => setInstall(null)} /></td></tr>}
    </>
  );
}

/** Machines → Agents: every agent in use with its gestures (the same block as on the machine's page), figures on top, one button to update
 *  the late ones, then the revoked ones. An agent is installed from the page of its machine, Access tab. */

/** The live agents, every column but Options sorts; the order of the server until one is picked */
function AgentsTable({ live, machines, downOf, reload, open }: Readonly<{ live: AgentInfo[]; machines: Record<string, MachineConf>; downOf: (a: AgentInfo) => Down; reload: () => void; open?: string }>) {
  const keyOf = useCallback((a: AgentInfo, k: string): string | number => {
    if (k === "name") return (machines[a.ip]?.name ?? a.name ?? "").toLowerCase();
    if (k === "ip") return ipNum(a.ip);
    if (k === "kind") return a.kind ?? "windows";
    if (k === "state") return a.state;
    if (k === "version") return Number(a.version) || 0;
    if (k === "update") return updateRank(a);
    if (k === "health") return downOf(a) ? 1 : agentHealth(a)?.score ?? -1;   // switched off: after the agents in use, before the ones never heard
    if (k === "seen") return a.last_seen ?? 0;
    return 0;
  }, [machines, downOf]);
  const { sorted, ...sort } = useSort(live, keyOf, "");
  const th = (k: string, label: string) => <SortTh k={k} sort={sort} className="px-3 py-2">{label}</SortTh>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
          {th("name", tx("Machine"))}{th("ip", "IP")}{th("kind", tx("Type"))}{th("state", tx("État"))}
          {th("version", tx("Version"))}{th("update", tx("Mise à jour"))}<th className="px-3 py-2">{tx("Options")}</th>{th("health", tx("Santé"))}{th("seen", tx("Dernier relevé"))}<th className="px-3 py-2" />
        </tr></thead>
        {/* keyed by machine: a new command gives the agent a new id, and the row must keep the frame showing that command */}
        <tbody>{sorted.map((a) => <AgentRow key={a.ip} a={a} conf={machines[a.ip]} down={downOf(a)} onChanged={reload} lit={open === a.ip} />)}</tbody>
      </table>
    </div>
  );
}
export function AgentsOverview({ machines, list, open }: Readonly<{ machines: Record<string, MachineConf>; list: Machine[]; open?: string }>) {
  const [st, setSt] = useState<AgentsState | null>(null);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const reload = useCallback(() => { read<AgentsState>("agents").then(setSt).catch(() => undefined); }, []);
  useEffect(reload, [reload]);
  const [hours, setHours] = usePeriod(), s = agentSummary(st?.agents ?? []);
  const hist = useAgentsHistory(hours, `${s.active}.${s.outdated.length}`), now = Math.floor(Date.now() / 1000), ratio = (p: TilePoint) => `${p[1]}/${p[2]}`, late = (p: TilePoint) => p[2] - p[1];
  if (open === "new") return <NewAgentPage machines={machines} />;
  if (!st) return <Loading />;
  const byIp = new Map(list.map((m) => [m.ip, m])), downOf = (a: AgentInfo) => agentDown(a, byIp.get(a.ip)), off = s.live.filter(downOf).length;
  const scores = s.live.filter((a) => !downOf(a)).map((a) => agentHealth(a)?.score ?? 0), avg = scores.length ? Math.round(scores.reduce((t, n) => t + n, 0) / scores.length) : null;
  const toAsk = s.outdated.filter((a) => !a.auto_update && !downOf(a));   // the automatic ones update alone, a switched-off one cannot
  const updateLate = async () => {
    setBusy(true);
    await act(() => Promise.all(toAsk.map((a) => send("POST", `agents/${a.id}/update`))), tx("demandée pour {0} agent(s) : chacun se met à jour à son prochain relevé", toAsk.length), toHeader(setNote));
    setBusy(false);
    reload();
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHead icon={MonitorUp} title={tx("Agents")} tags={<span className="flex flex-wrap items-center gap-1.5 text-sm"><Badge tone="info" outline>{tx("{0} agent(s)", s.live.length)}</Badge><Badge tone="ok" outline>{tx("{0} actif(s)", s.active)}</Badge></span>}
        actions={<>
          <a href="#settings/machines/agents/new" className={`${primary} py-1 no-underline`}><Plus size={14} aria-hidden />{tx("Agent")}</a>
          <PeriodSwitch value={hours} onChange={setHours} />
          {toAsk.length > 0 && <button type="button" className={`${primary} nudge`} disabled={busy} onClick={() => void updateLate()} title={tx("Les agents en manuel dont la machine répond : ceux en Auto se mettent à jour seuls")}><ArrowUpCircle size={14} aria-hidden />{tx("Mettre à jour les agents en retard ({0})", toAsk.length)}</button>}
        </>} />
      <div className="flex flex-wrap gap-2.5 pb-1">
        <HistoryTile n={s.active} label={tx("Actifs")} tone="ok" kind="curve" points={hist?.running ?? null} hours={hours} now={now} figure={(p) => p[1]} fmt={ratio} goodHigh />
        <HistoryTile n={avg ?? "-"} label={tx("Santé des agents")} tone={avg == null ? undefined : healthTone(avg)} fact={off ? tx("moyenne sur 100 · {0} machine(s) éteinte(s) non comptée(s)", off) : tx("moyenne sur 100")} scale={100} kind="curve" points={hist?.health ?? null} hours={hours} now={now} figure={(p) => p[1]} fmt={(p) => `${p[1]} / 100`} goodHigh />
        <StatTile n={s.silent} label={tx("Silencieux")} tone={s.silent ? "warn" : undefined} />
        <StatTile n={s.pending} label={tx("En attente")} />
        <StatTile n={s.rights} label={tx("Droits à compléter")} tone={s.rights ? "warn" : undefined} />
        <HistoryTile n={toAsk.length} label={tx("À mettre à jour")} tone={toAsk.length ? "warn" : undefined} kind="strip" points={hist?.late ?? null} hours={hours} now={now} figure={late} fmt={(p) => tx("{0} à mettre à jour", late(p))} goodHigh={false} />
      </div>
      <FoldPanel id="agents-list" icon={MonitorUp} title={tx("Agents")} count={s.live.length} pinned>
        <InfoNote>{tx("Un agent s'installe depuis la page d'une machine, onglet Accès. Ses gestes sont sur sa ligne : mise à jour automatique ou immédiate, nouveau jeton, révocation.")}</InfoNote>
        <NoteLine note={note} />
        {s.live.length === 0 && <p className="mt-2 text-sm text-dim">{tx("Aucun agent installé : le SSH lit déjà vos machines, ou aucun PC n'en a besoin.")}</p>}
        {s.live.length > 0 && (
          <AgentsTable live={s.live} machines={machines} downOf={downOf} reload={reload} open={open} />
        )}
      </FoldPanel>
      {s.revoked.length > 0 && <FoldPanel id="agents-revoked" icon={KeyRound} title={tx("Agents révoqués")} count={s.revoked.length} startFolded>
        <InfoNote className="mb-2">{tx("Leur jeton ne marche plus. « Supprimer » les retire de la liste pour de bon.")}</InfoNote>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {s.revoked.map((a) => <RevokedCard key={a.id} a={a} conf={machines[a.ip]} ip={a.ip} reload={reload} />)}
        </ul>
      </FoldPanel>}
    </div>
  );
}

/** Carte d'un agent révoqué : qui, quand, et l'effacer de la liste, déjà sans effet : pas de confirmation */
function RevokedCard({ a, conf, ip, reload }: Readonly<{ a: AgentInfo; conf?: MachineConf; ip: string; reload: () => void }>) {
  const [note, setNote] = useState<Note>(null);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-dim/50 bg-card/60 p-3 text-sm">
      <div className="flex items-center gap-3">
        <MachineIcon m={{ name: conf?.name ?? a.name, os: conf?.os ?? a.kind ?? "windows", osName: a.os }} reserve />
        <span className="min-w-0 flex-1">
          <b className="block truncate">{conf?.name ?? a.name}</b>
          <span className="block truncate text-xs text-dim">{ip}</span>
        </span>
        <Badge tone="off">{tx("révoqué")}</Badge>
      </div>
      <p className="text-xs text-dim">
        {tx("révoqué le {0}", dateTime((a.revoked ?? 0) * 1000))}{a.last_seen ? ` · ${tx("dernier relevé {0}", dateTime(a.last_seen * 1000))}` : ""}
        {" · "}<code className="font-mono">{tx("msv_")}agent_…{a.hint}</code>
      </p>
      <button type="button" className={`${danger} ml-auto`} onClick={() => void act(() => send("DELETE", `agents/${a.id}/purge`), tx("supprimé"), setNote).then((ok) => ok && reload())}><Trash2 size={14} />{tx("Supprimer")}</button>
      <NoteLine note={note} />
    </li>
  );
}
