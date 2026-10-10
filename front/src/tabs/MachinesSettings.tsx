// Réglages → Machines : équivalent graphique de « setup.py --add ». Détecter (IP, nom ou alias SSH : ping,
// ports, SSH Linux / Windows, Docker, AdGuard, VM, services web, connecteurs reconnus), relire la proposition,
// enregistrer ; modifier, vérifier (mêmes contrôles que setup.py --check) ou retirer une machine déclarée.
// Chaque carte porte aussi l'accès SSH relevé par la collecte (résumé plié, détail déplié) : tout ce qui touche une
// machine est ici ; Connecteurs ne garde que les services lus par leur API.
import { ChevronDown, ChevronRight, Plus, Radar, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { Field, NoteLine, Switch } from "../components/form";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim } from "../components/ui";
import { ipNum } from "../lib/format";
import type { Detection, MachineConf, MachinesSettings as State } from "../types";
import { MSTATE, mState } from "../lib/machines";
import { SshDetails } from "../components/ssh";
import { sshBrief, sshWarn } from "../lib/ssh";
import { tx } from "../lib/i18n";

const FLAGS: { k: keyof MachineConf; label: string; help: string }[] = [
  { k: "off", label: tx("Souvent éteinte"), help: tx("PC, portable : « machine éteinte » sans alerte tant qu'elle ne répond pas") },
  { k: "gateway", label: tx("Passerelle"), help: tx("box / routeur : sous-titre de la page") },
  { k: "npm", label: tx("Héberge NPM"), help: tx("sous-titre de la page") },
  { k: "npm_only", label: tx("Joignable seulement par NPM"), help: tx("pare-feu : ses services sont testés via NPM") },
  { k: "vm", label: tx("Machine virtuelle"), help: tx("la santé n'y lit pas SMART") },
];

