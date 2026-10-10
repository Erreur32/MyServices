// Réglages, trois sections sur le même état : « Clé SSH » (Accès et sécurité : à autoriser sur chaque machine), « Tâches et
// horaires » (Surveillance : modifiables, lancer maintenant) et « Système » (export de la configuration, informations).
import { Download, KeyRound, Play, RotateCcw, Server, Timer } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { download, LOGIN, LoginRequired, read, send } from "../api";
import { Copyable, Field, NoteLine } from "../components/form";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim } from "../components/ui";
import { bytes, dateTime, dur } from "../lib/format";
import type { SystemState, SystemTask } from "../types";
import { tx } from "../lib/i18n";

export function SystemSettings({ part }: { part: "system" | "tasks" | "ssh" }) {
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
      {part === "ssh" && <SshKey ssh={st.ssh} />}
      {part === "tasks" && <Tasks tasks={st.tasks} reload={reload} />}
      {part === "system" && <><Export /><Info info={st.info} /></>}
    </div>
  );
}

function SshKey({ ssh }: { ssh: SystemState["ssh"] }) {
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><KeyRound size={16} />{tx("Clé SSH de l'app")}</h2>
      {!ssh.public ? <p className="text-sm text-warn">{tx("Pas encore créée : elle l'est au démarrage du conteneur.")}</p> : <>
        <p className="mb-3 text-sm text-muted">
          {tx("La collecte lit chaque machine avec cette clé, en lecture seule. À ajouter dans")} <code className="font-mono text-xs">{tx("~/.ssh/authorized_keys")}</code>
          {" "}{tx("du compte visé sur chaque machine (un compte dédié, dans les groupes docker et adm, est le plus sûr : README). Empreinte")} <code className="font-mono text-xs">{ssh.fingerprint}</code> · {ssh.known_hosts} {tx("machine(s) connue(s).")}
        </p>
        <div className="flex flex-col gap-2">
          <Dim>{tx("Clé publique")}</Dim><Copyable text={ssh.public} />
          <Dim>{tx("Sur la machine, avec le compte visé")}</Dim><Copyable text={ssh.authorize!} />
        </div>
      </>}
    </Card>
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
  const result = t.running ? <Badge tone="info">{tx("en cours")}</Badge> : t.result === "success" ? <Badge tone="ok">{tx("réussi")}</Badge>
    : t.result ? <Badge tone="bad">{t.result}</Badge> : <Dim>{tx("pas encore lancé")}</Dim>;
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[200px] flex-1">
          <b>{t.label}</b> {!t.enabled && <Badge tone="off">{tx("non configurée")}</Badge>}
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
        <button type="button" className={primary} disabled={!t.enabled || t.running}
          onClick={() => void act(() => send("POST", `system/tasks/${t.name}/run`), tx("lancée : son état se met à jour ici"), setNote).then((ok) => ok && reload())}>
          <Play size={14} />{tx("Lancer")}
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
          {row(tx("Démarré"), tx("{0} · depuis {1}", dateTime(info.started * 1000), dur(info.uptime_s)))}
          {row(tx("Python"), info.python)}
          {row(tx("Port"), info.port)}
          {row(tx("Comptes"), info.auth ? tx("connexion requise") : <span className="text-warn">{tx("coupés (MYSERVICES_AUTH=0)")}</span>)}
          {row(tx("Cookies Secure"), info.cookie_secure ? tx("oui") : tx("non (HTTP direct)"))}
        </div>
        <div>
          {row(tx("Réseaux autorisés"), <span className="font-mono text-xs">{info.allow.join(", ")}</span>)}
          {row("/config", `${bytes(info.sizes.config)}`)}
          {row("/data", `${bytes(info.sizes.data)}`)}
          {row(tx("Base (comptes, historique, alertes)"), bytes(info.sizes.db))}
        </div>
      </div>
    </Card>
  );
}
