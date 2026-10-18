// Adding a machine (Settings → Machines, and the assistant): one frame, four steps top to bottom, one open at a time.
// 1 target and detection, 2 what was found, 3 access (SSH, agent or none), 4 identity and options. Nothing is written
// before the final button, except the SSH alias prepared for the test, which is removed again if the add is cancelled.
import { Ban, Check, KeyRound, MonitorUp, Pencil, Radar } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Copyable, Field, NoteLine, Switch, TagInput } from "./form";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Dim } from "./ui";
import { tx } from "../lib/i18n";
import { authorizeFor, homeOf } from "../lib/ssh";
import { pokeScan } from "../lib/scan";
import type { Detection, MachineConf, MachinesSettings as State, SystemState } from "../types";
import { InfoNote } from "./InfoNote";
import { IconChoice } from "./IconChoice";
import { IconPicker } from "./IconPicker";
import { MachineIcon } from "./MachineIcon";
import { AgentBlock } from "../tabs/Agents";

type Access = "ssh" | "agent" | "none";
type Kind = "linux" | "windows";
type Step = 1 | 2 | 3 | 4;

const OPTIONS: { k: keyof MachineConf; label: string; help: string }[] = [
  { k: "off", label: tx("Souvent éteinte"), help: tx("PC, portable : pas d'alerte si elle ne répond pas") },
  { k: "gateway", label: tx("Passerelle"), help: tx("box / routeur : sous-titre de la page") },
  { k: "npm", label: tx("Héberge NPM"), help: tx("sous-titre de la page") },
  { k: "npm_only", label: tx("Joignable seulement par NPM"), help: tx("pare-feu : ses services sont testés via NPM") },
  { k: "vm", label: tx("Machine virtuelle"), help: tx("pas de SMART ni de température du processeur : rien de réel à lire") },
];

/** Access to offer first, from the detection: a working alias gives SSH, a Windows PC without one gives the agent, nothing open gives none */
function defaultAccess(d: Detection, kind: Kind): Access {
  const m = d.machine;
  if (typeof m.ssh === "string" || typeof m.health === "string") return "ssh";
  if (kind === "windows") return "agent";
  return d.hints.includes("SSH") || !!d.alias ? "ssh" : "none";
}

function guessKind(d: Detection): Kind {
  return d.machine.os === "windows" || d.hints.some((h) => h.startsWith("Windows")) ? "windows" : "linux";
}

/** Colour of one line of the access check: ✓ ok, ✗ failed, anything else a warning */
function lineTone(l: string): string {
  if (l.startsWith("✓")) return "text-ok";
  return l.startsWith("✗") ? "text-bad" : "text-warn";
}

function onError(e: unknown, set: (n: Note) => void) {
  if (e instanceof LoginRequired) location.replace(LOGIN);
  else set({ ok: false, text: (e as Error).message });
}

/* ---- frame ---- */