export function MachinesSettings({ snap }: { snap: Snapshot }) {
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [detecting, setDetecting] = useState(false);
  const reload = useCallback(() => {
    read<State>("machines/settings")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);
  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  const live = new Map((snap.data.machine_list || []).map((m) => [m.ip, m]));
  const ips = Object.keys(st.machines).sort((a, b) => ipNum(a) - ipNum(b));
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{tx("Machines")} <Dim>· {ips.length}</Dim></h2>
          {!detecting && <button type="button" className={primary} onClick={() => setDetecting(true)}><Plus size={14} />{tx("Ajouter une machine")}</button>}
        </div>
        <p className="mt-1 text-sm text-muted">
          {tx("Lecture seule sur le réseau, comme la collecte. L'accès SSH passe par un alias de")} <code className="font-mono text-xs">{st.ssh_conf}</code>
          {" "}({st.aliases.length} {tx("connus) ; la clé publique de l'app doit être dans")} <code className="font-mono text-xs">{tx("authorized_keys")}</code> {tx("du compte visé. Un changement est pris en compte au prochain passage de la collecte.")}
        </p>
        {detecting && <Detect st={st} onDone={() => { setDetecting(false); reload(); }} onCancel={() => setDetecting(false)} />}
      </Card>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {ips.map((ip) => {
          const lm = live.get(ip);
          const stat = (snap.data.connectors || []).filter((c) => ["docker", "process", "adguard"].includes(c.type) && (c.name === ip || c.name === lm?.name));
          return <MachineRow key={ip} ip={ip} m={st.machines[ip]} st={st} live={lm} statuses={stat} reload={reload} />;
        })}
      </div>
    </div>
  );
}

/** Ajout : cible → détection → proposition à relire → enregistrer. */
function Detect({ st, onDone, onCancel }: { st: State; onDone: () => void; onCancel: () => void }) {
  const [target, setTarget] = useState("");
  const [d, setD] = useState<Detection | null>(null);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setD(null); setNote(null);
    try {
      setD(await send<Detection>("POST", `machines/detect?target=${encodeURIComponent(target)}`));
    } catch (err) {
      if (err instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  };
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-bg2/50 p-3">
      <form onSubmit={run} className="flex flex-wrap items-end gap-2">
        <Field label={tx("IP, nom ou alias SSH")}>
          <input className={`${input} min-w-[260px]`} list="ssh-aliases" required value={target} onChange={(e) => setTarget(e.target.value)} placeholder={tx("ex. 192.168.1.20 ou nas")} />
          <datalist id="ssh-aliases">{st.aliases.map((a) => <option key={a.alias} value={a.alias}>{a.ip || a.host}</option>)}</datalist>
        </Field>
        <button className={primary} disabled={busy}><Radar size={14} />{busy ? tx("Détection…") : tx("Détecter")}</button>
        <button type="button" className={quiet} onClick={onCancel}>{tx("Annuler")}</button>
      </form>
      <p className="text-xs text-dim">{tx("Ping, ports connus, nom DNS, SSH (Linux ou Windows), Docker, AdGuard, VM, services web : quelques secondes. Rien n'est écrit avant « Enregistrer ».")}</p>
      <NoteLine note={note} />
      {d && <Proposal d={d} st={st} onDone={onDone} />}
    </div>
  );
}

function Proposal({ d, st, onDone }: { d: Detection; st: State; onDone: () => void }) {
  const [web, setWeb] = useState<number[]>([]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>{d.ip}</b>{d.dns && <Dim>{d.dns}</Dim>}
        <Badge tone={d.up ? "ok" : "warn"}>{d.up ? tx("répond au ping") : tx("ne répond pas au ping")}</Badge>
        {d.alias && <Badge tone="info">{tx("alias")} {d.alias}</Badge>}
        {d.known && <Badge tone="off">{tx("déjà déclarée : réglages gardés")}</Badge>}
        {d.hints.map((h) => <Badge key={h} tone="off">{h}</Badge>)}
      </div>
      {d.notes.map((n, i) => <p key={i} className={`text-sm ${n.startsWith("✓") ? "text-ok" : "text-warn"}`}>{n}</p>)}
      {d.connectors.length > 0 && (
        <p className="text-sm text-muted">
          {tx("Services reconnus, à ajouter dans Réglages → Connecteurs (compte ou clé lecture seule) :")}{" "}
          {d.connectors.map((c) => <span key={c.type} className="mr-2"><b className="text-txt">{c.label}</b>{c.proposed.url && <Dim> {c.proposed.url}</Dim>}</span>)}
        </p>
      )}
      {d.web.length > 0 && (
        <div className="text-sm">
          <span className="text-muted">{tx("Services web à suivre (sans SSH : sinon seulement le ping) :")}</span>
          {d.web.map((w) => (
            <label key={w.port} className="ml-3 inline-flex items-center gap-1.5">
              <input type="checkbox" checked={web.includes(w.port)} onChange={() => setWeb(web.includes(w.port) ? web.filter((x) => x !== w.port) : [...web, w.port])} />
              {w.scheme}://{d.ip}:{w.port} <Dim>({w.label})</Dim>
            </label>
          ))}
        </div>
      )}
      <MachineForm ip={d.ip} m={d.machine} st={st} isNew={!d.known} extra={d.web.filter((w) => web.includes(w.port))} onDone={onDone} />
    </div>
  );
}

function MachineRow({ ip, m, st, live, statuses, reload }: {
  ip: string; m: MachineConf; st: State; live?: Snapshot["data"]["machine_list"][number]; statuses: NonNullable<Snapshot["data"]["connectors"]>; reload: () => void;
}) {
  const [open, setOpen] = useState(false), [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<Note>(null), [lines, setLines] = useState<string[] | null>(null), [busy, setBusy] = useState(false);
  const state = live ? MSTATE[mState(live)] : null;
  const verify = async () => {
    setBusy(true); setLines(null);
    try {
      const r = await send<{ lines: string[]; failed: number }>("POST", `machines/settings/${ip}/check`);
      setLines(r.lines);
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  const access = m.os === "windows" ? tx("Windows · santé par {0}", m.health) : m.ssh ? `SSH ${m.ssh}` : tx("sans SSH");
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-xl border border-line bg-card text-sm">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl p-3 text-left hover:bg-bg2">
        <Chevron size={14} className="text-dim" /><b>{m.name}</b><Dim>{ip}</Dim>
        <span className="ml-auto flex items-center gap-1.5">
          {m.off && <Badge tone="off">{tx("souvent éteinte")}</Badge>}
          {live && sshWarn(live) && <Badge tone="warn" title={tx("sshd : root ou mot de passe autorisé")}>{tx("sshd")}</Badge>}
          {statuses.some((c) => !c.ok) && <Badge tone="bad">{statuses.filter((c) => !c.ok).length} {tx("en échec")}</Badge>}
          {state && <Badge tone={state[0]} title={state[2]}>{state[1]}</Badge>}
        </span>
        {!open && <span className="basis-full truncate pl-5 text-xs text-dim">{[m.role, (live && sshBrief(live)) || access, st.process_hosts[ip] ? tx("process lus") : null].filter(Boolean).join(" · ")}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          {live && (
            <section className="rounded-lg border border-line/60 bg-bg2/40 p-2.5">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-dim">{tx("SSH, relevé par la collecte")}</h4>
              <SshDetails m={live} statuses={statuses} />
            </section>
          )}
          <MachineForm ip={ip} m={m} st={st} process={!!st.process_hosts[ip]} onDone={reload} />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={quiet} disabled={busy} onClick={() => void verify()}><ShieldCheck size={14} />{busy ? tx("Vérification…") : tx("Vérifier")}</button>
            {confirm ? <>
              <button type="button" className={danger} onClick={() => void act(() => send("DELETE", `machines/settings/${ip}`), tx("machine retirée"), setNote).then((ok) => ok && reload())}>{tx("Confirmer le retrait")}</button>
              <button type="button" className={quiet} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
            </> : <button type="button" className={danger} onClick={() => setConfirm(true)}><Trash2 size={14} />{tx("Retirer")}</button>}
          </div>
          {lines && (
            <ul className="rounded-lg bg-bg2 p-2 font-mono text-xs">
              {lines.map((l, i) => <li key={i} className={l.startsWith("✓") ? "text-ok" : l.startsWith("✗") ? "text-bad" : "text-warn"}>{l}</li>)}
            </ul>
          )}
          <NoteLine note={note} />
        </div>
      )}
    </div>
  );
}

function MachineForm({ ip, m, st, isNew, process, extra, onDone }: {
  ip: string; m: MachineConf; st: State; isNew?: boolean; process?: boolean; extra?: Detection["web"]; onDone: () => void;
}) {
  const [v, setV] = useState<MachineConf>(m);
  const [proc, setProc] = useState(!!process);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const windows = v.os === "windows";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(() => send("PUT", `machines/settings/${ip}`, { machine: v, process: windows ? null : proc, extra: extra || [] }),
      isNew ? tx("machine ajoutée : relevée au prochain passage de la collecte") : tx("enregistrée : prise en compte au prochain passage"), setNote);
    setBusy(false);
    if (ok) setTimeout(onDone, 900);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tx("Nom")}><input className={input} required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label={tx("Rôle (libre)")}><input className={input} maxLength={80} value={v.role || ""} onChange={(e) => setV({ ...v, role: e.target.value })} /></Field>
        {windows ? (
          <Field label={tx("Alias SSH de la santé (Windows)")}>
            <input className={input} value={String(v.health || "")} onChange={(e) => setV({ ...v, health: e.target.value })} list="ssh-aliases-f" />
          </Field>
        ) : (
          <Field label={tx("Alias SSH (inventaire Docker, santé)")}>
            <select className={input} value={v.ssh || ""} onChange={(e) => setV({ ...v, ssh: e.target.value || null })}>
              <option value="">{tx("aucun : ping et services web seulement")}</option>
              {st.aliases.map((a) => <option key={a.alias} value={a.alias}>{a.alias} · {a.user ? `${a.user}@` : ""}{a.ip || a.host}{a.port ? `:${a.port}` : ""}</option>)}
            </select>
          </Field>
        )}
        <datalist id="ssh-aliases-f">{st.aliases.map((a) => <option key={a.alias} value={a.alias} />)}</datalist>
        {!windows && v.ssh && (
          <Field label={tx("AdGuard Home (conteneur ou chemin du .yaml)")}>
            <input className={input} maxLength={80} value={v.adguard || ""} placeholder={tx("aucun")} onChange={(e) => setV({ ...v, adguard: e.target.value })} />
          </Field>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {FLAGS.map((f) => (
          <label key={f.k} className="flex items-start gap-2">
            <Switch on={!!v[f.k]} onChange={(on) => setV({ ...v, [f.k]: on })} label={f.label} />
            <span>{f.label} <Dim>· {f.help}</Dim></span>
          </label>
        ))}
        {!windows && v.ssh && (
          <label className="flex items-start gap-2">
            <Switch on={proc} onChange={setProc} label={tx("Lire les services hors Docker")} />
            <span>{tx("Lire les services hors Docker")} <Dim>{tx("· ports en écoute (ss -tlnp, root requis sur la machine)")}</Dim></span>
          </label>
        )}
      </div>
      <div><button className={primary} disabled={busy}>{isNew ? tx("Enregistrer la machine") : tx("Enregistrer")}</button></div>
      <NoteLine note={note} />
    </form>
  );
}
