// Réglages → Connecteurs → SSH & Agents : comment chaque machine est lue. Agent : une machine envoie elle-même sa santé (petit script PowerShell en lecture seule), sans SSH.
// Une carte par machine : celles qui ont un agent (actif, silencieux, en attente) d'un côté, celles qui n'en ont pas de l'autre,
// prêtes à être cliquées. Un agent = un jeton lié à la machine, montré une seule fois avec la commande à coller sur le PC.
// Gérés seulement depuis une session admin.
import { shortOs } from "../lib/osName";
import { ArrowUpCircle, Check, ChevronDown, ChevronRight, Download, Monitor, MonitorUp, Plus, RefreshCw, RotateCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Copyable, Field, NoteLine } from "../components/form";
import { MachineIcon } from "../components/MachineIcon";
import { cleanAgentUrl, installCommand } from "../lib/agentCommand";
import { isWindowsMachine } from "../lib/machines";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Count, Dim } from "../components/ui";
import { dateTime, ipNum } from "../lib/format";
import type { AgentInfo, AgentsState, Machine, MachineConf, MachinesSettings } from "../types";
import { MSTATE, mState } from "../lib/machines";
import { usePoll } from "../lib/polling";
import { tx } from "../lib/i18n";

const STATE: Record<AgentInfo["state"], ["ok" | "warn" | "info" | "off", string]> = {
  actif: ["ok", tx("actif")],
  silencieux: ["warn", tx("silencieux")],
  "en attente": ["info", tx("en attente du premier relevé")],
  révoqué: ["off", tx("révoqué")],
};

// Exemple d'adresse du LAN : en local il n'y a pas de TLS, http est voulu
const EXAMPLE_URL = "http://192.168.1.10:8090"; // NOSONAR

/** Nom d'agent accepté par le serveur (lettres, chiffres, espace, . _ @ -) tiré du nom de la machine */
const agentName = (machine: string) => machine.replace(/[^\p{L}\p{N}_ .@-]/gu, "").trim().slice(0, 64) || "agent";

