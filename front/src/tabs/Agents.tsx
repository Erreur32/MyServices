// Réglages → Connecteurs : une machine envoie elle-même sa santé (petit script PowerShell en lecture seule), sans SSH.
// Un agent = un jeton lié à une machine déclarée ; montré une seule fois, avec la commande à coller sur le PC.
// Gérés seulement depuis une session admin.
import { MonitorUp, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Copyable, Field, NoteLine } from "../components/form";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim } from "../components/ui";
import { dateTime, ipNum } from "../lib/format";
import type { AgentInfo, AgentsState, MachinesSettings } from "../types";
import { tx } from "../lib/i18n";

const STATE: Record<AgentInfo["state"], ["ok" | "warn" | "info" | "off", string]> = {
  actif: ["ok", tx("actif")],
  silencieux: ["warn", tx("silencieux")],
  "en attente": ["info", tx("en attente du premier relevé")],
  révoqué: ["off", tx("révoqué")],
};

/** Nom d'agent accepté par le serveur (lettres, chiffres, espace, . _ @ -) tiré du nom de la machine */
const agentName = (machine: string) => machine.replace(/[^\p{L}\p{N}_ .@-]/gu, "").trim().slice(0, 64) || "agent";

export function Agents({ focusIp }: { focusIp?: string }) {  // intégré à Réglages → Connecteurs (partie « Agents »)
  const [st, setSt] = useState<AgentsState | null>(null);
  const [machines, setMachines] = useState<MachinesSettings["machines"]>({});
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ info: AgentInfo; command: string } | null>(null);
  const reload = useCallback(() => {
    read<AgentsState>("agents")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);
  useEffect(() => { read<MachinesSettings>("machines/settings").then((m) => setMachines(m.machines)).catch(() => undefined); }, []);
  // Tant qu'un agent attend son premier relevé, on regarde toutes les 5 s : l'installation se voit aboutir
  const waiting = !!st?.agents.some((a) => a.state === "en attente");
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [waiting, reload]);
  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  const live = st.agents.filter((a) => a.state !== "révoqué");
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="flex items-center gap-2 font-bold"><MonitorUp size={16} />{tx("Agents")}</h2>
        <p className="mt-1 text-sm text-muted">
          {tx("Un agent est un petit script PowerShell, en lecture seule, installé sur un PC Windows : il envoie lui-même sa santé à MyServices (disques, services, processeur, mémoire, mises à jour, journal). Pas de SSH à ouvrir ; un PC souvent éteint se signale dès qu'il se rallume. Un agent ne peut qu'envoyer un relevé pour sa machine.")}
        </p>
      </Card>
      {created && (
        <Card className="border-ok/50">
          <h2 className="mb-1 font-bold text-ok">{tx("Agent «")} {created.info.name} {tx("» créé")}</h2>
          <p className="mb-2 text-sm text-warn">{tx("À copier maintenant : le jeton qu'elle contient ne sera plus jamais affiché.")}</p>
          <p className="mb-2 text-sm text-muted">{tx("Sur le PC, ouvrez PowerShell en administrateur (clic droit → Exécuter en tant qu'administrateur) et collez :")}</p>
          <Copyable text={created.command} />
          <p className="mt-2 text-xs text-dim">{tx("L'installation crée une tâche planifiée (au démarrage, puis toutes les 15 min) et envoie un premier relevé. Pour retirer l'agent : révoquer ici, puis sur le PC relancer la commande avec MSV_UNINSTALL = '1'.")}</p>
          <button type="button" className={`${quiet} mt-3`} onClick={() => setCreated(null)}>{tx("C'est copié, fermer")}</button>
        </Card>
      )}
      <NewAgent machines={machines} taken={new Set(live.map((a) => a.ip))} focusIp={focusIp} onCreated={(c) => { setCreated(c); reload(); }} />
      <Card>
        <h2 className="mb-2 font-bold">{tx("Agents")} <Dim>· {live.length} {tx("actifs")}</Dim></h2>
        {st.agents.length === 0 ? <p className="text-sm text-muted">{tx("Aucun agent.")}</p> : (
          <ul className="flex flex-col divide-y divide-line/60">{st.agents.map((a) => <AgentRow key={a.id} a={a} machine={machines[a.ip]?.name} reload={reload} />)}</ul>
        )}
      </Card>
    </div>
  );
}

