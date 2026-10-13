// Réglages, trois sections sur le même état : « Clé SSH » (Accès et sécurité : à autoriser sur chaque machine), « Tâches et
// horaires » (Surveillance : modifiables, lancer maintenant) et « Sauvegarde et informations » (export de la configuration,
// version de l'image et lien vers la dernière publiée, chemins, tailles).
import { Bell, Check, Copy, Download, ExternalLink, Eye, EyeOff, HardDrive, HeartPulse, KeyRound, Loader2, Play, Radar, RefreshCw, RotateCcw, Server, ShieldCheck, Timer, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { download, LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { copyText } from "../lib/clipboard";
import { MSTATE, mState } from "../lib/machines";
import { Field, NoteLine, Switch } from "../components/form";
import { act, button, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Count, Dim } from "../components/ui";
import { bytes, dateTime, dur, hm } from "../lib/format";
import type { SystemState, SystemTask } from "../types";
import { usePoll } from "../lib/polling";
import { tx } from "../lib/i18n";
import { MachineIcon } from "../components/MachineIcon";
import { GITHUB, releaseOf } from "../lib/links";
import { liveText, parseAt, period } from "../lib/tasks";
import { pokeScan } from "../lib/scan";

export function SystemSettings({ part, snap }: { part: "system" | "tasks" | "ssh"; snap: Snapshot }) {
  const [st, setSt] = useState<SystemState | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    read<SystemState>("system")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  usePoll(reload, st?.tasks.some((t) => t.running) ? 10_000 : 60_000);   // 10 s seulement pour suivre une tâche lancée
  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  return (
    <div className="flex flex-col gap-4">
      {part === "ssh" && <SshKey ssh={st.ssh} snap={snap} />}
      {part === "tasks" && <Tasks tasks={st.tasks} netscan={st.netscan} beat={st.scheduler?.beat ?? null} reload={reload} />}
      {part === "system" && <><Export /><Info info={st.info} /></>}
    </div>
  );
}

/** Clé publique avec un début et une fin lisibles et le milieu masqué : « ssh-ed25519 AAAAC3Nz…kSLsU myservices » */
function maskKey(key: string): string {
  const [type, body, ...comment] = key.trim().split(/\s+/);
  if (!body) return "•".repeat(24);
  return `${type} ${body.slice(0, 8)}${"•".repeat(24)}${body.slice(-5)}${comment.length ? ` ${comment.join(" ")}` : ""}`;
}

/** Texte à copier, masqué par défaut : l'œil le montre, le bouton « copier » marche dans les deux cas */
function Secretish({ text, label, shown, mask }: { text: string; label: string; shown: boolean; mask: (t: string) => string }) {
  const [note, setNote] = useState<Note>(null);
  const copy = async () => {
    const ok = await copyText(text);
    setNote({ ok, text: ok ? tx("Copié dans le presse-papiers") : tx("Copie impossible : sélectionner le texte et le copier à la main") });
    setTimeout(() => setNote(null), ok ? 2500 : 6000);
  };
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-dim">{label}</div>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-bg2 p-2.5 font-mono text-xs" aria-label={shown ? label : tx("{0} (masquée)", label)}>{shown ? text : mask(text)}</pre>
        <button type="button" onClick={() => void copy()} className={note?.ok ? `${button} border-ok bg-ok/15 text-ok` : primary}>
          {note?.ok ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{note?.ok ? tx("copié") : tx("copier")}
        </button>
      </div>
      <NoteLine note={note} />
    </div>
  );
}

function SshKey({ ssh, snap }: { ssh: SystemState["ssh"]; snap: Snapshot }) {
  const [shown, setShown] = useState(false);
  const users = snap.data.machine_list.filter((m) => m.ssh?.identity && !m.disabled);
  const algo = ssh.public?.split(/\s+/)[0]?.replace(/^ssh-/, "").toUpperCase();
  const step = "flex gap-3 text-sm text-muted";
  const num = "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-link/15 text-xs font-bold text-link";
  return (
    <>
      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold"><KeyRound size={16} />{tx("Clé SSH de l'app")}</h2>
          {ssh.public && (
            <button type="button" className={quiet} onClick={() => setShown(!shown)} aria-pressed={shown}
              title={shown ? tx("Masquer la clé") : tx("Afficher la clé")}>
              {shown ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}{shown ? tx("Masquer") : tx("Afficher")}
            </button>
          )}
        </div>
        {!ssh.public ? <p className="text-sm text-warn">{tx("Pas encore créée : elle l'est au démarrage du conteneur.")}</p> : <>
          <p className="mb-3 text-sm text-muted">{tx("La collecte lit chaque machine avec cette clé, en lecture seule. Seule la clé publique est montrée ici : la clé privée reste dans /config/ssh et ne quitte jamais le conteneur.")}</p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {algo && <Badge tone="info" title={tx("Type de clé")}>{algo}</Badge>}
            <Badge tone="off" title={tx("Empreinte (SHA256) : sert à reconnaître la clé sans la montrer")}><span className="font-mono">{ssh.fingerprint}</span></Badge>
            <Badge tone="off">{ssh.known_hosts} {tx("machine(s) connue(s)")}</Badge>
          </div>
          <div className="flex flex-col gap-3">
            <Secretish text={ssh.public} label={tx("Clé publique")} shown={shown} mask={maskKey} />
            <Secretish text={ssh.authorize!} label={tx("Commande à lancer sur la machine, avec le compte visé")} shown={shown}
              mask={(t) => t.replace(/'([^']*)'/g, (_, k: string) => `'${maskKey(k)}'`)} />
            {ssh.public_esxi && <Secretish text={ssh.public_esxi} label={tx("Clé publique ECDSA, pour VMware ESXi (à mettre dans /etc/ssh/keys-root/authorized_keys)")} shown={shown} mask={maskKey} />}
          </div>
        </>}
      </Card>

      {ssh.public && (
        <Card>
          <h2 className="mb-2 flex items-center gap-2 font-bold"><ShieldCheck size={16} aria-hidden />{tx("Autoriser la clé sur une machine")}</h2>
          <ol className="flex flex-col gap-2.5">
            <li className={step}><span className={num}>1</span><span>{tx("Copiez la commande ci-dessus (le bouton « copier » fonctionne même clé masquée).")}</span></li>
            <li className={step}><span className={num}>2</span><span>{tx("Collez-la dans un terminal de la machine, connecté avec le compte que MyServices doit utiliser. Elle ajoute la clé à")} <code className="font-mono text-xs">~/.ssh/authorized_keys</code>.</span></li>
            <li className={step}><span className={num}>3</span><span>{tx("Dans")} <a className="text-link hover:underline" href="#settings/machines">{tx("Réglages → Machines")}</a>, {tx("ouvrez la machine : « Autoriser la clé » vérifie la connexion.")}</span></li>
          </ol>
          <p className="mt-3 rounded-lg bg-bg2/60 px-3 py-2 text-xs text-muted">{tx("Le plus sûr : un compte dédié, dans les groupes docker et adm, plutôt que root (voir le README). Pour retirer l'accès, supprimez cette ligne de authorized_keys sur la machine.")}</p>
        </Card>
      )}

      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-bold"><Server size={16} />{tx("Machines qui utilisent cette clé")} <Count n={users.length} /></h2>
        {users.length === 0 ? <Dim>{tx("Aucune machine n'est lue par SSH pour l'instant.")}</Dim> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-dim">
                  <th className="py-2 pr-3 font-semibold">{tx("Machine")}</th><th className="px-3 py-2 font-semibold">{tx("Compte")}</th>
                  <th className="px-3 py-2 font-semibold">Port</th><th className="py-2 pl-3 text-right font-semibold">{tx("État")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {users.map((m) => {
                  const [tone, label, tip] = MSTATE[mState(m)];
                  return (
                    <tr key={m.ip} className="hover:bg-bg2/40">
                      <td className="py-2 pr-3">
                        <a href={`#settings/machines/${m.ip}`} className="flex items-center gap-2.5 hover:text-link" title={tx("Ouvrir les réglages de cette machine")}>
                          <MachineIcon m={{ name: m.name, info: m.info, ttl: m.ttl, osName: m.info?.os ?? m.agent?.os }} reserve />
                          <span className="min-w-0"><b className="block truncate">{m.name}</b><span className="block font-mono text-xs text-dim">{m.ip}</span></span>
                        </a>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">{m.ssh!.user || "?"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">{m.ssh!.port}</td>
                      <td className="py-2 pl-3 text-right"><Badge tone={tone} title={tip}>{label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** Aligned columns from one row to the next: task, editable schedule, next run, button */
const ROW_COLS = "lg:grid lg:grid-cols-[minmax(0,1fr)_18rem_9rem_11rem]";
const CODE = "rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] text-txt";
const ICON: Record<string, LucideIcon> = { collect: RefreshCw, watch: Bell, health: HeartPulse, backups: HardDrive, netscan: Radar };
const DESC: Record<string, string> = {
  collect: tx("Lit les machines, Docker, NPM et les connecteurs, puis met les pages à jour."),
  watch: tx("Compare au passage précédent : services tombés, nouveaux ou disparus, et envoie les alertes."),
  health: tx("Disques, services, mises à jour et SMART de chaque machine, lus par SSH."),
  backups: tx("Âge du dernier fichier de chaque sauvegarde suivie, et de ses copies."),
  netscan: tx("Cherche les nouveaux appareils sur le réseau."),
};
const desc = (name: string) => DESC[name] ?? "";

function TaskIcon({ name, on }: { name: string; on: boolean }) {
  const Icon = ICON[name] ?? Timer;
  return <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${on ? "bg-link/15 text-link" : "bg-bg2 text-dim"}`}><Icon size={16} aria-hidden /></span>;
}

function Tasks({ tasks, netscan, beat, reload }: { tasks: SystemTask[]; netscan?: SystemState["netscan"]; beat: number | null; reload: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const failed = tasks.filter((t) => t.result && t.result !== "success" && !t.running).length;
  const ago = beat ? Math.max(0, Math.round(now / 1000 - beat)) : null, alive = ago !== null && ago < 90;   // the loop turns every 5 s
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-bold"><Timer size={16} />{tx("Tâches et horaires")}</h2>
        <Badge tone={alive ? "ok" : "bad"} title={alive ? tx("Vérifié il y a {0} s. Il lance chaque tâche à son horaire, comme une crontab.", ago) : tx("Plus aucun tour depuis {0} s : redémarrez le conteneur.", ago ?? "?")}>
          {alive ? tx("planificateur actif") : tx("planificateur arrêté")}</Badge>
        <Badge tone="info">{tx("{0} tâche(s) programmée(s)", tasks.filter((t) => t.enabled).length + (netscan?.enabled ? 1 : 0))}</Badge>
        {failed > 0 && <Badge tone="bad">{tx("{0} en échec", failed)}</Badge>}
        {tasks.some((t) => t.running) && <Badge tone="info">{tx("en cours")}</Badge>}
      </div>
      {!alive && (
        <p className="mb-3 rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm">
          <b>{tx("Les horaires ne sont pas appliqués :")}</b> {tx("le planificateur intégré au conteneur (l'équivalent d'une crontab) ne tourne plus, aucune tâche ne part à son heure. Rien à activer : redémarrez le conteneur MyServices. Si le message revient, regardez Réglages → Journaux. En attendant, « Exécuter maintenant » marche toujours.")}
        </p>
      )}
      {/* how to write a schedule: the format, two examples, where it is kept */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-bg2/50 px-3 py-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">{tx("Format")} <code className={CODE}>{tx("minutes heures")}</code></span>
        <span className="inline-flex items-center gap-1.5"><code className={CODE}>10,40 *</code>{tx("deux fois par heure")}</span>
        <span className="inline-flex items-center gap-1.5"><code className={CODE}>5 7,19</code>{tx("à 7 h 05 et 19 h 05")}</span>
        <span className="inline-flex items-center gap-1.5 lg:ml-auto">{tx("Appliqué tout de suite, gardé dans")} <code className={CODE}>config.json</code></span>
      </div>
      <div className={`mb-1 hidden items-center gap-x-4 border-b border-line px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-dim ${ROW_COLS}`}>
        <span>{tx("Tâche")}</span><span>{tx("Horaire")}</span><span>{tx("Prochain passage")}</span><span aria-hidden />
      </div>
      <ul className="flex flex-col divide-y divide-line/60">
        {tasks.map((t) => <TaskRow key={t.name} t={t} now={now} reload={reload} />)}
        {netscan && <NetscanRow n={netscan} now={now} reload={reload} />}
      </ul>
    </Card>
  );
}

/** Next run in its own column: the time, then how long until it (or how long it has been running) */
function NextRun({ on, t, now }: { on: boolean; t: { running: boolean; started: number | null; next: number | null }; now: number }) {
  if (!on) return <div className="text-xs text-dim lg:pt-2">{tx("coupée")}</div>;
  if (t.running || t.next === null) return <div className="text-xs tabular-nums text-muted lg:pt-2">{liveText(t, now)}</div>;
  const min = Math.ceil((t.next * 1000 - now) / 60000);
  return (
    <div className="flex items-baseline gap-2 tabular-nums lg:flex-col lg:gap-0 lg:pt-1">
      <b className="font-mono text-sm">{hm(t.next * 1000)}</b>
      <span className="text-xs text-dim">{min <= 1 ? tx("dans moins d'une minute") : min >= 120 ? tx("dans {0} h", Math.round(min / 60)) : tx("dans {0} min", min)}</span>
    </div>
  );
}

/** Last run in one line: result, when, how long; the run state lives in memory, so a restart starts it over */
function LastRun({ t }: { t: Pick<SystemTask, "running" | "result" | "started" | "ended"> }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-dim">
      {t.running ? <Badge tone="info">{tx("en cours")}</Badge> : t.result === "success" ? <Badge tone="ok">{tx("réussi")}</Badge> : t.result ? <Badge tone="bad">{t.result}</Badge> : null}
      {t.ended && t.started ? <span>{tx("dernier :")} {dateTime(t.ended * 1000)} ({Math.round(t.ended - t.started)} s)</span>
        : !t.running && <span>{tx("pas encore passé depuis le démarrage")}</span>}
    </div>
  );
}

function TaskRow({ t, now, reload }: { t: SystemTask; now: number; reload: () => void }) {
  const [at, setAt] = useState(t.at), [note, setNote] = useState<Note>(null);
  const parsed = parseAt(at), changed = at.trim() !== t.at;
  const save = (spec: string, done: string) => void act(() => send("PUT", `system/tasks/${t.name}/schedule`, { at: spec }), done, setNote).then((ok) => { if (ok) { if (!spec) setAt(t.default); reload(); } });
  return (
    <li className={`px-1 py-3 text-sm ${t.enabled ? "" : "opacity-80"}`}>
      <div className={`flex flex-wrap items-start gap-x-4 gap-y-2 ${ROW_COLS}`}>
        <div className="flex min-w-[220px] gap-3">
          <TaskIcon name={t.name} on={t.enabled} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <b>{t.label}</b>
              {t.switch ? (
                <label className="inline-flex items-center gap-1.5 text-xs text-dim">
                  <Switch on={t.enabled} label={t.enabled ? tx("Couper la santé des machines") : tx("Allumer la santé des machines")}
                    onChange={(on) => void act(() => send("PUT", "system/health", { enabled: on }), on ? tx("santé allumée : premier relevé en cours, puis la collecte (une minute environ)") : tx("santé coupée"), setNote).then((ok) => ok && reload())} />
                  {t.enabled ? tx("allumée") : tx("coupée")}
                </label>
              ) : !t.enabled && <Badge tone="off">{tx("en attente")}</Badge>}
            </div>
            <p className="text-xs text-muted">{!t.enabled && t.why ? t.why : desc(t.name)}</p>
            {t.enabled && <LastRun t={t} />}
          </div>
        </div>
        <div>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (parsed) save(at.trim(), tx("horaire enregistré")); }}>
            <input className={`${input} h-9 w-36 font-mono ${parsed ? "" : "border-bad"}`} value={at} disabled={t.fixed} onChange={(e) => setAt(e.target.value)} aria-label={tx("Horaire de {0}", t.label)}
              aria-invalid={!parsed} title={t.fixed ? tx("fixé par la variable d'environnement du conteneur") : tx("défaut : {0}", t.default)} />
            {!t.fixed && changed && <button className={`${primary} h-9`} disabled={!parsed}>{tx("Enregistrer")}</button>}
            {!t.fixed && !changed && t.at !== t.default && (
              <button type="button" className={`${quiet} h-9`} title={tx("Revenir au défaut : {0}", t.default)} aria-label={tx("Revenir au défaut : {0}", t.default)}
                onClick={() => save("", tx("horaire par défaut"))}><RotateCcw size={14} /></button>
            )}
          </form>
          <p className={`mt-1 text-xs ${parsed ? "text-dim" : "text-bad"}`}>
            {parsed ? period(parsed) : tx("format attendu : minutes (0-59) puis heures (0-23 ou *), séparées par des virgules")}
          </p>
          {t.fixed && <p className="mt-0.5 text-xs text-dim">{tx("Fixé par MYSERVICES_")}{t.name.toUpperCase()}{tx("_AT dans le compose.")}</p>}
        </div>
        <NextRun on={t.enabled} t={{ running: t.running, started: t.started, next: t.next ?? null }} now={now} />
        <div className="flex items-start lg:justify-end">
          <button type="button" className={`${button} h-9 justify-center border-link/50 bg-link/10 text-txt hover:bg-link/20`} disabled={!t.enabled || t.running}
            title={tx("Exécute la tâche tout de suite, une fois, sans attendre l'horaire ; l'horaire ne change pas")}
            onClick={() => void act(() => send("POST", `system/tasks/${t.name}/run`), tx("lancée : son état se met à jour ici"), setNote).then((ok) => ok && reload())}>
            {t.running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}{tx("Exécuter maintenant")}
          </button>
        </div>
      </div>
      <NoteLine note={note} />
    </li>
  );
}

/** The network search runs every N hours: the same setting as Discovery (PUT network/settings), so both pages stay in step */
function NetscanRow({ n, now, reload }: { n: NonNullable<SystemState["netscan"]>; now: number; reload: () => void }) {
  const [cfg, setCfg] = useState<{ every_h: number; default_h: number; max_h: number; fixed: boolean } | null>(null);
  const [hours, setHours] = useState(""), [note, setNote] = useState<Note>(null);
  const load = useCallback(() => { read<{ every_h: number; default_h: number; max_h: number; fixed: boolean }>("network/settings").then((c) => { setCfg(c); setHours(String(c.every_h)); }).catch(() => undefined); }, []);
  useEffect(load, [load]);
  const h = Number(hours), valid = !!cfg && hours !== "" && Number.isInteger(h) && h >= 0 && h <= cfg.max_h;
  const save = (value: number) => void act(() => send("PUT", "network/settings", { every_h: value }), value ? tx("enregistré : toutes les {0} h", value) : tx("enregistré : recherche automatique coupée"), setNote)
    .then((ok) => { if (ok) { load(); reload(); } });
  return (
    <li className={`px-1 py-3 text-sm ${n.enabled ? "" : "opacity-80"}`}>
      <div className={`flex flex-wrap items-start gap-x-4 gap-y-2 ${ROW_COLS}`}>
        <div className="flex min-w-[220px] gap-3">
          <TaskIcon name="netscan" on={n.enabled} />
          <div className="min-w-0">
            <b>{tx("Recherche réseau")}</b>
            <p className="text-xs text-muted">{desc("netscan")}</p>
            {n.enabled && <LastRun t={{ running: n.running, result: null, started: n.started, ended: n.ended }} />}
          </div>
        </div>
        <div>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) save(h); }}>
            <span className="flex items-center gap-1.5">
              <input className={`${input} h-9 w-20 font-mono ${valid || hours === "" ? "" : "border-bad"}`} type="number" min={0} max={cfg?.max_h} step={1} value={hours}
                disabled={!cfg || cfg.fixed} onChange={(e) => setHours(e.target.value)} aria-label={tx("Fréquence (heures, 0 = coupée)")}
                title={cfg?.fixed ? tx("fixée par la variable d'environnement du conteneur") : tx("défaut : {0}", cfg?.default_h ?? "?")} />
              <span className="text-xs text-dim">h</span>
            </span>
            {cfg && !cfg.fixed && h !== cfg.every_h && <button className={`${primary} h-9`} disabled={!valid}>{tx("Enregistrer")}</button>}
            {cfg && !cfg.fixed && h === cfg.every_h && cfg.every_h !== cfg.default_h && (
              <button type="button" className={`${quiet} h-9`} title={tx("Revenir au défaut : {0}", cfg.default_h)} aria-label={tx("Revenir au défaut : {0}", cfg.default_h)}
                onClick={() => save(cfg.default_h)}><RotateCcw size={14} /></button>
            )}
          </form>
          <p className={`mt-1 text-xs ${valid || hours === "" ? "text-dim" : "text-bad"}`}>
            {!valid && hours !== "" ? tx("Un nombre entier de 0 à {0}.", cfg?.max_h ?? "?") : h === 0 ? tx("coupée") : tx("toutes les {0} h", h)}
            {" · "}<a className="text-link hover:underline" href="#settings/network/scan">{tx("même réglage que Découverte")}</a>
          </p>
          {cfg?.fixed && <p className="mt-0.5 text-xs text-dim">{tx("Fixée par MYSERVICES_NETSCAN_EVERY dans le compose.")}</p>}
        </div>
        <NextRun on={n.enabled} t={n} now={now} />
        <div className="flex items-start lg:justify-end">
          <button type="button" className={`${button} h-9 justify-center border-link/50 bg-link/10 text-txt hover:bg-link/20`} disabled={n.running}
            title={tx("Exécute la tâche tout de suite, une fois, sans attendre l'horaire ; l'horaire ne change pas")}
            onClick={() => void act(async () => { await send("POST", "network/scan"); pokeScan(); }, tx("recherche lancée"), setNote).then(() => reload())}>
            {n.running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}{tx("Exécuter maintenant")}
          </button>
        </div>
      </div>
      <NoteLine note={note} />
    </li>
  );
}

function Export() {
  const [pw, setPw] = useState(""), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setNote(null);
    try {
      const { blob, name } = await download("system/export", { password: pw });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      setPw("");
      setNote({ ok: true, text: tx("{0} téléchargé ({1}) : à garder en lieu sûr", name, bytes(blob.size)) });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Download size={16} />{tx("Exporter la configuration")}</h2>
      <p className="mb-3 text-sm text-muted">
        {tx("Archive de")} <code className="font-mono text-xs">{tx("/config")}</code> {tx(": réglages, machines, secrets")} <b className="text-warn">{tx("avec leur clé")}</b> {tx("et clés SSH. De quoi tout réinstaller (à remettre dans")} <code className="font-mono text-xs">{tx("./config")}</code>{tx(") : la garder comme un mot de passe. Les comptes et l'historique sont dans")} <code className="font-mono text-xs">{tx("/data/myservices.db")}</code>.
      </p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <Field label={tx("Ton mot de passe")}>
          <input className={`${input} w-64`} type="password" required autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <button className={primary} disabled={busy}><Download size={14} />{tx("Télécharger")}</button>
      </form>
      <NoteLine note={note} />
    </Card>
  );
}

function Info({ info }: { info: SystemState["info"] }) {
  const row = (k: string, v: ReactNode) => (
    <div className="flex justify-between gap-3 py-1"><span className="text-dim">{k}</span><span className="min-w-0 text-right">{v}</span></div>
  );
  return (
    <Card>
      <h2 className="mb-2 flex items-center gap-2 font-bold"><Server size={16} />{tx("Informations")}</h2>
      <div className="grid gap-x-8 text-sm md:grid-cols-2">
        <div>
          {row(tx("Version"), <code className="font-mono text-xs">{info.version}</code>)}
          {row(tx("Dernière publiée"), <span className="flex flex-wrap justify-end gap-x-3">
            {releaseOf(info.version) && <a className="inline-flex items-center gap-1 text-link hover:underline" href={releaseOf(info.version)!.url} target="_blank" rel="noopener noreferrer">{tx("Notes de {0}", releaseOf(info.version)!.tag)}<ExternalLink size={12} aria-hidden /></a>}
            <a className="inline-flex items-center gap-1 text-link hover:underline" href={`${GITHUB}/releases/latest`} target="_blank" rel="noopener noreferrer">{tx("Voir la dernière version")}<ExternalLink size={12} aria-hidden /></a>
          </span>)}
          {row(tx("Démarré"), tx("{0} · depuis {1}", dateTime(info.started * 1000), dur(info.uptime_s)))}
          {row(tx("Python"), info.python)}
          {row(tx("Port"), info.port)}
          {row(tx("Comptes"), info.auth ? tx("connexion requise") : <span className="text-warn">{tx("coupés (MYSERVICES_AUTH=0)")}</span>)}
          {row(tx("Cookies Secure"), info.cookie_secure ? tx("oui") : tx("non (HTTP direct)"))}
        </div>
        <div>
          {row(tx("Réseaux autorisés"), <span className="font-mono text-xs">{info.allow.join(", ")}</span>)}
          {row(info.paths.config, bytes(info.sizes.config))}
          {row(info.paths.data, bytes(info.sizes.data))}
          {row(tx("Base (comptes, historique, alertes)"), bytes(info.sizes.db))}
        </div>
      </div>
    </Card>
  );
}
