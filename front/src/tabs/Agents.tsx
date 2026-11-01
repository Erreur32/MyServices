// Gestion des agents MyServices (petit script en lecture seule, sans SSH) : le bloc d'une machine (sa page, onglet Accès) et la page
// Machines → Agents (tous les agents avec leurs gestes, agents révoqués). Un agent = un jeton lié à la machine, montré une seule fois avec la commande à coller.
// Gérés seulement depuis une session admin.
import { AgentTodo } from "../components/AgentGaps";
import { ArrowUpCircle, Check, KeyRound, MonitorUp, Plus, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { read, send } from "../api";
import { NoteLine } from "../components/form";
import { MachineIcon } from "../components/MachineIcon";
import { AgentInstall, type AgentKind, type InstallTarget } from "../components/AgentInstall";
import { agentBoxes } from "../lib/agentCommand";
import { NewAgentPage } from "./NewAgent";
import { act, danger, primary, quiet, type Note } from "../lib/forms";
import { Badge, Dim, Loading } from "../components/ui";
import { StatTile } from "../components/StatTile";
import { HistoryTile, useAgentsHistory } from "../components/HistoryTile";
import { PeriodSwitch, usePeriod } from "../components/PeriodSwitch";
import type { TilePoint } from "../lib/tileHistory";
import { agentHealth, agentNews, agentSummary } from "../lib/accessLists";
import { toHeader } from "../lib/headerNote";
import { scoreTone } from "../lib/figureTones";
import { dateTime } from "../lib/format";
import type { AgentInfo, AgentsState, MachineConf } from "../types";
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

/** The health of an agent as a bar and its figure out of 100 (green from 80, orange from 50); the pointer tells what is missing */
const healthTone = (n: number) => scoreTone(n, 80, 50);
const FILL = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };
function HealthBar({ a }: Readonly<{ a: AgentInfo }>) {
  const h = agentHealth(a);
  if (!h) return <Dim>-</Dim>;
  const tone = healthTone(h.score), why = h.why.length ? h.why.join(" · ") : tx("relevés à l'heure, script à jour, machine reconnue");
  return (
    <span className="flex min-w-[8rem] items-center gap-2" title={why}>
      <span className="h-2.5 flex-1 overflow-hidden rounded-full border border-line bg-bg2"><span className={`block h-full ${FILL[tone]}`} style={{ width: `${h.score}%` }} /></span>
      <b className="w-[3ch] text-right font-mono text-xs tabular-nums">{h.score}</b>
    </span>
  );
}

const AgentVersion = ({ a }: Readonly<{ a: AgentInfo }>) => {
  if (!a.version) return <>-</>;
  return a.outdated ? <span className="inline-flex items-center gap-1" title={agentNews(a)}>v{a.version} → v{a.latest_version}<ArrowUpCircle size={13} className="text-warn" aria-hidden /></span> : <>v{a.version}<Check size={13} className="text-ok" aria-hidden /></>;
};


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

/** The gestures of an agent, as buttons: automatic update, update now, new command (a new token), revoke (with a confirmation). On the machine's
 *  page (its Access block) and on its row of Machines → Agents; the new command is shown by the caller (onInstall) */
