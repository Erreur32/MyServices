// Gestion des agents MyServices (petit script en lecture seule, sans SSH) : le bloc d'une machine (sa page, onglet Accès) et la page
// Machines → Agents (tous les agents avec leurs gestes, agents révoqués). Un agent = un jeton lié à la machine, montré une seule fois avec la commande à coller.
// Gérés seulement depuis une session admin.
import { ArrowUpCircle, Check, MonitorUp, Plus, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { read, send } from "../api";
import { NoteLine } from "../components/form";
import { MachineIcon } from "../components/MachineIcon";
import { AgentInstall, type AgentKind, type InstallTarget } from "../components/AgentInstall";
import { act, danger, quiet, type Note } from "../lib/forms";
import { Badge, Card, Count, Dim, Loading } from "../components/ui";
import { StatTile } from "../components/StatTile";
import { agentSummary } from "../lib/accessLists";
import { dateTime } from "../lib/format";
import type { AgentInfo, AgentsState, MachineConf } from "../types";
import { tx } from "../lib/i18n";
import { InfoNote } from "../components/InfoNote";

const STATE: Record<AgentInfo["state"], ["ok" | "warn" | "info" | "off", string]> = {
  actif: ["ok", tx("actif")],
  silencieux: ["warn", tx("silencieux")],
  "en attente": ["info", tx("en attente du premier relevé")],
  révoqué: ["off", tx("révoqué")],
};

const iconBtn = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border disabled:opacity-40";

const VersionMark = ({ outdated }: Readonly<{ outdated: boolean }>) => outdated
  ? <ArrowUpCircle size={13} className="text-warn" aria-hidden />
  : <Check size={13} className="text-ok" aria-hidden />;


/** Groupe de cartes : titre, compte, texte d'aide et grille ; absent quand il est vide */
function Group({ title, n, hint, children }: Readonly<{ title: string; n: number; hint?: string; children: React.ReactNode }>) {
  if (n === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-bold">{title} <Dim>· {n}</Dim></h3>
      {hint && <InfoNote className="mb-2">{hint}</InfoNote>}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>
    </section>
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
export function AgentBlock({ ip, name, kind, agent, onChanged }: Readonly<{ ip: string; name: string; kind: AgentKind; agent?: AgentInfo; onChanged: () => void }>) {
  const [confirm, setConfirm] = useState<"" | "renew" | "revoke">(""), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const [install, setInstall] = useState<InstallTarget | null>(null);
  const run = async (fn: () => Promise<unknown>, done: string) => { setBusy(true); const ok = await act(fn, done, setNote); setBusy(false); if (ok) onChanged(); };
  if (install) return <AgentInstall key={install.auto ? "renew" : "new"} target={install} onChanged={onChanged} onClose={() => setInstall(null)} />;
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
    <div className="flex flex-col gap-2 rounded-lg border border-line/60 bg-bg2/70 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b>{tx("Agent")}</b><Badge tone={tone}>{label}</Badge>
        {agent.host_pending && <Badge tone="warn" title={tx("Nom de poste différent : {0} au lieu de {1}", agent.host_pending, agent.hostname ?? "?")}>{tx("nom à confirmer")}</Badge>}
        <span className="inline-flex items-center gap-1 text-xs" title={agent.outdated ? tx("Agent v{0} : la v{1} est disponible", agent.version ?? "?", agent.latest_version ?? "?") : undefined}>
          {agent.version ? <>v{agent.version}<VersionMark outdated={!!agent.outdated} /></> : "-"}
        </span>
        <Dim>{agent.last_seen ? tx("dernier relevé {0}", dateTime(agent.last_seen * 1000)) : tx("en attente du premier relevé")} · {tx("toutes les {0} min", Math.round(agent.interval / 60))}</Dim>
        <code className="font-mono text-xs text-dim" title={tx("Jeton")}>{tx("msv_")}agent_…{agent.hint}</code>
      </div>
      {agent.host_pending && <HostConfirm a={agent} reload={onChanged} setNote={setNote} />}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {confirm === "" && <>
          <button type="button" disabled={busy} aria-pressed={!!agent.auto_update} aria-label={tx("Automatique")}
            title={agent.auto_update ? tx("Mise à jour automatique activée : l'agent prend le nouveau script dès qu'il est plus ancien. Cliquer pour couper.") : tx("Activer la mise à jour automatique de cet agent")}
            onClick={() => void run(() => send("PATCH", `agents/${agent.id}`, { auto_update: !agent.auto_update }), agent.auto_update ? tx("mise à jour automatique coupée") : tx("mise à jour automatique activée"))}
            className={`${iconBtn} ${agent.auto_update ? "border-ok/60 bg-ok/15 text-ok" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}><RotateCw size={14} aria-hidden /></button>
          {(agent.outdated || agent.update_requested) && <button type="button" disabled={busy || !!agent.update_requested} aria-label={tx("Mettre à jour maintenant")}
            title={agent.update_requested ? tx("Demandée : l'agent se mettra à jour à son prochain relevé") : tx("Mettre à jour maintenant : l'agent récupère le nouveau script à son prochain relevé (au plus tard dans {0} min)", Math.round(agent.interval / 60))}
            onClick={() => void run(() => send("POST", `agents/${agent.id}/update`), tx("demandée : l'agent se mettra à jour à son prochain relevé"))}
            className={`${iconBtn} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`}><ArrowUpCircle size={14} aria-hidden /></button>}
          <button type="button" disabled={busy} aria-label={tx("Nouvelle commande")} title={tx("Crée un nouveau jeton et révoque l'ancien : à refaire sur le PC avec la nouvelle commande")}
            onClick={() => setConfirm("renew")} className={`${iconBtn} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`}><RefreshCw size={14} aria-hidden /></button>
          <button type="button" aria-label={tx("Révoquer")} title={tx("Révoquer")} onClick={() => setConfirm("revoke")}
            className={`${iconBtn} border-bad/50 text-bad hover:bg-bad/10`}><Trash2 size={14} aria-hidden /></button>
        </>}
        {confirm !== "" && <>
          <span className="text-xs text-muted">{confirm === "renew" ? tx("L'ancien jeton cessera de marcher.") : tx("La machine n'enverra plus rien.")}</span>
          <button type="button" className={danger} onClick={() => {
            if (confirm === "renew") { setConfirm(""); setInstall({ ip, name, kind: agent.kind ?? kind, auto: true }); }
            else void act(() => send("DELETE", `agents/${agent.id}`), tx("révoqué"), setNote).then((ok) => ok && onChanged());
          }}>{tx("Confirmer")}</button>
          <button type="button" className={quiet} onClick={() => setConfirm("")}>{tx("Annuler")}</button>
        </>}
      </div>
      <NoteLine note={note} />
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
      <div className="mt-3 rounded-lg border border-link/50 bg-link/5 px-3 py-2 text-sm text-muted">
        <b className="text-txt">{tx("Lequel choisir ?")}</b>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li><b className="text-txt">{tx("Machine Linux que vous administrez")}</b> {tx(": le SSH suffit. Un agent n'y sert que de filet de sécurité (si le SSH ne répond plus, l'agent prend le relais).")}</li>
          <li><b className="text-txt">{tx("Machine où le SSH est impossible")}</b> {tx("(clé refusée, port fermé, NAT, VPN) : l'agent, Windows ou Linux.")}</li>
          <li><b className="text-txt">{tx("Box, passerelle, appli")}</b> {tx("(Freebox, UniFi, Home Assistant…) : le connecteur, pas d'agent.")}</li>
        </ul>
        <InfoNote className="mt-1">{tx("SSH, agent et connecteurs peuvent tourner ensemble sur une même machine : la première source qui répond fait foi, les autres complètent.")}</InfoNote>
        <InfoNote className="mt-1">{tx("Chaque machine se règle dans sa fenêtre, onglet Accès.")}</InfoNote>
      </div>
    </div>
  );
}

/** Vue d'ensemble, en bas de Réglages → Machines : comment choisir entre agent, SSH et connecteur, et les agents révoqués */
/** One agent in the list of Machines → Agents: its machine, type, state, version and last report; « Régler » opens its own page */
function AgentRow({ a, conf }: Readonly<{ a: AgentInfo; conf?: MachineConf }>) {
  const [tone, label] = STATE[a.state], name = conf?.name ?? a.name;
  return (
    <tr className="border-t border-line/60 align-middle even:bg-bg/50 hover:bg-bg2/40">
      <td className="px-3 py-2"><span className="flex items-center gap-2"><MachineIcon m={{ name, os: conf?.os ?? a.kind ?? "windows", osName: a.os }} reserve /><b className="truncate">{name}</b><Dim>{a.ip}</Dim></span></td>
      <td className="px-3 py-2 text-xs">{a.kind === "linux" ? "Linux" : "Windows"}</td>
      <td className="px-3 py-2"><span className="flex flex-wrap gap-1"><Badge tone={tone}>{label}</Badge>{a.host_pending && <Badge tone="warn">{tx("nom à confirmer")}</Badge>}</span></td>
      <td className="px-3 py-2 text-xs"><span className="inline-flex items-center gap-1">{a.version ? <>v{a.version}<VersionMark outdated={!!a.outdated} /></> : "-"}</span></td>
      <td className="px-3 py-2 text-xs text-dim">{a.last_seen ? dateTime(a.last_seen * 1000) : tx("en attente du premier relevé")}</td>
      <td className="px-3 py-2 text-right"><a href={`#settings/machines/agents/${a.ip}`} className="text-xs text-link hover:underline">{tx("Régler")} ›</a></td>
    </tr>
  );
}

/** Machines → Agents: every agent in use with its gestures (the same block as on the machine's page), figures on top, one button to update
 *  the late ones, then the revoked ones. An agent is installed from the page of its machine, Access tab. */
export function AgentsOverview({ machines }: Readonly<{ machines: Record<string, MachineConf> }>) {
  const [st, setSt] = useState<AgentsState | null>(null), [install, setInstall] = useState<InstallTarget | null>(null);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const reload = useCallback(() => { read<AgentsState>("agents").then(setSt).catch(() => undefined); }, []);
  useEffect(reload, [reload]);
  if (!st) return <Loading />;
  const s = agentSummary(st.agents);
  const updateLate = async () => {
    setBusy(true);
    await act(() => Promise.all(s.outdated.map((a) => send("POST", `agents/${a.id}/update`))), tx("demandée pour {0} agent(s) : chacun se met à jour à son prochain relevé", s.outdated.length), setNote);
    setBusy(false);
    reload();
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        <StatTile n={s.active} label={tx("Actifs")} tone="ok" />
        <StatTile n={s.silent} label={tx("Silencieux")} tone={s.silent ? "warn" : undefined} />
        <StatTile n={s.pending} label={tx("En attente")} />
        <StatTile n={s.outdated.length} label={tx("À mettre à jour")} tone={s.outdated.length ? "warn" : undefined} />
      </div>
      {install && <AgentInstall key={`${install.ip}-auto`} target={install} onChanged={reload} onClose={() => setInstall(null)} />}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold"><MonitorUp size={16} aria-hidden />{tx("Agents")} <Count n={s.live.length} /></h2>
          {s.outdated.length > 0 && <button type="button" className={quiet} disabled={busy} onClick={() => void updateLate()}><ArrowUpCircle size={14} aria-hidden />{tx("Mettre à jour les agents en retard ({0})", s.outdated.length)}</button>}
        </div>
        <InfoNote className="mt-2">{tx("Un agent s'installe depuis la page d'une machine, onglet Accès. « Régler » ouvre ses gestes : mise à jour automatique ou immédiate, nouveau jeton, révocation.")}</InfoNote>
        <NoteLine note={note} />
        {s.live.length === 0 && <p className="mt-2 text-sm text-dim">{tx("Aucun agent installé : le SSH lit déjà vos machines, ou aucun PC n'en a besoin.")}</p>}
        {s.live.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
                <th className="px-3 py-2">{tx("Machine")}</th><th className="px-3 py-2">{tx("Type")}</th><th className="px-3 py-2">{tx("État")}</th>
                <th className="px-3 py-2">{tx("Version")}</th><th className="px-3 py-2">{tx("Dernier relevé")}</th><th className="px-3 py-2" />
              </tr></thead>
              <tbody>{s.live.map((a) => <AgentRow key={a.id} a={a} conf={machines[a.ip]} />)}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Group title={tx("Agents révoqués")} n={s.revoked.length}
        hint={tx("Leur jeton ne marche plus. « Nouvel agent » en crée un autre pour ce PC ; « Supprimer » les retire de la liste pour de bon.")}>
        {s.revoked.map((a) => <RevokedCard key={a.id} a={a} conf={machines[a.ip]} ip={a.ip} busy={install?.ip === a.ip && !!install.auto}
          onNew={() => setInstall({ ip: a.ip, name: machines[a.ip]?.name ?? a.name, kind: a.kind ?? "windows", auto: true })} reload={reload} />)}
      </Group>
    </div>
  );
}

/** Carte d'un agent révoqué : qui, quand, et deux gestes : en recréer un pour ce PC, ou l'effacer de la liste (confirmation) */
function RevokedCard({ a, conf, ip, busy, onNew, reload }: { a: AgentInfo; conf?: MachineConf; ip: string; busy: boolean; onNew?: () => void; reload: () => void }) {
  const [confirm, setConfirm] = useState(false), [note, setNote] = useState<Note>(null);
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
      <div className="flex flex-wrap items-center gap-1.5">
        {!confirm && <>
          {onNew && <button type="button" className={quiet} disabled={busy} onClick={onNew}><Plus size={14} />{tx("Nouvel agent")}</button>}
          <button type="button" className={`${danger} ml-auto`} onClick={() => setConfirm(true)}><Trash2 size={14} />{tx("Supprimer")}</button>
        </>}
        {confirm && <>
          <span className="text-xs text-muted">{tx("Retiré de la liste pour de bon.")}</span>
          <button type="button" className={`${danger} ml-auto`} onClick={() => void act(() => send("DELETE", `agents/${a.id}/purge`), tx("supprimé"), setNote).then((ok) => ok && reload())}>{tx("Confirmer")}</button>
          <button type="button" className={quiet} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
        </>}
      </div>
      <NoteLine note={note} />
    </li>
  );
}
