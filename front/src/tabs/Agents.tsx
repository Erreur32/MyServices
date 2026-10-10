// Réglages → Connecteurs → Agents et SSH : comment chaque machine est lue. Agent : une machine envoie elle-même sa santé (petit script PowerShell en lecture seule), sans SSH.
// Une carte par machine : celles qui ont un agent (actif, silencieux, en attente) d'un côté, celles qui n'en ont pas de l'autre,
// prêtes à être cliquées. Un agent = un jeton lié à la machine, montré une seule fois avec la commande à coller sur le PC.
// Gérés seulement depuis une session admin.
import { ChevronDown, ChevronRight, Monitor, MonitorUp, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Copyable, Field, NoteLine } from "../components/form";
import { MachineIcon } from "../components/MachineIcon";
import { installCommand } from "../lib/agentCommand";
import { isWindowsMachine } from "../lib/machines";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim } from "../components/ui";
import { dateTime, ipNum } from "../lib/format";
import type { AgentInfo, AgentsState, Machine, MachineConf, MachinesSettings } from "../types";
import { MSTATE, mState } from "../lib/machines";
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
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reload(); }, waiting ? 5000 : 10000);
    return () => clearInterval(t);
  }, [waiting, reload]);
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
  const without = sorted(tracked.filter((ip) => isWindows(ip) && !machines[ip].ssh));          // PC Windows sans agent
  const ssh = sorted(tracked.filter((ip) => !isWindows(ip) && !!machines[ip].ssh));           // Linux lus par SSH
  const noAccess = sorted(tracked.filter((ip) => !isWindows(ip) && !machines[ip].ssh));       // ni agent possible ni SSH
  const local = /^https?:\/\/(localhost|127\.|\[::1\])/i.test(url);

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
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="flex items-center gap-2 font-bold"><MonitorUp size={16} />{tx("Accès aux machines")} <Dim>· {withAgent.length} {tx("agents")} · {ssh.length} SSH</Dim></h2>
        <p className="mt-1 text-sm text-muted">
          {tx("Deux façons de lire la santé d'une machine, toujours en lecture seule.")} <b className="text-txt">{tx("Agent")}</b> {tx(": un petit script PowerShell installé sur un PC Windows, qui envoie lui-même sa santé à MyServices (disques, services, processeur, mémoire, mises à jour, journal) ; pas de SSH à ouvrir, et un PC souvent éteint se signale dès qu'il se rallume.")}{" "}
          <b className="text-txt">SSH</b> {tx(": pour les machines Linux, MyServices s'y connecte avec sa clé (santé, Docker, services en écoute).")}
        </p>
        <div className="mt-3 max-w-md">
          <Field label={tx("Adresse de MyServices, vue du PC")}>
            <input className={input} value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder={EXAMPLE_URL} inputMode="url" />
          </Field>
        </div>
        {local && <p className="mt-2 text-sm text-warn">{tx("localhost ne marchera pas depuis un autre PC : mettez l'adresse du LAN de MyServices (ex. http://192.168.1.10:8090).")}</p>}
        <NoteLine note={note} />
      </Card>

      {created && (
        <Card className="border-ok/50">
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
              : <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{tx("Adresse de MyServices invalide : http://hôte:port, sans chemin. Corrigez-la en haut de la page, la commande se met à jour.")}</p>}
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
          <h2 className="mb-1 font-bold">{tx("Installer l'agent sur")} {machines[pick].name} <Dim>· {pick}</Dim></h2>
          <p className="text-sm text-muted">{tx("L'agent est un script PowerShell pour Windows, en lecture seule. « Créer l'agent » génère son jeton (montré une seule fois) et la commande à coller dans un PowerShell administrateur du PC.")}</p>
          {local && <p className="mt-2 text-sm text-warn">{tx("L'adresse de MyServices ci-dessus contient localhost : le PC ne pourra pas la joindre.")}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={!!busy || !url} onClick={() => void create(pick)}><Plus size={14} />{tx("Créer l'agent")}</button>
            <button type="button" className={quiet} onClick={() => setPick("")}>{tx("Annuler")}</button>
          </div>
        </Card>
      )}

      <Group title={tx("Avec un agent")} n={withAgent.length} empty={tx("Aucun agent pour l'instant : cliquez sur une machine ci-dessous.")}>
        {withAgent.map((ip) => <ActiveCard key={ip} a={byIp.get(ip)!} conf={machines[ip]} ip={ip} focus={ip === focusIp} busy={busy === ip} onRenew={isWindows(ip) ? () => void create(ip) : undefined} reload={reload} />)}
      </Group>

      <Group title={tx("Sans agent")} n={without.length}
        hint={tx("PC Windows seulement. Cliquez sur un PC pour préparer son agent : rien n'est créé avant que vous confirmiez.")}
        empty={Object.keys(machines).length === 0 ? tx("Aucune machine déclarée : ajoutez d'abord le PC dans Réglages → Machines.") : tx("Aucun PC Windows sans agent.")}>
        {without.map((ip) => (
          <li key={ip}>
            <button type="button" disabled={!!busy} onClick={() => setPick(pick === ip ? "" : ip)} aria-pressed={pick === ip}
              className={`flex h-full w-full items-center gap-3 rounded-xl border bg-bg2/60 p-3 text-left transition-colors hover:border-link hover:bg-link/10 disabled:opacity-60 ${pick === ip || ip === focusIp ? "border-link bg-link/10" : "border-line"}`}>
              <MachineIcon m={{ name: machines[ip].name, os: machines[ip].os }} reserve />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm text-txt">{machines[ip].name}</b>
                <span className="block truncate text-xs text-dim">{ip}{machines[ip].off ? ` · ${tx("souvent éteinte")}` : ""}</span>
              </span>
              <Plus size={15} className="shrink-0 text-dim" aria-hidden />
            </button>
          </li>
        ))}
      </Group>

      <Group title={tx("Linux, lus par SSH")} n={ssh.length}
        hint={tx("L'accès SSH se règle avec la machine : cliquez sur une carte pour ouvrir ses réglages.")}
        empty={tx("Aucune machine Linux lue par SSH pour l'instant : activez « Lecture par SSH » dans Réglages → Machines.")}>
        {ssh.map((ip) => {
          const lm = liveBy.get(ip), s = lm ? MSTATE[mState(lm)] : null;
          return (
            <li key={ip}>
              <a href={`#settings/machines/${ip}`} className="flex h-full items-center gap-3 rounded-xl border border-line bg-bg2/60 p-3 transition-colors hover:border-link hover:bg-link/10">
                <MachineIcon m={{ name: machines[ip].name, os: machines[ip].os, info: lm?.info, ttl: lm?.ttl }} reserve />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm text-txt">{machines[ip].name}</b>
                  <span className="block truncate text-xs text-dim">{ip} · SSH {machines[ip].ssh}</span>
                </span>
                {s && <Badge tone={s[0]} title={s[2]}>{s[1]}</Badge>}
              </a>
            </li>
          );
        })}
      </Group>

      <Group title={tx("Sans accès : à régler")} n={noAccess.length}
        hint={tx("Ni agent possible (pas un PC Windows) ni SSH : activez l'accès SSH dans les réglages de la machine.")}
        empty={tx("Toutes les machines ont un accès.")}>
        {noAccess.map((ip) => (
          <li key={ip}>
            <a href={`#settings/machines/${ip}`} className="flex h-full items-center gap-3 rounded-xl border border-line bg-bg2/60 p-3 transition-colors hover:border-link hover:bg-link/10">
              <MachineIcon m={{ name: machines[ip].name, os: machines[ip].os, info: liveBy.get(ip)?.info, ttl: liveBy.get(ip)?.ttl }} reserve />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm text-txt">{machines[ip].name}</b>
                <span className="block truncate text-xs text-dim">{ip}{machines[ip].off ? ` · ${tx("souvent éteinte")}` : ""}</span>
              </span>
              <Badge tone="warn">{tx("Régler l'accès SSH")}</Badge>
            </a>
          </li>
        ))}
      </Group>

      {revoked.length > 0 && (
        <details className="rounded-xl border border-line/60 bg-card/50 px-4 py-2 text-sm">
          <summary className="cursor-pointer text-muted">{tx("Agents révoqués")} <Dim>· {revoked.length}</Dim></summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-dim">
            {revoked.map((a) => <li key={a.id}>{machines[a.ip]?.name || a.name} · {a.ip} · <code className="font-mono">{tx("msv_")}agent_…{a.hint}</code> · {tx(" · révoqué le {0}", dateTime((a.revoked ?? 0) * 1000))}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Groupe de cartes : titre, compte, texte d'aide, grille (ou le texte « vide ») */
function Group({ title, n, hint, empty, children }: { title: string; n: number; hint?: string; empty: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 flex items-center gap-2 px-1 text-sm font-bold">{title} <Dim>· {n}</Dim></h3>
      {hint && n > 0 && <p className="mb-2 px-1 text-xs text-dim">{hint}</p>}
      {n === 0 ? <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">{empty}</p>
        : <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>}
    </section>
  );
}

/** Carte d'une machine qui a un agent : état, dernier relevé, nouvelle commande, révocation */
function ActiveCard({ a, conf, ip, focus, busy, onRenew, reload }: {
  a: AgentInfo; conf?: MachineConf; ip: string; focus: boolean; busy: boolean; onRenew?: () => void; reload: () => void;  // onRenew : seulement pour un PC Windows (la commande est PowerShell)
}) {
  const [confirm, setConfirm] = useState<"" | "renew" | "revoke">(""), [note, setNote] = useState<Note>(null);
  const [tone, label] = STATE[a.state];
  return (
    <li className={`flex flex-col gap-2 rounded-xl border bg-card p-3 text-sm ${focus ? "border-link" : "border-line"}`}>
      <div className="flex items-center gap-3">
        <MachineIcon m={{ name: conf?.name ?? a.name, os: conf?.os ?? "windows" }} reserve />
        <span className="min-w-0 flex-1">
          <b className="block truncate">{conf?.name ?? a.name}</b>
          <span className="block truncate text-xs text-dim">{ip}</span>
        </span>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="text-xs text-dim">
        {a.last_seen ? tx("dernier relevé {0} ({1})", dateTime(a.last_seen * 1000), a.last_ip) : tx("aucun relevé reçu")}
        {a.os && ` · ${a.os}`}{a.version && ` · ${tx("agent")} ${a.version}`} · {tx("toutes les {0} min", Math.round(a.interval / 60))}
        {" · "}<code className="font-mono">{tx("msv_")}agent_…{a.hint}</code>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {confirm === "" && <>
          {onRenew && <button type="button" className={quiet} disabled={busy} title={tx("Crée un nouveau jeton et révoque l'ancien : à refaire sur le PC avec la nouvelle commande")} onClick={() => setConfirm("renew")}><RefreshCw size={14} />{tx("Nouvelle commande")}</button>}
          <button type="button" className={`${danger} ml-auto`} onClick={() => setConfirm("revoke")}><Trash2 size={14} />{tx("Révoquer")}</button>
        </>}
        {confirm !== "" && <>
          <span className="text-xs text-muted">{confirm === "renew" ? tx("L'ancien jeton cessera de marcher.") : tx("La machine n'enverra plus rien.")}</span>
          <button type="button" className={`${danger} ml-auto`} onClick={() => {
            if (confirm === "renew") { setConfirm(""); onRenew?.(); }
            else void act(() => send("DELETE", `agents/${a.id}`), tx("révoqué"), setNote).then((ok) => ok && reload());
          }}>{tx("Confirmer")}</button>
          <button type="button" className={quiet} onClick={() => setConfirm("")}>{tx("Annuler")}</button>
        </>}
      </div>
      <NoteLine note={note} />
    </li>
  );
}
