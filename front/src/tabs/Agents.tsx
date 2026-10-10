// Réglages → Connecteurs → Agents : une machine envoie elle-même sa santé (petit script PowerShell en lecture seule), sans SSH.
// Une carte par machine : celles qui ont un agent (actif, silencieux, en attente) d'un côté, celles qui n'en ont pas de l'autre,
// prêtes à être cliquées. Un agent = un jeton lié à la machine, montré une seule fois avec la commande à coller sur le PC.
// Gérés seulement depuis une session admin.
import { MonitorUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Copyable, Field, NoteLine } from "../components/form";
import { MachineIcon } from "../components/MachineIcon";
import { act, danger, input, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim } from "../components/ui";
import { dateTime, ipNum } from "../lib/format";
import type { AgentInfo, AgentsState, MachineConf, MachinesSettings } from "../types";
import { tx } from "../lib/i18n";

const STATE: Record<AgentInfo["state"], ["ok" | "warn" | "info" | "off", string]> = {
  actif: ["ok", tx("actif")],
  silencieux: ["warn", tx("silencieux")],
  "en attente": ["info", tx("en attente du premier relevé")],
  révoqué: ["off", tx("révoqué")],
};

/** Nom d'agent accepté par le serveur (lettres, chiffres, espace, . _ @ -) tiré du nom de la machine */
const agentName = (machine: string) => machine.replace(/[^\p{L}\p{N}_ .@-]/gu, "").trim().slice(0, 64) || "agent";

export function Agents({ focusIp }: { focusIp?: string }) {
  const [st, setSt] = useState<AgentsState | null>(null);
  const [machines, setMachines] = useState<MachinesSettings["machines"]>({});
  const [error, setError] = useState("");
  const [url, setUrl] = useState(location.origin);
  const [created, setCreated] = useState<{ info: AgentInfo; command: string } | null>(null);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState("");
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

  const byIp = new Map(st.agents.filter((a) => a.state !== "révoqué").map((a) => [a.ip, a]));
  const revoked = st.agents.filter((a) => a.state === "révoqué");
  const sorted = (ips: string[]) => ips.sort((a, b) => ipNum(a) - ipNum(b));
  // Avec agent : tous. Sans agent : les machines que SSH ne lit pas (Windows, sans accès) ; une machine lue par SSH n'en a pas besoin.
  const withAgent = sorted([...byIp.keys()]);
  const without = sorted(Object.keys(machines).filter((ip) => !byIp.has(ip) && !machines[ip].disabled && (machines[ip].os === "windows" || !machines[ip].ssh)));
  const local = /^https?:\/\/(localhost|127\.|\[::1\])/i.test(url);

  const create = async (ip: string) => {
    setBusy(ip); setNote(null);
    try {
      setCreated(await send<{ info: AgentInfo; command: string }>("POST", "agents", { ip, name: agentName(machines[ip]?.name ?? ip), url }));
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
        <h2 className="flex items-center gap-2 font-bold"><MonitorUp size={16} />{tx("Agents")} <Dim>· {withAgent.length} {tx("actifs")}</Dim></h2>
        <p className="mt-1 text-sm text-muted">
          {tx("Un agent est un petit script PowerShell, en lecture seule, installé sur un PC Windows : il envoie lui-même sa santé à MyServices (disques, services, processeur, mémoire, mises à jour, journal). Pas de SSH à ouvrir ; un PC souvent éteint se signale dès qu'il se rallume. Un agent ne peut qu'envoyer un relevé pour sa machine.")}
        </p>
        <div className="mt-3 max-w-md">
          <Field label={tx("Adresse de MyServices, vue du PC")}>
            <input className={input} value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="http://192.168.1.10:8090" inputMode="url" />
          </Field>
        </div>
        {local && <p className="mt-2 text-sm text-warn">{tx("localhost ne marchera pas depuis un autre PC : mettez l'adresse du LAN de MyServices (ex. http://192.168.1.10:8090).")}</p>}
        <NoteLine note={note} />
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

      <Group title={tx("Avec un agent")} n={withAgent.length} empty={tx("Aucun agent pour l'instant : cliquez sur une machine ci-dessous.")}>
        {withAgent.map((ip) => <ActiveCard key={ip} a={byIp.get(ip)!} conf={machines[ip]} ip={ip} focus={ip === focusIp} busy={busy === ip} onRenew={() => void create(ip)} reload={reload} />)}
      </Group>

      <Group title={tx("Sans agent")} n={without.length}
        hint={tx("Cliquez sur une machine pour créer son agent et obtenir la commande à coller. Les machines lues par SSH n'apparaissent pas ici.")}
        empty={Object.keys(machines).length === 0 ? tx("Aucune machine déclarée : ajoutez d'abord le PC dans Réglages → Machines.") : tx("Toutes les machines sans SSH ont déjà leur agent.")}>
        {without.map((ip) => (
          <li key={ip}>
            <button type="button" disabled={!!busy || !url} onClick={() => void create(ip)}
              className={`flex h-full w-full items-center gap-3 rounded-xl border bg-bg2/60 p-3 text-left transition-colors hover:border-link hover:bg-link/10 disabled:opacity-60 ${ip === focusIp ? "border-link" : "border-line"}`}>
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
  a: AgentInfo; conf?: MachineConf; ip: string; focus: boolean; busy: boolean; onRenew: () => void; reload: () => void;
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
          <button type="button" className={quiet} disabled={busy} title={tx("Crée un nouveau jeton et révoque l'ancien : à refaire sur le PC avec la nouvelle commande")} onClick={() => setConfirm("renew")}><RefreshCw size={14} />{tx("Nouvelle commande")}</button>
          <button type="button" className={`${danger} ml-auto`} onClick={() => setConfirm("revoke")}><Trash2 size={14} />{tx("Révoquer")}</button>
        </>}
        {confirm !== "" && <>
          <span className="text-xs text-muted">{confirm === "renew" ? tx("L'ancien jeton cessera de marcher.") : tx("La machine n'enverra plus rien.")}</span>
          <button type="button" className={`${danger} ml-auto`} onClick={() => {
            if (confirm === "renew") { setConfirm(""); onRenew(); }
            else void act(() => send("DELETE", `agents/${a.id}`), tx("révoqué"), setNote).then((ok) => ok && reload());
          }}>{tx("Confirmer")}</button>
          <button type="button" className={quiet} onClick={() => setConfirm("")}>{tx("Annuler")}</button>
        </>}
      </div>
      <NoteLine note={note} />
    </li>
  );
}