export function AddMachine({ st, onDone, onCancel }: Readonly<{ st: State; onDone: () => void; onCancel: () => void }>) {
  const [step, setStep] = useState<Step>(1);
  const [d, setD] = useState<Detection | null>(null);
  const [web, setWeb] = useState<number[]>([]);
  const [kind, setKind] = useState<Kind>("linux");
  const [access, setAccess] = useState<Access>("none");
  const [alias, setAlias] = useState<string | null>(null);       // SSH access prepared or found for this IP
  const [created, setCreated] = useState(false);                  // alias written by this frame: removed if the add is cancelled
  const [v, setV] = useState<MachineConf>({ name: "" });
  const [proc, setProc] = useState(false);
  const [added, setAdded] = useState(false);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);

  const detected = (res: Detection) => {
    const k = guessKind(res);
    setD(res); setWeb([]); setKind(k); setAccess(defaultAccess(res, k)); setAlias(res.alias); setCreated(false);
    setV({ ...res.machine, name: res.machine.name || res.dns || res.ip });
    setProc(false);
    setStep(2);
  };
  const cancel = async () => {
    if (created && d && !added) await send("DELETE", `machines/ssh-alias/${d.ip}`).catch(() => undefined);
    onCancel();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!d) return;
    setBusy(true);
    const windows = kind === "windows";
    const machine: MachineConf = { ...v, os: windows ? "windows" : undefined, ssh: null, health: undefined };
    if (access === "ssh" && alias) { if (windows) machine.health = alias; else machine.ssh = alias; }
    if (access === "none") machine.ssh = false;
    const body = { machine, process: windows ? null : proc, extra: d.web.filter((w) => web.includes(w.port)) };
    const ok = await act(() => send("PUT", `machines/settings/${d.ip}`, body), tx("machine ajoutée : relevé et santé lancés"), setNote);
    setBusy(false);
    if (!ok) return;
    void send("POST", `machines/settings/${d.ip}/refresh`).then(pokeScan, () => undefined);
    setAdded(true);
  };
  if (added && d) return <Added d={d} name={v.name} kind={kind} agent={access === "agent"} onDone={onDone} />;
  const edit = (s: Step) => (step > s && !busy ? () => setStep(s) : undefined);
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-bg2/40 p-3" aria-label={tx("Nouvelle machine")}>
      <StepShell n={1} step={step} title={tx("Cible")} summary={d && <TargetSummary d={d} />} onEdit={edit(1)}>
        <TargetStep st={st} onDetected={detected} />
      </StepShell>
      {d && <>
        <StepShell n={2} step={step} title={tx("Ce qui a été trouvé")} summary={<FoundSummary d={d} web={web} />} onEdit={edit(2)}>
          <FoundStep d={d} web={web} setWeb={setWeb} onNext={() => setStep(3)} />
        </StepShell>
        <StepShell n={3} step={step} title={tx("Accès")} summary={<AccessSummary access={access} alias={alias} kind={kind} />} onEdit={edit(3)}>
          <AccessStep d={d} st={st} kind={kind} setKind={setKind} access={access} setAccess={setAccess} alias={alias}
            onAlias={(a, isNew) => { setAlias(a); if (isNew) setCreated(true); }} onNext={() => setStep(4)} />
        </StepShell>
        <StepShell n={4} step={step} title={tx("Identité et options")} summary={null}>
          <IdentityStep d={d} v={v} setV={setV} proc={proc} setProc={setProc} ssh={access === "ssh" && kind === "linux"} />
        </StepShell>
      </>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {step === 4 && <button type="submit" className={primary} disabled={busy || !v.name.trim()}><Check size={14} aria-hidden />{busy ? tx("Enregistrement…") : tx("Ajouter la machine")}</button>}
        <button type="button" className={quiet} disabled={busy} onClick={() => void cancel()}>{tx("Annuler")}</button>
        <NoteLine note={note} />
      </div>
    </form>
  );
}

/** One step: number, title, then the body (current step) or a one-line summary with « Modifier » (done step) */
function StepShell({ n, step, title, summary, onEdit, children }: Readonly<{ n: Step; step: Step; title: string; summary: ReactNode; onEdit?: () => void; children: ReactNode }>) {
  const current = step === n, done = step > n;
  const bubble = current ? "bg-link text-white" : done ? "bg-ok/15 text-ok" : "bg-bg2 text-dim";
  return (
    <section aria-current={current ? "step" : undefined} className={`rounded-lg border p-3 ${current ? "border-link/60 bg-card" : "border-line/60"} ${!current && !done ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${bubble}`}>{done ? <Check size={13} /> : n}</span>
        <b className="text-sm">{title}</b>
        {done && <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs text-muted">{summary}</span>}
        {done && onEdit && <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline" onClick={onEdit}><Pencil size={12} aria-hidden />{tx("Modifier")}</button>}
      </div>
      {current && <div className="mt-3 flex flex-col gap-3">{children}</div>}
    </section>
  );
}

/* ---- step 1: target ---- */

function TargetStep({ st, onDetected }: Readonly<{ st: State; onDetected: (d: Detection) => void }>) {
  const [target, setTarget] = useState("");
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const run = async () => {
    if (!target.trim()) return;
    setBusy(true); setNote(null);
    try { onDetected(await send<Detection>("POST", `machines/detect?target=${encodeURIComponent(target.trim())}`)); } catch (e) { onError(e, setNote); }
    setBusy(false);
  };
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={tx("IP, nom ou alias SSH")}>
          <input className={`${input} min-w-[260px]`} list="ssh-aliases" required autoFocus value={target} placeholder={tx("ex. 192.168.1.20 ou nas")}
            onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } }} />
          <datalist id="ssh-aliases">{st.aliases.map((a) => <option key={a.alias} value={a.alias}>{a.ip || a.host}</option>)}</datalist>
        </Field>
        <button type="button" className={primary} disabled={busy || !target.trim()} onClick={() => void run()}><Radar size={14} aria-hidden />{busy ? tx("Détection…") : tx("Détecter")}</button>
      </div>
      <p className="text-xs text-dim">{tx("Lecture seule : ping, nom DNS, ports connus, SSH, Docker, AdGuard, machine virtuelle, services web. Quelques secondes, rien n'est écrit.")}</p>
      <NoteLine note={note} />
    </>
  );
}