function NewAgent({ machines, taken, focusIp, onCreated }: {
  machines: MachinesSettings["machines"]; taken: Set<string>; focusIp?: string;
  onCreated: (c: { info: AgentInfo; command: string }) => void;
}) {
  const ips = Object.keys(machines).sort((a, b) => ipNum(a) - ipNum(b));
  const [ip, setIp] = useState(focusIp && machines[focusIp] ? focusIp : "");
  const [url, setUrl] = useState(location.origin);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (!ip && focusIp && machines[focusIp]) setIp(focusIp); }, [focusIp, machines, ip]);
  const local = /^https?:\/\/(localhost|127\.|\[::1\])/i.test(url);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setNote(null);
    try {
      const r = await send<{ info: AgentInfo; command: string }>("POST", "agents", { ip, name: agentName(machines[ip].name), url });
      onCreated(r);
      setIp("");  // formulaire remis à zéro : la machine qui vient d'avoir son agent n'est plus « déjà » à traiter
    } catch (err) {
      if (err instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  };
  return (
    <Card>
      <h2 className="mb-3 font-bold">{tx("Nouvel agent")}</h2>
      {ips.length === 0 ? <p className="text-sm text-muted">{tx("Aucune machine déclarée : ajoutez d'abord le PC dans Réglages → Machines.")}</p> : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx("Machine")}>
              <select className={input} required value={ip} onChange={(e) => setIp(e.target.value)}>
                <option value="" disabled>{tx("Choisir la machine…")}</option>
                {ips.map((i) => <option key={i} value={i}>{machines[i].name} · {i}{taken.has(i) ? ` (${tx("a déjà un agent")})` : ""}</option>)}
              </select>
            </Field>
            <Field label={tx("Adresse de MyServices, vue du PC")}>
              <input className={input} required value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="http://192.168.1.10:8090" inputMode="url" />
            </Field>
          </div>
          {local && <p className="text-sm text-warn">{tx("localhost ne marchera pas depuis un autre PC : mettez l'adresse du LAN de MyServices (ex. http://192.168.1.10:8090).")}</p>}
          {ip && taken.has(ip) && <p className="text-sm text-warn">{tx("Cette machine a déjà un agent : en créer un nouveau révoque l'ancien.")}</p>}
          <div><button className={primary} disabled={busy || !ip}><Plus size={14} />{tx("Créer l'agent")}</button></div>
          <NoteLine note={note} />
        </form>
      )}
    </Card>
  );
}

function AgentRow({ a, machine, reload }: { a: AgentInfo; machine?: string; reload: () => void }) {
  const [confirm, setConfirm] = useState(false), [note, setNote] = useState<Note>(null);
  const [tone, label] = STATE[a.state];
  const live = a.state !== "révoqué";
  return (
    <li className={`py-2.5 text-sm ${live ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <b>{machine || a.name}</b><Dim>{a.ip}</Dim>
        <code className="font-mono text-xs text-dim">{tx("msv_")}agent_…{a.hint}</code>
        <Badge tone={tone}>{label}</Badge>
        <span className="ml-auto">
          {live && (confirm ? <>
            <button type="button" className={danger} onClick={() => void act(() => send("DELETE", `agents/${a.id}`), tx("révoqué"), setNote).then((ok) => ok && reload())}>{tx("Confirmer")}</button>
            <button type="button" className={`${quiet} ml-1.5`} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
          </> : <button type="button" className={danger} onClick={() => setConfirm(true)}><Trash2 size={14} />{tx("Révoquer")}</button>)}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-dim">
        {tx("créé le")} {dateTime(a.created * 1000)}{a.created_by && ` ${tx("par")} ${a.created_by}`}
        {" · "}{a.last_seen ? tx("dernier relevé {0} ({1})", dateTime(a.last_seen * 1000), a.last_ip) : tx("aucun relevé reçu")}
        {a.os && ` · ${a.os}`}{a.version && ` · ${tx("agent")} ${a.version}`}
        {live && ` · ${tx("toutes les {0} min", Math.round(a.interval / 60))}`}
        {a.revoked && tx(" · révoqué le {0}", dateTime(a.revoked * 1000))}
      </div>
      <NoteLine note={note} />
    </li>
  );
}
