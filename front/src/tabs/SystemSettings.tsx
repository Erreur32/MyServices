// Réglages, trois sections sur le même état : « Clé SSH » (Accès et sécurité : à autoriser sur chaque machine), « Tâches et
// horaires » (Surveillance : modifiables, lancer maintenant) et « Sauvegarde et informations » (export de la configuration,
// version de l'image et lien vers la dernière publiée, chemins, tailles).
import { Check, Copy, Download, ExternalLink, Eye, EyeOff, KeyRound, Play, RefreshCw, RotateCcw, Server, Timer } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { download, LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { copyText } from "../lib/clipboard";
import { MSTATE, mState } from "../lib/machines";
import { Field, NoteLine, Switch } from "../components/form";
import { act, button, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim } from "../components/ui";
import { bytes, dateTime, dur } from "../lib/format";
import type { SystemState, SystemTask } from "../types";
import { tx } from "../lib/i18n";
import { GITHUB, releaseOf } from "../lib/links";

export function SystemSettings({ part, snap }: { part: "system" | "tasks" | "ssh"; snap: Snapshot }) {
  const [st, setSt] = useState<SystemState | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    read<SystemState>("system")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(() => {
    reload();
    const id = setInterval(reload, 10_000); // tâche lancée : suivre sa fin
    return () => clearInterval(id);
  }, [reload]);
  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  return (
    <div className="flex flex-col gap-4">
      {part === "ssh" && <SshKey ssh={st.ssh} snap={snap} />}
      {part === "tasks" && <Tasks tasks={st.tasks} reload={reload} />}
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
              mask={(t) => t.replace(/'([^']*)'/, (_, k: string) => `'${maskKey(k)}'`)} />
          </div>
        </>}
      </Card>

      {ssh.public && (
        <Card>
          <h2 className="mb-2 font-bold">{tx("Autoriser la clé sur une machine")}</h2>
          <ol className="flex flex-col gap-2.5">
            <li className={step}><span className={num}>1</span><span>{tx("Copiez la commande ci-dessus (le bouton « copier » fonctionne même clé masquée).")}</span></li>
            <li className={step}><span className={num}>2</span><span>{tx("Collez-la dans un terminal de la machine, connecté avec le compte que MyServices doit utiliser. Elle ajoute la clé à")} <code className="font-mono text-xs">~/.ssh/authorized_keys</code>.</span></li>
            <li className={step}><span className={num}>3</span><span>{tx("Dans")} <a className="text-link hover:underline" href="#settings/machines">{tx("Réglages → Machines")}</a>, {tx("ouvrez la machine : « Autoriser la clé » vérifie la connexion.")}</span></li>
          </ol>
          <p className="mt-3 rounded-lg bg-bg2/60 px-3 py-2 text-xs text-muted">{tx("Le plus sûr : un compte dédié, dans les groupes docker et adm, plutôt que root (voir le README). Pour retirer l'accès, supprimez cette ligne de authorized_keys sur la machine.")}</p>
        </Card>
      )}

      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-bold"><Server size={16} />{tx("Machines qui utilisent cette clé")} <Dim>· {users.length}</Dim></h2>
        {users.length === 0 ? <Dim>{tx("Aucune machine n'est lue par SSH pour l'instant.")}</Dim> : (
          <ul className="flex flex-col divide-y divide-line/60">
            {users.map((m) => {
              const [tone, label, tip] = MSTATE[mState(m)];
              return (
                <li key={m.ip} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <a href={`#settings/machines/${m.ip}`} className="min-w-[160px] flex-1 hover:text-link" title={tx("Ouvrir les réglages de cette machine")}><b>{m.name}</b> <Dim>{m.ip}</Dim></a>
                  <span className="font-mono text-xs text-muted">{m.ssh!.user || "?"}@{m.ip}:{m.ssh!.port}</span>
                  <Badge tone={tone} title={tip}>{label}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

function Tasks({ tasks, reload }: { tasks: SystemTask[]; reload: () => void }) {
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Timer size={16} />{tx("Tâches et horaires")}</h2>
      <p className="mb-3 text-sm text-muted">
        {tx("Horaire :")} <code className="font-mono text-xs">{tx("minutes heures")}</code>{tx(", ex.")} <code className="font-mono text-xs">10,40 *</code> {tx("(deux fois par heure),")}
        {" "}<code className="font-mono text-xs">5 7,19</code> {tx("(7 h 05 et 19 h 05). Appliqué tout de suite, gardé dans config.json.")}
      </p>
      <ul className="flex flex-col divide-y divide-line/60">{tasks.map((t) => <TaskRow key={t.name} t={t} reload={reload} />)}</ul>
    </Card>
  );
}

function TaskRow({ t, reload }: { t: SystemTask; reload: () => void }) {
  const [at, setAt] = useState(t.at), [note, setNote] = useState<Note>(null);
  const first = t.enabled && !t.running && !t.result;  // jamais passée : le bouton « Lancer » attire l'œil
  const result = t.running ? <Badge tone="info">{tx("en cours")}</Badge> : t.result === "success" ? <Badge tone="ok">{tx("réussi")}</Badge>
    : t.result ? <Badge tone="bad">{t.result}</Badge> : <Dim>{tx("pas encore lancé")}</Dim>;
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[200px] flex-1">
          <b>{t.label}</b> {!t.enabled && <Badge tone="off">{t.switch ? tx("coupée") : tx("en attente")}</Badge>}
          {t.switch && (
            <label className="ml-3 inline-flex items-center gap-2 align-middle">
              <Switch on={t.enabled} label={t.enabled ? tx("Couper la santé des machines") : tx("Allumer la santé des machines")}
                onChange={(on) => void act(() => send("PUT", "system/health", { enabled: on }), on ? tx("santé allumée : premier relevé en cours, puis la collecte (une minute environ)") : tx("santé coupée"), setNote).then((ok) => ok && reload())} />
            </label>
          )}
          {!t.enabled && t.why && <p className="mt-0.5 text-xs text-muted">{t.why}</p>}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-dim">
            {result}
            {t.ended && t.started && <span>{tx("dernier :")} {dateTime(t.ended * 1000)} ({Math.round(t.ended - t.started)} s)</span>}
            <span>{tx("délai max")} {Math.round(t.timeout_s / 60)} {tx("min")}</span>
          </div>
        </div>
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void act(() => send("PUT", `system/tasks/${t.name}/schedule`, { at }), tx("horaire enregistré"), setNote).then((ok) => ok && reload()); }}>
          <input className={`${input} w-36 font-mono`} value={at} disabled={t.fixed} onChange={(e) => setAt(e.target.value)} aria-label={`Horaire ${t.label}`}
            title={t.fixed ? tx("fixé par la variable d'environnement du conteneur") : tx("défaut : {0}", t.default)} />
          {!t.fixed && <button className={quiet} disabled={at === t.at}>{tx("Enregistrer")}</button>}
          {!t.fixed && t.at !== t.default && (
            <button type="button" className={quiet} title={tx("défaut : {0}", t.default)}
              onClick={() => void act(() => send("PUT", `system/tasks/${t.name}/schedule`, { at: "" }), tx("horaire par défaut"), setNote).then((ok) => { if (ok) { setAt(t.default); reload(); } })}>
              <RotateCcw size={14} />
            </button>
          )}
        </form>
        <button type="button" className={first ? `${primary} nudge` : `${button} border-violet-400/50 bg-violet-500/10 text-txt hover:bg-violet-500/20`} disabled={!t.enabled || t.running}
          title={first ? tx("Jamais lancée : lancez-la une fois pour voir ses résultats sans attendre l'horaire") : tx("Refait un passage tout de suite, sans attendre l'horaire")}
          onClick={() => void act(() => send("POST", `system/tasks/${t.name}/run`), tx("lancée : son état se met à jour ici"), setNote).then((ok) => ok && reload())}>
          {first ? <Play size={14} /> : <RefreshCw size={14} />}{first ? tx("Lancer") : tx("Relancer")}
        </button>
      </div>
      {t.fixed && <p className="mt-1 text-xs text-dim">{tx("Fixé par MYSERVICES_")}{t.name.toUpperCase()}{tx("_AT dans le compose.")}</p>}
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