function TargetSummary({ d }: Readonly<{ d: Detection }>) {
  return (
    <>
      <b className="text-txt">{d.ip}</b>{d.dns && <Dim>{d.dns}</Dim>}
      <Badge tone={d.up ? "ok" : "warn"}>{d.up ? tx("répond au ping") : tx("ne répond pas au ping")}</Badge>
      {d.known && <Badge tone="off">{tx("déjà déclarée : réglages gardés")}</Badge>}
    </>
  );
}

/* ---- step 2: what was found ---- */

function FoundStep({ d, web, setWeb, onNext }: Readonly<{ d: Detection; web: number[]; setWeb: (w: number[]) => void; onNext: () => void }>) {
  const toggle = (port: number) => setWeb(web.includes(port) ? web.filter((x) => x !== port) : [...web, port]);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <TargetSummary d={d} />
        {d.alias && <Badge tone="off">{tx("alias")} {d.alias}</Badge>}
        {d.hints.map((h) => <Badge key={h} tone="off" outline>{h}</Badge>)}
      </div>
      {d.notes.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm">
          {d.notes.map((n) => <li key={n} className={n.startsWith("✓") ? "text-ok" : "text-warn"}>{n}</li>)}
        </ul>
      )}
      {d.connectors.length > 0 && (
        <InfoNote>
          {tx("Services reconnus, à ajouter ensuite dans Réglages → Connecteurs :")}{" "}
          {d.connectors.map((c) => <span key={c.type} className="mr-2"><b className="text-txt">{c.label}</b>{c.proposed.url && <Dim> {c.proposed.url}</Dim>}</span>)}
        </InfoNote>
      )}
      {d.web.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{tx("Services web à suivre :")}</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {d.web.map((w) => (
              <label key={w.port} className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={web.includes(w.port)} onChange={() => toggle(w.port)} />
                <span className="font-mono text-xs">{w.scheme}://{d.ip}:{w.port}</span> <Dim>({w.label})</Dim>
              </label>
            ))}
          </div>
        </div>
      )}
      {d.notes.length === 0 && d.web.length === 0 && <p className="text-sm text-dim">{tx("Rien de plus que le ping : la machine pourra être lue par SSH ou par un agent, à choisir à l'étape suivante.")}</p>}
      <div><button type="button" className={primary} onClick={onNext}>{tx("Continuer")}</button></div>
    </>
  );
}

function FoundSummary({ d, web }: Readonly<{ d: Detection; web: number[] }>) {
  const bits = [...d.hints, ...(d.notes.filter((n) => n.startsWith("✓")).map((n) => n.slice(1).split(":")[0].trim()))];
  return (
    <>
      {bits.slice(0, 5).map((b) => <Badge key={b} tone="off" outline>{b}</Badge>)}
      {web.length > 0 && <Dim>{tx("{0} service(s) web suivi(s)", web.length)}</Dim>}
      {bits.length === 0 && web.length === 0 && <Dim>{tx("rien de plus que le ping")}</Dim>}
    </>
  );
}

/* ---- step 3: access ---- */

