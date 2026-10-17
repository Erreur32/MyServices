// Réglages → Connecteurs → SSH & Agents : comment chaque machine est lue. Agent : une machine envoie elle-même sa santé (petit script PowerShell en lecture seule), sans SSH.
// Une carte par machine : celles qui ont un agent (actif, silencieux, en attente) d'un côté, celles qui n'en ont pas de l'autre,
// prêtes à être cliquées. Un agent = un jeton lié à la machine, montré une seule fois avec la commande à coller sur le PC.
// Gérés seulement depuis une session admin.
import { shortOs } from "../lib/osName";
import { ArrowUpCircle, Check, ChevronDown, ChevronRight, MonitorUp, Plus, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { NoteLine } from "../components/form";
import { MachineIcon } from "../components/MachineIcon";
import { MachineAccess } from "../components/MachineAccess";
import { AgentInstall, type AgentKind, type InstallTarget } from "../components/AgentInstall";
import { isWindowsMachine } from "../lib/machines";
import { focusConnector } from "../lib/connectorPrefill";
import { act, danger, quiet, type Note } from "../lib/forms";
import { Badge, Card, Count, Dim } from "../components/ui";
import { dateTime, ipNum } from "../lib/format";
import type { AgentInfo, AgentsState, Connector, Machine, MachineConf, MachinesSettings, NetworkConnector } from "../types";
import { freeboxOf } from "../lib/freebox";
import { MSTATE, mState } from "../lib/machines";
import { usePoll } from "../lib/polling";
import { tx } from "../lib/i18n";

const STATE: Record<AgentInfo["state"], ["ok" | "warn" | "info" | "off", string]> = {
  actif: ["ok", tx("actif")],
  silencieux: ["warn", tx("silencieux")],
  "en attente": ["info", tx("en attente du premier relevé")],
  révoqué: ["off", tx("révoqué")],
};

/** Icônes de matériel fermé (box, onduleur…) : on n'y installe rien, donc jamais d'agent proposé */
const APPLIANCE_ICONS = new Set(["freebox", "free", "nut"]);

export function Agents({ focusIp, live, network = [], statuses = [] }: Readonly<{ focusIp?: string; live: Machine[]; network?: NetworkConnector[]; statuses?: Connector[] }>) {
  const [st, setSt] = useState<AgentsState | null>(null);
  const [machines, setMachines] = useState<MachinesSettings["machines"]>({});
  const [mst, setMst] = useState<MachinesSettings | null>(null);   // réglages complets (accès SSH connus, services hors Docker) pour le panneau d'accès
  const [access, setAccess] = useState<string | null>(null);   // machine dont l'accès SSH est ouvert
  const [error, setError] = useState("");
  const [install, setInstall] = useState<InstallTarget | null>(null);   // agent en cours d'installation (le composant partagé gère le reste)
  const reload = useCallback(() => {
    read<AgentsState>("agents")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);
  useEffect(() => { read<MachinesSettings>("machines/settings").then((m) => { setMachines(m.machines); setMst(m); }).catch(() => undefined); }, []);
  const reloadAccess = useCallback(() => { read<MachinesSettings>("machines/settings").then((m) => { setMachines(m.machines); setMst(m); }).catch(() => undefined); }, []);
  useEffect(() => { if (focusIp && mst?.machines[focusIp] && !st?.agents.some((a) => a.ip === focusIp && a.state !== "révoqué")) setAccess(focusIp); }, [focusIp, mst, st]);
  // Rafraîchissement automatique : toutes les 5 s tant qu'un premier relevé est attendu (l'installation se voit aboutir), sinon toutes les 10 s ;
  // à l'arrêt quand l'onglet du navigateur est caché. Les cartes « Linux, lus par SSH » suivent l'état de la collecte (snapshot de l'application).
  const waiting = !!st?.agents.some((a) => a.state === "en attente");
  usePoll(reload, waiting ? 5000 : 30_000, false);
  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;

  const byIp = new Map(st.agents.filter((a) => a.state !== "révoqué").map((a) => [a.ip, a]));
  const revoked = st.agents.filter((a) => a.state === "révoqué");
  const sorted = (ips: string[]) => ips.sort((a, b) => ipNum(a) - ipNum(b));
  const liveBy = new Map(live.map((m) => [m.ip, m]));
  // Deux agents : script PowerShell (Windows) ou Python (Linux). Windows = réglage « windows » ou système probable (TTL, scan) ; le reste
  // est proposé en Linux. Une machine Linux avec SSH se lit déjà par SSH ; sans SSH ni API, l'agent Linux est la voie.
  const isWindows = (ip: string) => isWindowsMachine(machines[ip], liveBy.get(ip), byIp.has(ip));
  const tracked = Object.keys(machines).filter((ip) => !byIp.has(ip) && !machines[ip].disabled);
  const withAgent = sorted([...byIp.keys()]);
  // Même état que l'onglet Machines (mState) : « api » = déjà lue par l'API d'un connecteur (Home Assistant…), sans SSH, rien à régler
  const stateOf = (ip: string) => { const lm = liveBy.get(ip); return lm ? mState(lm) : null; };
  const badge = (ip: string) => { const st = stateOf(ip); if (!st) return null; const [tone, label, tip] = MSTATE[st]; return <Badge tone={tone} title={tip}>{label}</Badge>; };
  // SSH réel : réglé sur la machine, ou trouvé par la collecte (alias de ~/.ssh/config pour cette adresse), comme le badge « SSH OK »
  const sshAlias = (ip: string) => machines[ip].ssh === false ? "" : machines[ip].ssh || liveBy.get(ip)?.ssh?.alias || "";   // coupé à la main : pas de SSH
  const byApi = sorted(tracked.filter((ip) => !sshAlias(ip) && (stateOf(ip) === "api" || stateOf(ip) === "network" || APPLIANCE_ICONS.has(liveBy.get(ip)?.icon ?? ""))));      // lues par une API ou un outil réseau (box, passerelle), sans SSH : aucun agent possible
  const without = sorted(tracked.filter((ip) => !sshAlias(ip) && !byApi.includes(ip)));   // sans agent, sans SSH, sans API : agent Windows ou Linux
  const ssh = sorted(tracked.filter((ip) => !isWindows(ip) && !!sshAlias(ip)));               // Linux lus par SSH
  const kindOf = (ip: string): AgentKind => (isWindows(ip) ? "windows" : "linux");
  const nameOf = (ip: string) => machines[ip]?.name ?? ip;
  return (
    <div className="flex flex-col gap-7">
      <Card>
        <h2 className="flex items-center gap-2 font-bold"><MonitorUp size={16} />{tx("Accès aux machines")} <Count n={withAgent.length} /><Dim>{tx("agents")}</Dim><Count n={ssh.length} /><Dim>SSH</Dim></h2>
        <p className="mt-1 text-sm text-muted">
          {tx("Deux façons de lire la santé d'une machine, toujours en lecture seule.")} <b className="text-txt">{tx("Agent")}</b> {tx(": un petit script (PowerShell sur un PC Windows, Python sur une machine Linux), installé sur la machine, qui envoie lui-même sa santé à MyServices (disques, services, processeur, mémoire, mises à jour, journal) ; pas de SSH à ouvrir, et un PC souvent éteint se signale dès qu'il se rallume.")}{" "}
          <b className="text-txt">SSH</b> {tx(": pour les machines Linux, MyServices s'y connecte avec sa clé (santé, Docker, services en écoute).")}
        </p>
        <div className="mt-3 rounded-lg border border-link/50 bg-link/5 px-3 py-2 text-sm text-muted">
          <b className="text-txt">{tx("Lequel choisir ?")}</b>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li><b className="text-txt">{tx("Machine Linux que vous administrez")}</b> {tx(": le SSH suffit. Un agent n'y sert que de filet de sécurité (si le SSH ne répond plus, l'agent prend le relais).")}</li>
            <li><b className="text-txt">{tx("Machine où le SSH est impossible")}</b> {tx("(clé refusée, port fermé, NAT, VPN) : l'agent, Windows ou Linux.")}</li>
            <li><b className="text-txt">{tx("Box, passerelle, appli")}</b> {tx("(Freebox, UniFi, Home Assistant…) : le connecteur, pas d'agent.")}</li>
          </ul>
          <p className="mt-1 text-xs text-dim">{tx("SSH, agent et connecteurs peuvent tourner ensemble sur une même machine : la première source qui répond fait foi, les autres complètent.")}</p>
        </div>
      </Card>

      {install && <AgentInstall key={`${install.ip}-${install.auto ? "auto" : "pick"}`} target={install} onChanged={reload} onClose={() => setInstall(null)}
        onSsh={() => { setAccess(install.ip); setInstall(null); }} />}

      {access && mst?.machines[access] && (
        <MachineAccess key={access} ip={access} conf={mst.machines[access]} st={mst} live={liveBy.get(access)} agent={byIp.get(access)} windowsGuess={isWindows(access)}
          statuses={statuses.filter((c) => ["docker", "process", "adguard"].includes(c.type) && (c.ip ? c.ip === access : c.name === access || c.name === liveBy.get(access)?.name))}
          onDone={reloadAccess} onClose={() => setAccess(null)} />
      )}

      <Group title={tx("Avec un agent")} n={withAgent.length} fold rows>
        {withAgent.map((ip) => <ActiveCard key={ip} a={byIp.get(ip)!} conf={machines[ip]} ip={ip} focus={ip === focusIp} busy={install?.ip === ip && !!install.auto} onRenew={() => setInstall({ ip, name: nameOf(ip), kind: byIp.get(ip)?.kind ?? kindOf(ip), auto: true })} reload={reload} />)}
      </Group>

      <Group title={tx("Sans agent")} fold n={without.length}
        hint={tx("Cliquez sur une machine pour préparer son agent : rien n'est créé avant que vous confirmiez.")}>
        {without.map((ip) => (
          <li key={ip}>
            <button type="button" onClick={() => setInstall(install?.ip === ip ? null : { ip, name: nameOf(ip), kind: kindOf(ip), choose: true })} aria-pressed={install?.ip === ip}
              className={`flex h-full w-full items-center gap-3 rounded-xl border bg-bg2 p-3 text-left transition-colors hover:border-link hover:bg-link/10 disabled:opacity-60 ${install?.ip === ip || ip === focusIp ? "border-link bg-link/10 ring-1 ring-link" : "border-dim/50"}`}>
              <MachineIcon m={{ role: liveBy.get(ip)?.role, icon: liveBy.get(ip)?.icon, name: machines[ip].name, os: machines[ip].os, osName: liveBy.get(ip)?.agent?.os }} reserve />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm text-txt">{machines[ip].name}</b>
                <span className="block truncate text-xs text-dim">{ip}{machines[ip].off ? ` · ${tx("souvent éteinte")}` : ""}</span>
              </span>
              {badge(ip)}
              <Plus size={15} className="shrink-0 text-dim" aria-hidden />
            </button>
          </li>
        ))}
      </Group>

      <Group title={tx("Linux, lus par SSH")} fold n={ssh.length}
        hint={tx("Cliquez sur une carte pour régler son accès SSH (interrupteur, clé, ce qui est lu).")}>
        {ssh.map((ip) => {
          const lm = liveBy.get(ip);
          return (
            <li key={ip} className="flex items-center gap-2">
              <button type="button" onClick={() => { setAccess(access === ip ? null : ip); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-pressed={access === ip}
                className={`flex h-full min-w-0 flex-1 items-center gap-3 rounded-xl border bg-bg2 p-3 text-left transition-colors hover:border-link hover:bg-link/10 ${access === ip ? "border-link bg-link/10" : "border-dim/50"}`}>
                <MachineIcon m={{ role: liveBy.get(ip)?.role, icon: liveBy.get(ip)?.icon, name: machines[ip].name, os: machines[ip].os, info: lm?.info, ttl: lm?.ttl, osName: lm?.info?.os ?? lm?.agent?.os }} reserve />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm text-txt">{machines[ip].name}</b>
                  <span className="block truncate text-xs text-dim">{ip} · SSH {sshAlias(ip)}{!machines[ip].ssh && ` · ${tx("activé tout seul au prochain passage")}`}</span>
                </span>
                {badge(ip)}
              </button>
              <button type="button" className={quiet} title={tx("Préparer un agent Linux pour cette machine, à la place du SSH")}
                onClick={() => { setInstall({ ip, name: nameOf(ip), kind: "linux", choose: true }); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Plus size={14} />{tx("Agent")}</button>
            </li>
          );
        })}
      </Group>

      <Group title={tx("Lues par leur API ou un outil réseau, sans SSH")} fold n={byApi.length}
        hint={tx("Déjà suivies par l'API d'un connecteur (Home Assistant…) ou un outil réseau (box, passerelle) : rien à régler, et pas d'agent possible.")}>
        {byApi.map((ip) => {
          const lm = liveBy.get(ip), list = lm?.api ?? [];
          // Connecteurs qui lisent la machine : ceux de l'API (Home Assistant…) puis les outils réseau rapprochés (MynetworK) ; chacun mène à sa carte
          const via = new Map<string, { type: string; name: string; label: string }>();
          for (const a of list) via.set(`${a.type}/${a.name}`, { type: a.type, name: a.name, label: a.label });
          for (const x of lm?.links?.sources ?? []) if (x.ok !== false && !via.has(`${x.source}/${x.instance}`)) via.set(`${x.source}/${x.instance}`, { type: x.source, name: x.instance, label: x.label });
          // La Freebox n'a pas d'adresse chez MynetworK : elle est reconnue par son nom (freeboxOf), comme dans l'onglet Machines
          const fbOf = lm && freeboxOf(lm, network) && network.find((c) => c.freebox?.system);
          if (fbOf && !via.has(`${fbOf.connector}/${fbOf.name}`)) via.set(`${fbOf.connector}/${fbOf.name}`, { type: fbOf.connector, name: fbOf.name, label: fbOf.label });
          return (
            <li key={ip} className="flex h-full flex-wrap items-center gap-3 rounded-xl border border-dim/50 bg-bg2 p-3" title={list.map((a) => `${a.label} (${a.name}) : ${a.message ?? ""}`).join("\n") || undefined}>
              <MachineIcon m={{ role: liveBy.get(ip)?.role, icon: liveBy.get(ip)?.icon, name: machines[ip].name, os: machines[ip].os, info: lm?.info, ttl: lm?.ttl, osName: lm?.info?.os ?? lm?.agent?.os }} reserve />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm text-txt">{machines[ip].name}</b>
                <span className="flex flex-wrap items-center gap-1 text-xs text-dim">{ip} ·
                  {[...via.values()].map((c) => (
                    <a key={`${c.type}/${c.name}`} href="#settings/connectors" onClick={() => focusConnector(c.type, c.name)} title={tx("Ouvrir ce connecteur")}
                      className="rounded-full border border-link/60 px-2 py-0.5 font-semibold text-link hover:bg-link/10">{c.label}</a>
                  ))}
                  {via.size === 0 && <a href="#settings/connectors" className="rounded-full border border-link/60 px-2 py-0.5 font-semibold text-link hover:bg-link/10">{tx("outil réseau")}</a>}
                </span>
              </span>
              {badge(ip)}
            </li>
          );
        })}
      </Group>

      <Group title={tx("Agents révoqués")} n={revoked.length} fold folded
        hint={tx("Leur jeton ne marche plus. « Nouvel agent » en crée un autre pour ce PC ; « Supprimer » les retire de la liste pour de bon.")}>
        {revoked.map((a) => <RevokedCard key={a.id} a={a} conf={machines[a.ip]} ip={a.ip} busy={install?.ip === a.ip && !!install.auto}
          onNew={() => setInstall({ ip: a.ip, name: nameOf(a.ip), kind: a.kind ?? kindOf(a.ip), auto: true })} reload={reload} />)}
      </Group>
    </div>
  );
}

/** Groupe de cartes : titre, compte, texte d'aide, grille (ou le texte « vide ») ; pliable (chevron, comme « Agent créé ») si fold */
function Group({ title, n, hint, fold, folded, rows, children }: Readonly<{ title: string; n: number; hint?: string; fold?: boolean; folded?: boolean; rows?: boolean; children: React.ReactNode }>) {
  const [choice, setChoice] = useState<boolean | null>(null);  // null : pas touché, donc ouvert s'il y a des cartes, replié s'il est vide
  const open = choice ?? (n > 0 && !folded);  // folded : replié d'office même s'il a des cartes (agents révoqués)
  const shown = !fold || open;
  if (n === 0) return null;   // catégorie vide : pas affichée
  return (
    <section aria-label={title}>
      <h3 className="mb-2 px-1 text-sm font-bold">
        {fold ? (
          <button type="button" onClick={() => setChoice(!open)} aria-expanded={open} className="flex items-center gap-2 text-left">
            {open ? <ChevronDown size={16} className="shrink-0 text-txt" aria-hidden /> : <ChevronRight size={16} className="shrink-0 text-txt" aria-hidden />}
            {title} <Dim>· {n}</Dim>
          </button>
        ) : <span className="flex items-center gap-2">{title} <Dim>· {n}</Dim></span>}
      </h3>
      {shown && hint && n > 0 && <p className="mb-2 px-1 text-xs text-dim">{hint}</p>}
      {shown && <ul className={rows ? "flex flex-col gap-2" : "grid gap-2 sm:grid-cols-2 lg:grid-cols-3"}>{children}</ul>}   {/* rows : une ligne par élément */}
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

const iconBtn = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border disabled:opacity-40";

/** Une machine qui a un agent, sur une seule ligne (elle passe à la ligne sur un petit écran) : nom, IP, système, nom du poste, version,
 *  dernier relevé, fréquence, jeton, état, puis des boutons-icônes : mise à jour automatique, mettre à jour maintenant, nouvelle commande, révoquer.
 *  Mise à jour : l'agent vient chercher le nouveau script à son prochain relevé (au plus tard dans son intervalle), rien n'est poussé vers le PC. */
const VersionMark = ({ outdated }: Readonly<{ outdated: boolean }>) => outdated
  ? <ArrowUpCircle size={13} className="text-warn" aria-hidden />
  : <Check size={13} className="text-ok" aria-hidden />;

function ActiveCard({ a, conf, ip, focus, busy, onRenew, reload }: {
  a: AgentInfo; conf?: MachineConf; ip: string; focus: boolean; busy: boolean; onRenew?: () => void; reload: () => void;
}) {
  const [confirm, setConfirm] = useState<"" | "renew" | "revoke">(""), [note, setNote] = useState<Note>(null), [upBusy, setUpBusy] = useState(false);
  const [tone, label] = STATE[a.state];
  const run = async (fn: () => Promise<unknown>, done: string) => { setUpBusy(true); const ok = await act(fn, done, setNote); setUpBusy(false); if (ok) reload(); };
  const attention = a.state !== "actif" || !!a.host_pending;
  return (
    <li className={`rounded-xl border bg-card px-3 py-2 text-sm ${focus || attention ? "border-link ring-1 ring-link" : "border-dim/50"}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 lg:grid lg:grid-cols-[minmax(13rem,1.6fr)_11rem_7rem_4.5rem_9.5rem_7.5rem_8rem_7.5rem_10rem] lg:gap-x-3">
        <span className="flex min-w-[12rem] flex-1 items-center gap-2 lg:flex-none">
          <MachineIcon m={{ name: conf?.name ?? a.name, os: conf?.os ?? a.kind ?? "windows", osName: a.os }} reserve />
          <b className="truncate">{conf?.name ?? a.name}</b>
          <span className="truncate text-xs text-dim">{ip}</span>
        </span>
        <span className="w-44 truncate text-center text-xs font-bold text-txt lg:w-auto" title={a.os ?? undefined}>{a.os ? shortOs(a.os) : "-"}</span>
        <span className="w-28 truncate text-center text-xs text-muted lg:w-auto" title={tx("Nom du poste")}>{a.hostname ?? "-"}</span>
        <span className="inline-flex w-14 items-center justify-center gap-1 text-xs lg:w-auto" title={a.outdated ? tx("Agent v{0} : la v{1} est disponible", a.version ?? "?", a.latest_version ?? "?") : a.version ? tx("à jour (v{0})", a.version) : undefined}>
          {a.version ? <>v{a.version}<VersionMark outdated={!!a.outdated} /></> : "-"}
        </span>
        <span className="w-36 text-center text-xs text-muted lg:w-auto" title={a.last_ip ? `${tx("Dernier relevé")} : ${a.last_ip}` : undefined}>
          {a.last_seen ? dateTime(a.last_seen * 1000) : <span className="text-warn">{tx("aucun relevé reçu")}</span>}
        </span>
        <span className="w-28 text-center text-xs text-dim lg:w-auto" title={tx("Fréquence")}>{tx("toutes les {0} min", Math.round(a.interval / 60))}</span>
        <code className="w-28 truncate text-center font-mono text-xs text-dim lg:w-auto" title={tx("Jeton")}>{tx("msv_")}agent_…{a.hint}</code>
        <span className="flex items-center justify-center gap-1.5">
          {a.host_pending && <Badge tone="warn" title={tx("Nom de poste différent : {0} au lieu de {1}", a.host_pending, a.hostname ?? "?")}>{tx("nom à confirmer")}</Badge>}
          <Badge tone={tone}>{label}</Badge>
        </span>
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5 lg:ml-0">
          {confirm === "" && <>
            <button type="button" disabled={upBusy} aria-pressed={!!a.auto_update} aria-label={tx("Automatique")}
              title={a.auto_update ? tx("Mise à jour automatique activée : l'agent prend le nouveau script dès qu'il est plus ancien. Cliquer pour couper.") : tx("Activer la mise à jour automatique de cet agent")}
              onClick={() => void run(() => send("PATCH", `agents/${a.id}`, { auto_update: !a.auto_update }), a.auto_update ? tx("mise à jour automatique coupée") : tx("mise à jour automatique activée"))}
              className={`${iconBtn} ${a.auto_update ? "border-ok/60 bg-ok/15 text-ok" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}><RotateCw size={14} aria-hidden /></button>
            {(a.outdated || a.update_requested) && <button type="button" disabled={upBusy || !!a.update_requested} aria-label={tx("Mettre à jour maintenant")}
              title={a.update_requested ? tx("Demandée : l'agent se mettra à jour à son prochain relevé") : tx("Mettre à jour maintenant : l'agent récupère le nouveau script à son prochain relevé (au plus tard dans {0} min)", Math.round(a.interval / 60))}
              onClick={() => void run(() => send("POST", `agents/${a.id}/update`), tx("demandée : l'agent se mettra à jour à son prochain relevé"))}
              className={`${iconBtn} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`}><ArrowUpCircle size={14} aria-hidden /></button>}
            {onRenew && <button type="button" disabled={busy} aria-label={tx("Nouvelle commande")} title={tx("Crée un nouveau jeton et révoque l'ancien : à refaire sur le PC avec la nouvelle commande")}
              onClick={() => setConfirm("renew")} className={`${iconBtn} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`}><RefreshCw size={14} aria-hidden /></button>}
            <button type="button" aria-label={tx("Révoquer")} title={tx("Révoquer")} onClick={() => setConfirm("revoke")}
              className={`${iconBtn} border-bad/50 text-bad hover:bg-bad/10`}><Trash2 size={14} aria-hidden /></button>
          </>}
          {confirm !== "" && <>
            <span className="text-xs text-muted">{confirm === "renew" ? tx("L'ancien jeton cessera de marcher.") : tx("La machine n'enverra plus rien.")}</span>
            <button type="button" className={danger} onClick={() => {
              if (confirm === "renew") { setConfirm(""); onRenew?.(); }
              else void act(() => send("DELETE", `agents/${a.id}`), tx("révoqué"), setNote).then((ok) => ok && reload());
            }}>{tx("Confirmer")}</button>
            <button type="button" className={quiet} onClick={() => setConfirm("")}>{tx("Annuler")}</button>
          </>}
        </span>
      </div>
      {a.host_pending && <div className="mt-2"><HostConfirm a={a} reload={reload} setNote={setNote} /></div>}
      <NoteLine note={note} />
    </li>
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