function AgentActions({ a, kind, onChanged, onInstall }: Readonly<{ a: AgentInfo; kind: AgentKind; onChanged: () => void; onInstall: (t: InstallTarget) => void }>) {
  const [confirm, setConfirm] = useState<"" | "renew" | "revoke">(""), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string) => { setBusy(true); const ok = await act(fn, done, toHeader(setNote)); setBusy(false); if (ok) onChanged(); };
  return (
    <div className="flex flex-col items-end gap-1">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {confirm === "" && <>
            <button type="button" disabled={busy} aria-pressed={!!a.auto_update} aria-label={tx("Automatique")}
              title={a.auto_update ? tx("Mise à jour automatique activée : l'agent prend le nouveau script dès qu'il est plus ancien. Cliquer pour couper.") : tx("Activer la mise à jour automatique de cet agent")}
              onClick={() => void run(() => send("PATCH", `agents/${a.id}`, { auto_update: !a.auto_update }), a.auto_update ? tx("mise à jour automatique coupée") : tx("mise à jour automatique activée"))}
              className={`${iconBtn} ${a.auto_update ? "border-ok/60 bg-ok/15 text-ok" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}><RotateCw size={14} aria-hidden /></button>
            {(a.outdated || a.update_requested) && <button type="button" disabled={busy || !!a.update_requested} aria-label={tx("Mettre à jour maintenant")}
              title={a.update_requested ? tx("Demandée : l'agent se mettra à jour à son prochain relevé") : tx("Mettre à jour maintenant : l'agent récupère le nouveau script à son prochain relevé (au plus tard dans {0} min)", Math.round(a.interval / 60))}
              onClick={() => void run(() => send("POST", `agents/${a.id}/update`), tx("demandée : l'agent se mettra à jour à son prochain relevé"))}
              className={`${iconBtn} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`}><ArrowUpCircle size={14} aria-hidden /></button>}
            <button type="button" disabled={busy} aria-label={tx("Nouvelle commande")} title={tx("Crée un nouveau jeton et révoque l'ancien : à refaire sur le PC avec la nouvelle commande")}
              onClick={() => setConfirm("renew")} className={`${iconBtn} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`}><KeyRound size={14} aria-hidden /></button>
            <button type="button" aria-label={tx("Révoquer")} title={tx("Révoquer")} onClick={() => setConfirm("revoke")}
              className={`${iconBtn} border-bad/50 text-bad hover:bg-bad/10`}><Trash2 size={14} aria-hidden /></button>
          </>}
          {confirm !== "" && <>
            <span className="text-xs text-muted">{confirm === "renew" ? tx("L'ancien jeton cessera de marcher.") : tx("La machine n'enverra plus rien.")}</span>
            <button type="button" className={danger} onClick={() => {
              if (confirm === "renew") { setConfirm(""); onInstall({ ip: a.ip, name: a.name, kind: a.kind ?? kind, auto: true, sudo: !!a.rights?.length || !!a.gaps?.includes("sudo"), options: a.options }); }
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
function AgentRow({ a, conf, onChanged, lit }: Readonly<{ a: AgentInfo; conf?: MachineConf; onChanged: () => void; lit: boolean }>) {
  const [tone, label] = STATE[a.state], name = conf?.name ?? a.name;
  const [install, setInstall] = useState<InstallTarget | null>(null);
  return (
    <>
    <tr className={`border-t border-line/60 align-middle even:bg-bg/50 hover:bg-bg2/40 ${lit ? "ring-2 ring-inset ring-link/60" : ""}`}>
      <td className="px-3 py-2"><a href={`#machines/${a.ip}`} className="flex items-center gap-2 text-txt no-underline hover:text-link"><MachineIcon m={{ name, os: conf?.os ?? a.kind ?? "windows", osName: a.os }} reserve /><b className="truncate">{name}</b><Dim>{a.ip}</Dim></a></td>
      <td className="px-3 py-2 text-xs">{a.kind === "linux" ? "Linux" : "Windows"}</td>
      <td className="px-3 py-2"><span className="flex flex-wrap gap-1"><Badge tone={tone}>{label}</Badge>{a.host_pending && <Badge tone="warn">{tx("nom à confirmer")}</Badge>}</span></td>
      <td className="px-3 py-2 text-xs"><span className="inline-flex items-center gap-1"><AgentVersion a={a} /><AgentTodo a={a} ssh={typeof conf?.ssh === "string"} /></span></td>
      <td className="px-3 py-2"><AgentOptionBoxes a={a} /></td>
      <td className="px-3 py-2"><HealthBar a={a} /></td>
      <td className="px-3 py-2 text-xs text-dim">{a.last_seen ? dateTime(a.last_seen * 1000) : tx("en attente du premier relevé")}</td>
      <td className="px-3 py-2"><AgentActions a={a} kind={a.kind ?? "windows"} onChanged={onChanged} onInstall={setInstall} /></td>
    </tr>
    {install && <tr><td colSpan={8} className="border-t border-line/60 bg-bg/40 px-3 py-3"><AgentInstall target={install} onChanged={onChanged} onClose={() => setInstall(null)} /></td></tr>}
    </>
  );
}

/** Machines → Agents: every agent in use with its gestures (the same block as on the machine's page), figures on top, one button to update
 *  the late ones, then the revoked ones. An agent is installed from the page of its machine, Access tab. */
export function AgentsOverview({ machines, open }: Readonly<{ machines: Record<string, MachineConf>; open?: string }>) {
  const [st, setSt] = useState<AgentsState | null>(null);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const reload = useCallback(() => { read<AgentsState>("agents").then(setSt).catch(() => undefined); }, []);
  useEffect(reload, [reload]);
  const [hours, setHours] = usePeriod(), s = agentSummary(st?.agents ?? []);
  const hist = useAgentsHistory(hours, `${s.active}.${s.outdated.length}`), now = Math.floor(Date.now() / 1000), ratio = (p: TilePoint) => `${p[1]}/${p[2]}`, late = (p: TilePoint) => p[2] - p[1];
  if (open === "new") return <NewAgentPage machines={machines} />;
  if (!st) return <Loading />;
  const scores = s.live.map((a) => agentHealth(a)?.score ?? 0), avg = scores.length ? Math.round(scores.reduce((t, n) => t + n, 0) / scores.length) : null;
  const updateLate = async () => {
    setBusy(true);
    await act(() => Promise.all(s.outdated.map((a) => send("POST", `agents/${a.id}/update`))), tx("demandée pour {0} agent(s) : chacun se met à jour à son prochain relevé", s.outdated.length), toHeader(setNote));
    setBusy(false);
    reload();
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHead icon={MonitorUp} title={tx("Agents")} tags={<span className="flex flex-wrap items-center gap-1.5 text-sm"><Badge tone="info" outline>{tx("{0} agent(s)", s.live.length)}</Badge><Badge tone="ok" outline>{tx("{0} actif(s)", s.active)}</Badge></span>}
        actions={<>
          <a href="#settings/machines/agents/new" className={`${primary} py-1 no-underline`}><Plus size={14} aria-hidden />{tx("Agent")}</a>
          <PeriodSwitch value={hours} onChange={setHours} />
          {s.outdated.length > 0 && <button type="button" className={`${primary} nudge`} disabled={busy} onClick={() => void updateLate()}><ArrowUpCircle size={14} aria-hidden />{tx("Mettre à jour les agents en retard ({0})", s.outdated.length)}</button>}
        </>} />
      <div className="flex flex-wrap gap-2.5 pb-1">
        <HistoryTile n={s.active} label={tx("Actifs")} tone="ok" kind="curve" points={hist?.running ?? null} hours={hours} now={now} figure={(p) => p[1]} fmt={ratio} goodHigh />
        <HistoryTile n={avg ?? "-"} label={tx("Santé des agents")} tone={avg == null ? undefined : healthTone(avg)} fact={tx("moyenne sur 100")} scale={100} kind="curve" points={hist?.health ?? null} hours={hours} now={now} figure={(p) => p[1]} fmt={(p) => `${p[1]} / 100`} goodHigh />
        <StatTile n={s.silent} label={tx("Silencieux")} tone={s.silent ? "warn" : undefined} />
        <StatTile n={s.pending} label={tx("En attente")} />
        <StatTile n={s.rights} label={tx("Droits à compléter")} tone={s.rights ? "warn" : undefined} />
        <HistoryTile n={s.outdated.length} label={tx("À mettre à jour")} tone={s.outdated.length ? "warn" : undefined} kind="strip" points={hist?.late ?? null} hours={hours} now={now} figure={late} fmt={(p) => tx("{0} à mettre à jour", late(p))} goodHigh={false} />
      </div>
      <FoldPanel id="agents-list" icon={MonitorUp} title={tx("Agents")} count={s.live.length} pinned>
        <InfoNote>{tx("Un agent s'installe depuis la page d'une machine, onglet Accès. Ses gestes sont sur sa ligne : mise à jour automatique ou immédiate, nouveau jeton, révocation.")}</InfoNote>
        <NoteLine note={note} />
        {s.live.length === 0 && <p className="mt-2 text-sm text-dim">{tx("Aucun agent installé : le SSH lit déjà vos machines, ou aucun PC n'en a besoin.")}</p>}
        {s.live.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
                <th className="px-3 py-2">{tx("Machine")}</th><th className="px-3 py-2">{tx("Type")}</th><th className="px-3 py-2">{tx("État")}</th>
                <th className="px-3 py-2">{tx("Version")}</th><th className="px-3 py-2">{tx("Options")}</th><th className="px-3 py-2">{tx("Santé")}</th><th className="px-3 py-2">{tx("Dernier relevé")}</th><th className="px-3 py-2" />
              </tr></thead>
              {/* keyed by machine: a new command gives the agent a new id, and the row must keep the frame showing that command */}
              <tbody>{s.live.map((a) => <AgentRow key={a.ip} a={a} conf={machines[a.ip]} onChanged={reload} lit={open === a.ip} />)}</tbody>
            </table>
          </div>
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