function AccessStep({ d, st, kind, setKind, access, setAccess, alias, onAlias, onNext }: Readonly<{
  d: Detection; st: State; kind: Kind; setKind: (k: Kind) => void; access: Access; setAccess: (a: Access) => void;
  alias: string | null; onAlias: (alias: string, created: boolean) => void; onNext: () => void;
}>) {
  const options = [
    { value: "ssh" as const, label: "SSH", hint: tx("Lire la machine par SSH avec la clé de l'app (Docker, santé, système)"), icon: <KeyRound size={24} className={access === "ssh" ? "text-link" : "text-dim"} aria-hidden /> },
    { value: "agent" as const, label: tx("Agent"), hint: tx("Un petit script sur la machine envoie sa santé à MyServices (PC Windows, ou SSH impossible)"), icon: <MonitorUp size={24} className={access === "agent" ? "text-link" : "text-dim"} aria-hidden /> },
    { value: "none" as const, label: tx("Aucun"), hint: tx("Ping et services web seulement"), icon: <Ban size={24} className={access === "none" ? "text-link" : "text-dim"} aria-hidden /> },
  ];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tx("Système de la machine")}>
        <span className="text-xs font-semibold uppercase tracking-wide text-dim">{tx("Système")}</span>
        {(["linux", "windows"] as Kind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); if (access === "ssh" && !alias && k === "windows") setAccess("agent"); }}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${kind === k ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>
            {k === "windows" ? "Windows" : "Linux"}{k === guessKind(d) && <span className="ml-1 font-normal text-dim">{tx("(détecté)")}</span>}
          </button>
        ))}
      </div>
      <IconChoice label={tx("Accès")} value={access} options={options} onPick={setAccess} />
      {access === "ssh" && <SshSetup d={d} st={st} kind={kind} alias={alias} onAlias={onAlias} />}
      {access === "agent" && <InfoNote>{tx("L'agent s'installe en collant une commande sur la machine : elle vous sera donnée juste après l'ajout, avec son jeton.")}</InfoNote>}
      {access === "none" && <InfoNote>{tx("Sans accès, MyServices ne fait que pinger la machine et tester ses services web. Vous pourrez activer SSH ou un agent plus tard dans sa carte.")}</InfoNote>}
      <div><button type="button" className={primary} onClick={onNext}>{tx("Continuer")}</button></div>
    </>
  );
}

/** SSH: account and port, the app key to authorize on the machine, then « Préparer et tester » (alias written, connection checked) */
function SshSetup({ d, st, kind, alias, onAlias }: Readonly<{ d: Detection; st: State; kind: Kind; alias: string | null; onAlias: (alias: string, created: boolean) => void }>) {
  const known = st.aliases.find((a) => a.ip === d.ip);
  const handWritten = !!alias && !alias.startsWith("m-");
  const [user, setUser] = useState(known?.user || "root"), [port, setPort] = useState(String(known?.port || 22));
  const [authorize, setAuthorize] = useState(""), [esxiKey, setEsxiKey] = useState<string | null>(null);
  const [lines, setLines] = useState<string[] | null>(null), [failed, setFailed] = useState<boolean | null>(null);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  useEffect(() => { read<SystemState>("system").then((s) => { setAuthorize(s.ssh.authorize ?? ""); setEsxiKey(s.ssh.public_esxi ?? null); }).catch(() => undefined); }, []);
  const userOk = /^[a-z_][a-z0-9_.-]{0,31}$/.test(user), portN = Number(port), portOk = Number.isInteger(portN) && portN >= 1 && portN <= 65535;
  const test = async () => {
    setBusy(true); setNote(null); setLines(null); setFailed(null);
    try {
      if (!handWritten) {
        const r = await send<{ alias: string; created: boolean }>("POST", "machines/ssh-alias", { ip: d.ip, user, port: portN });
        onAlias(r.alias, r.created);
      }
      const r = await send<{ lines: string[]; failed: number }>("POST", "machines/ssh-alias/test", { ip: d.ip, windows: kind === "windows" });
      setLines(r.lines); setFailed(r.failed > 0);
    } catch (e) { onError(e, setNote); }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line/60 bg-bg2/60 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={tx("Compte SSH")}><input className={`${input} w-40`} maxLength={32} value={user} disabled={handWritten} autoComplete="off" onChange={(e) => setUser(e.target.value.trim())} /></Field>
        <Field label={tx("Port SSH")}><input className={`${input} w-28`} type="number" min={1} max={65535} value={port} disabled={handWritten} onChange={(e) => setPort(e.target.value)} /></Field>
        <button type="button" className={quiet} disabled={busy || !userOk || !portOk} onClick={() => void test()}>
          <KeyRound size={14} aria-hidden />{busy ? tx("Test…") : tx("Tester la connexion")}
        </button>
        {failed === false && <Badge tone="ok">{tx("connexion OK")}</Badge>}
        {failed === true && <Badge tone="warn">{tx("connexion refusée")}</Badge>}
      </div>
      {handWritten
        ? <Dim>{tx("Accès « {0} » écrit à la main dans la config SSH de l'app : compte et port se changent là.", alias)}</Dim>
        : <Dim>{tx("root par défaut ; un compte dédié du groupe docker est plus sûr. Le test écrit cet accès dans la config SSH de l'app, retiré si vous annulez.")}</Dim>}
      {kind === "linux" && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{tx("Sur la machine, en root ou avec ce compte, autorisez la clé de l'app dans")} <code className="font-mono text-xs text-txt">{homeOf(user || "root")}/.ssh/authorized_keys</code> :</span>
          {authorize ? <Copyable text={authorizeFor(authorize, user, esxiKey)} /> : <span className="text-warn">{tx("Clé de l'app introuvable : voir")} <a className="underline hover:text-txt" href="#settings/ssh">{tx("Réglages → Clé SSH")}</a>.</span>}
        </div>
      )}
      {kind === "windows" && <InfoNote>{tx("Windows par SSH : OpenSSH Server doit être installé et la clé de l'app autorisée pour ce compte. Sans serveur SSH, préférez l'agent.")}</InfoNote>}
      {lines && (
        <ul className="rounded-lg bg-bg2 p-2 font-mono text-xs">
          {lines.map((l) => <li key={l} className={lineTone(l)}>{l}</li>)}
        </ul>
      )}
      <NoteLine note={note} />
    </div>
  );
}