export function Agents({ focusIp, live }: { focusIp?: string; live: Machine[] }) {
  const [st, setSt] = useState<AgentsState | null>(null);
  const [machines, setMachines] = useState<MachinesSettings["machines"]>({});
  const [error, setError] = useState("");
  // Adresse de MyServices vue du PC : par défaut celle de la page (l'adresse par laquelle le PC joindra aussi MyServices) ;
  // le champ n'apparaît qu'à une nouvelle demande d'agent, pour la corriger au besoin
  const [url, setUrl] = useState(location.origin);
  const [created, setCreated] = useState<{ info: AgentInfo; token: string } | null>(null);  // jeton gardé en mémoire de la page seulement
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState("");
  const command = created ? installCommand(url, created.token) : null;  // suit le champ « Adresse de MyServices » même après la création
  const [pick, setPick] = useState("");  // PC Windows choisi, en attente de confirmation (rien n'est créé avant)
  const reload = useCallback(() => {
    read<AgentsState>("agents")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);
  useEffect(() => { read<MachinesSettings>("machines/settings").then((m) => setMachines(m.machines)).catch(() => undefined); }, []);
  // Rafraîchissement automatique : toutes les 5 s tant qu'un premier relevé est attendu (l'installation se voit aboutir), sinon toutes les 10 s ;
  // à l'arrêt quand l'onglet du navigateur est caché. Les cartes « Linux, lus par SSH » suivent l'état de la collecte (snapshot de l'application).
  const waiting = !!st?.agents.some((a) => a.state === "en attente");
  usePoll(reload, waiting ? 5000 : 30_000, false);
  // Cadre « Agent créé » : replié tout seul au premier relevé reçu (une fois), dépliable à la demande tant qu'on ne l'a pas fermé
  const [folded, setFolded] = useState(false), foldedFor = useRef(0);
  const seenFirst = created ? st?.agents.find((x) => x.id === created.info.id)?.last_seen : null;
  useEffect(() => {
    if (created && seenFirst && foldedFor.current !== created.info.id) { foldedFor.current = created.info.id; setFolded(true); }
  }, [created, seenFirst]);
  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;

  const byIp = new Map(st.agents.filter((a) => a.state !== "révoqué").map((a) => [a.ip, a]));
  const revoked = st.agents.filter((a) => a.state === "révoqué");
  const sorted = (ips: string[]) => ips.sort((a, b) => ipNum(a) - ipNum(b));
  const liveBy = new Map(live.map((m) => [m.ip, m]));
  // L'agent est un script PowerShell : il ne concerne que Windows (réglage « windows » ou système probable : TTL, scan). Une machine
  // qui n'est pas Windows se lit par SSH ; sans SSH, il lui faut d'abord un accès (réglage de la machine).
  const isWindows = (ip: string) => isWindowsMachine(machines[ip], liveBy.get(ip), byIp.has(ip));
  const tracked = Object.keys(machines).filter((ip) => !byIp.has(ip) && !machines[ip].disabled);
  const withAgent = sorted([...byIp.keys()]);
  // Même état que l'onglet Machines (mState) : « api » = déjà lue par l'API d'un connecteur (Home Assistant…), sans SSH, rien à régler
  const stateOf = (ip: string) => { const lm = liveBy.get(ip); return lm ? mState(lm) : null; };
  const badge = (ip: string) => { const st = stateOf(ip); if (!st) return null; const [tone, label, tip] = MSTATE[st]; return <Badge tone={tone} title={tip}>{label}</Badge>; };
  // SSH réel : réglé sur la machine, ou trouvé par la collecte (alias de ~/.ssh/config pour cette adresse), comme le badge « SSH OK »
  const sshAlias = (ip: string) => machines[ip].ssh === false ? "" : machines[ip].ssh || liveBy.get(ip)?.ssh?.alias || "";   // coupé à la main : pas de SSH
  const byApi = sorted(tracked.filter((ip) => !sshAlias(ip) && stateOf(ip) === "api"));      // lues par une API, sans SSH
  const without = sorted(tracked.filter((ip) => isWindows(ip) && !sshAlias(ip) && !byApi.includes(ip)));   // PC Windows sans agent
  const ssh = sorted(tracked.filter((ip) => !isWindows(ip) && !!sshAlias(ip)));               // Linux lus par SSH
  const noAccess = sorted(tracked.filter((ip) => !isWindows(ip) && !sshAlias(ip) && !byApi.includes(ip)));   // ni agent possible, ni SSH, ni API
  const local = /^https?:\/\/(localhost|127\.|\[::1\])/i.test(url);

  const addressField = (
    <div className="mt-3">
      <div className="max-w-md">
        <Field label={tx("Adresse de MyServices, vue du PC")}>
          <input className={input} value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder={EXAMPLE_URL} inputMode="url" />
        </Field>
      </div>
      {cleanAgentUrl(url)?.endsWith(":5180") && <p className="mt-2 text-sm text-warn">{tx("5180 est le serveur de développement : l'agent cessera d'envoyer quand il s'arrête. Utilisez l'adresse stable de MyServices (le conteneur, ex. http://192.168.1.10:8091).")}</p>}
      {local && <p className="mt-2 text-sm text-warn">{tx("localhost ne marchera pas depuis un autre PC : mettez l'adresse du LAN de MyServices (ex. http://192.168.1.10:8090).")}</p>}
    </div>
  );

  const create = async (ip: string) => {
    setBusy(ip); setNote(null);
    try {
      setCreated(await send<{ info: AgentInfo; token: string }>("POST", "agents", { ip, name: agentName(machines[ip]?.name ?? ip), url }));
      setPick("");
      reload();
    } catch (err) {
      if (err instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (err as Error).message });
    }
    setBusy("");
  };

  return (
    <div className="flex flex-col gap-7">
      <Card>
        <h2 className="flex items-center gap-2 font-bold"><MonitorUp size={16} />{tx("Accès aux machines")} <Count n={withAgent.length} /><Dim>{tx("agents")}</Dim><Count n={ssh.length} /><Dim>SSH</Dim></h2>
        <p className="mt-1 text-sm text-muted">
          {tx("Deux façons de lire la santé d'une machine, toujours en lecture seule.")} <b className="text-txt">{tx("Agent")}</b> {tx(": un petit script PowerShell installé sur un PC Windows, qui envoie lui-même sa santé à MyServices (disques, services, processeur, mémoire, mises à jour, journal) ; pas de SSH à ouvrir, et un PC souvent éteint se signale dès qu'il se rallume.")}{" "}
          <b className="text-txt">SSH</b> {tx(": pour les machines Linux, MyServices s'y connecte avec sa clé (santé, Docker, services en écoute).")}
        </p>
        <NoteLine note={note} />
      </Card>

      {created && (
        <Card tone="ok">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setFolded(!folded)} aria-expanded={!folded} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              {folded ? <ChevronRight size={16} className="shrink-0 text-txt" aria-hidden /> : <ChevronDown size={16} className="shrink-0 text-txt" aria-hidden />}
              <h2 className="truncate font-bold text-ok">{tx("Agent «")} {created.info.name} {tx("» créé")}</h2>
              {folded && seenFirst && <Badge tone="ok">✓ {tx("premier relevé reçu")}</Badge>}
            </button>
            <button type="button" className={quiet} onClick={() => setCreated(null)}><X size={14} />{tx("Fermer")}</button>
          </div>
          {!folded && <div className="mt-2">
            <p className="mb-2 text-sm text-warn">{tx("À copier maintenant : le jeton qu'elle contient ne sera plus jamais affiché.")}</p>
            <p className="mb-2 text-sm text-muted">{tx("Sur le PC, ouvrez PowerShell en administrateur (clic droit → Exécuter en tant qu'administrateur) et collez :")}</p>
            {command ? <Copyable key={command} text={command} />
              : <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{tx("Adresse de MyServices invalide : http://hôte:port, sans chemin. Corrigez-la ci-dessous, la commande se met à jour.")}</p>}
            {!command && addressField}
            <p className="mt-2 text-xs text-dim">{tx("L'installation crée une tâche planifiée (au démarrage, puis toutes les 15 min) et envoie un premier relevé. Pour retirer l'agent : révoquer ici, puis sur le PC relancer la commande avec MSV_UNINSTALL = '1'.")}</p>
            {(() => {  // confirmation côté MyServices : la page relit les agents toutes les 5 s tant qu'un premier relevé est attendu
              const seen = st.agents.find((x) => x.id === created.info.id);
              return seen?.last_seen
                ? <div role="status" className="mt-3 rounded-lg bg-ok/10 px-3 py-2">
                    <p className="text-sm font-semibold text-ok">✓ {tx("Agent installé et actif : premier relevé reçu")}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
                      <Monitor size={16} className="shrink-0 text-ok" aria-hidden />{tx("Système détecté :")} <b className="text-base text-txt">{seen.os || tx("non précisé par l'agent")}</b>
                      <Dim>· {tx("agent")} v{seen.version || "?"} · {dateTime(seen.last_seen * 1000)}</Dim>
                    </p>
                  </div>
                : <p role="status" className="mt-3 rounded-lg bg-bg2 px-3 py-2 text-sm text-muted">⏳ {tx("En attente du premier relevé : cette ligne se met à jour toute seule dès que le PC a envoyé le premier, sans rien à recharger.")}</p>;
            })()}
          </div>}
        </Card>
      )}

      {pick && machines[pick] && (
        <Card className="border-link/60">
          <h2 className="mb-1 flex items-center gap-2 font-bold"><Download size={16} aria-hidden />{tx("Installer l'agent sur")} {machines[pick].name} <Dim>· {pick}</Dim></h2>
          <p className="text-sm text-muted">{tx("L'agent est un script PowerShell pour Windows, en lecture seule. « Créer l'agent » génère son jeton (montré une seule fois) et la commande à coller dans un PowerShell administrateur du PC.")}</p>
          {addressField}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={!!busy || !url} onClick={() => void create(pick)}><Plus size={14} />{tx("Créer l'agent")}</button>
            <button type="button" className={quiet} onClick={() => setPick("")}>{tx("Annuler")}</button>
          </div>
        </Card>
      )}

      <Group title={tx("Avec un agent")} n={withAgent.length} fold rows>
        {withAgent.map((ip) => <ActiveCard key={ip} a={byIp.get(ip)!} conf={machines[ip]} ip={ip} focus={ip === focusIp} busy={busy === ip} onRenew={isWindows(ip) ? () => void create(ip) : undefined} reload={reload} />)}
      </Group>

      <Group title={tx("Sans agent")} fold n={without.length}
        hint={tx("PC Windows seulement. Cliquez sur un PC pour préparer son agent : rien n'est créé avant que vous confirmiez.")}>
        {without.map((ip) => (
          <li key={ip}>
            <button type="button" disabled={!!busy} onClick={() => setPick(pick === ip ? "" : ip)} aria-pressed={pick === ip}
              className={`flex h-full w-full items-center gap-3 rounded-xl border bg-bg2 p-3 text-left transition-colors hover:border-link hover:bg-link/10 disabled:opacity-60 ${pick === ip || ip === focusIp ? "border-link bg-link/10 ring-1 ring-link" : "border-dim/50"}`}>
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
        hint={tx("L'accès SSH se règle avec la machine : cliquez sur une carte pour ouvrir ses réglages.")}>
        {ssh.map((ip) => {
          const lm = liveBy.get(ip);
          return (
            <li key={ip}>
              <a href={`#settings/machines/${ip}`} className="flex h-full items-center gap-3 rounded-xl border border-dim/50 bg-bg2 p-3 transition-colors hover:border-link hover:bg-link/10">
                <MachineIcon m={{ role: liveBy.get(ip)?.role, icon: liveBy.get(ip)?.icon, name: machines[ip].name, os: machines[ip].os, info: lm?.info, ttl: lm?.ttl, osName: lm?.info?.os ?? lm?.agent?.os }} reserve />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm text-txt">{machines[ip].name}</b>
                  <span className="block truncate text-xs text-dim">{ip} · SSH {sshAlias(ip)}{!machines[ip].ssh && ` · ${tx("activé tout seul au prochain passage")}`}</span>
                </span>
                {badge(ip)}
              </a>
            </li>
          );
        })}
      </Group>

      <Group title={tx("Lues par leur API, sans SSH")} fold n={byApi.length}
        hint={tx("Déjà connectées par l'API d'un connecteur (Home Assistant…) : rien à régler. Le SSH n'y est pas nécessaire, et souvent pas possible.")}>
        {byApi.map((ip) => {
          const lm = liveBy.get(ip), list = lm?.api ?? [];
          return (
            <li key={ip}>
              <a href="#settings/connectors" className="flex h-full items-center gap-3 rounded-xl border border-dim/50 bg-bg2 p-3 transition-colors hover:border-link hover:bg-link/10"
                title={list.map((a) => `${a.label} (${a.name}) : ${a.message ?? ""}`).join("\n")}>
                <MachineIcon m={{ role: liveBy.get(ip)?.role, icon: liveBy.get(ip)?.icon, name: machines[ip].name, os: machines[ip].os, info: lm?.info, ttl: lm?.ttl, osName: lm?.info?.os ?? lm?.agent?.os }} reserve />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm text-txt">{machines[ip].name}</b>
                  <span className="block truncate text-xs text-dim">{ip} · {list.map((a) => a.label).join(", ")}</span>
                </span>
                {badge(ip)}
              </a>
            </li>
          );
        })}
      </Group>

      <Group title={tx("Sans accès : à régler")} fold n={noAccess.length}
        hint={tx("Ni agent possible (pas un PC Windows), ni SSH, ni API : activez l'accès SSH dans les réglages de la machine.")}>
        {noAccess.map((ip) => (
          <li key={ip}>
            <a href={`#settings/machines/${ip}`} className="flex h-full items-center gap-3 rounded-xl border border-dim/50 bg-bg2 p-3 transition-colors hover:border-link hover:bg-link/10">
              <MachineIcon m={{ role: liveBy.get(ip)?.role, icon: liveBy.get(ip)?.icon, name: machines[ip].name, os: machines[ip].os, info: liveBy.get(ip)?.info, ttl: liveBy.get(ip)?.ttl, osName: liveBy.get(ip)?.info?.os ?? liveBy.get(ip)?.agent?.os }} reserve />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm text-txt">{machines[ip].name}</b>
                <span className="block truncate text-xs text-dim">{ip}{machines[ip].off ? ` · ${tx("souvent éteinte")}` : ""}</span>
              </span>
              {badge(ip) ?? <Badge tone="warn">{tx("Régler l'accès SSH")}</Badge>}
            </a>
          </li>
        ))}
      </Group>

      <Group title={tx("Agents révoqués")} n={revoked.length} fold folded
        hint={tx("Leur jeton ne marche plus. « Nouvel agent » en crée un autre pour ce PC ; « Supprimer » les retire de la liste pour de bon.")}>
        {revoked.map((a) => <RevokedCard key={a.id} a={a} conf={machines[a.ip]} ip={a.ip} busy={busy === a.ip}
          onNew={isWindows(a.ip) ? () => void create(a.ip) : undefined} reload={reload} />)}
      </Group>
    </div>
  );
}

/** Groupe de cartes : titre, compte, texte d'aide, grille (ou le texte « vide ») ; pliable (chevron, comme « Agent créé ») si fold */
function Group({ title, n, hint, fold, folded, rows, children }: { title: string; n: number; hint?: string; fold?: boolean; folded?: boolean; rows?: boolean; children: React.ReactNode }) {
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
function HostConfirm({ a, reload, setNote }: { a: AgentInfo; reload: () => void; setNote: (n: Note) => void }) {
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
function ActiveCard({ a, conf, ip, focus, busy, onRenew, reload }: {
  a: AgentInfo; conf?: MachineConf; ip: string; focus: boolean; busy: boolean; onRenew?: () => void; reload: () => void;  // onRenew : seulement pour un PC Windows (la commande est PowerShell)
}) {
  const [confirm, setConfirm] = useState<"" | "renew" | "revoke">(""), [note, setNote] = useState<Note>(null), [upBusy, setUpBusy] = useState(false);
  const [tone, label] = STATE[a.state];
  const run = async (fn: () => Promise<unknown>, done: string) => { setUpBusy(true); const ok = await act(fn, done, setNote); setUpBusy(false); if (ok) reload(); };
  const attention = a.state !== "actif" || !!a.host_pending;
  return (
    <li className={`rounded-xl border bg-card px-3 py-2 text-sm ${focus || attention ? "border-link ring-1 ring-link" : "border-dim/50"}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 lg:grid lg:grid-cols-[minmax(13rem,1.6fr)_11rem_7rem_4.5rem_9.5rem_7.5rem_8rem_7.5rem_10rem] lg:gap-x-3">
        <span className="flex min-w-[12rem] flex-1 items-center gap-2 lg:flex-none">
          <MachineIcon m={{ name: conf?.name ?? a.name, os: conf?.os ?? "windows", osName: a.os }} reserve />
          <b className="truncate">{conf?.name ?? a.name}</b>
          <span className="truncate text-xs text-dim">{ip}</span>
        </span>
        <span className="w-44 truncate text-center text-xs font-bold text-txt lg:w-auto" title={a.os ?? undefined}>{a.os ? shortOs(a.os) : "-"}</span>
        <span className="w-28 truncate text-center text-xs text-muted lg:w-auto" title={tx("Nom du poste")}>{a.hostname ?? "-"}</span>
        <span className="inline-flex w-14 items-center justify-center gap-1 text-xs lg:w-auto" title={a.outdated ? tx("Agent v{0} : la v{1} est disponible", a.version ?? "?", a.latest_version ?? "?") : a.version ? tx("à jour (v{0})", a.version) : undefined}>
          {a.version ? <>v{a.version}{a.outdated ? <ArrowUpCircle size={13} className="text-warn" aria-hidden /> : <Check size={13} className="text-ok" aria-hidden />}</> : "-"}
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
        <MachineIcon m={{ name: conf?.name ?? a.name, os: conf?.os ?? "windows", osName: a.os }} reserve />
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