function AccessSummary({ access, alias, kind }: Readonly<{ access: Access; alias: string | null; kind: Kind }>) {
  const sys = kind === "windows" ? "Windows" : "Linux";
  if (access === "ssh") return <><Badge tone="off" outline>{sys}</Badge><Dim>SSH{alias ? ` · ${alias}` : ""}</Dim></>;
  if (access === "agent") return <><Badge tone="off" outline>{sys}</Badge><Dim>{tx("agent (à installer après l'ajout)")}</Dim></>;
  return <><Badge tone="off" outline>{sys}</Badge><Dim>{tx("ping et services web seulement")}</Dim></>;
}

/* ---- step 4: identity and options ---- */

function IdentityStep({ d, v, setV, proc, setProc, ssh }: Readonly<{ d: Detection; v: MachineConf; setV: (v: MachineConf) => void; proc: boolean; setProc: (on: boolean) => void; ssh: boolean }>) {
  const found = new Set(d.detected ?? []);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tx("Nom")}><input className={input} required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <TagInput label={tx("Rôle (étiquettes)")} value={v.role || ""} suggestions={d.hints} placeholder={tx("ex. Docker, NAS…")} onChange={(role) => setV({ ...v, role })} />
      </div>
      <div>
        <div className="mb-1 text-sm text-muted">{tx("Icône")}</div>
        <IconPicker value={v.icon as string | undefined} autoHint={tx("appli reconnue, sinon système")} onPick={(icon) => setV({ ...v, icon })}
          auto={<MachineIcon large m={{ name: v.name, role: v.role, os: v.os as string | undefined }} empty={<span className="text-xs font-semibold text-dim">{tx("Auto")}</span>} />} />
      </div>
      <ul className="flex flex-col divide-y divide-line/40 rounded-lg border border-line/60 bg-bg2/60 px-3">
        <OptionRow on={!v.disabled} onChange={(on) => setV({ ...v, disabled: !on })} label={tx("Machine suivie")} help={tx("pingée et lue pour la santé et les alertes")} />
        {OPTIONS.map((o) => (
          <OptionRow key={String(o.k)} on={!!v[o.k]} onChange={(on) => setV({ ...v, [o.k]: on })} label={o.label} help={o.help} detected={found.has(String(o.k))} />
        ))}
        {ssh && <OptionRow on={proc} onChange={setProc} label={tx("Lire les services hors Docker")} help={tx("ports en écoute sur la machine (ss -tlnp, root requis)")} />}
      </ul>
    </>
  );
}

function OptionRow({ on, onChange, label, help, detected }: Readonly<{ on: boolean; onChange: (on: boolean) => void; label: string; help: string; detected?: boolean }>) {
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <Switch on={on} onChange={onChange} label={label} />
      <span className="min-w-0 flex-1"><b>{label}</b> {detected && <Badge tone="info" title={tx("Trouvé par la détection : décochez si c'est faux")}>{tx("détecté")}</Badge>} <Dim>· {help}</Dim></span>
    </li>
  );
}

/* ---- after the add ---- */

function Added({ d, name, kind, agent, onDone }: Readonly<{ d: Detection; name: string; kind: Kind; agent: boolean; onDone: () => void }>) {
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-bg2/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-ok/15 text-ok"><Check size={14} /></span>
        <b>{tx("Machine ajoutée")}</b><Dim>{name} · {d.ip}</Dim>
        <Dim>{tx("relevé et santé lancés : sa carte apparaît dans la liste")}</Dim>
      </div>
      {agent && <AgentBlock ip={d.ip} name={name} kind={kind} onChanged={() => undefined} />}
      <div><button type="button" className={primary} onClick={onDone}>{tx("Fermer")}</button></div>
    </div>
  );
}
