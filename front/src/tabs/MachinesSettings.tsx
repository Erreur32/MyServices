// Réglages → Machines : équivalent graphique de « setup.py --add ». Détecter (IP, nom ou alias SSH : ping,
// ports, SSH Linux / Windows, Docker, AdGuard, VM, services web, connecteurs reconnus), relire la proposition,
// enregistrer ; modifier, vérifier (mêmes contrôles que setup.py --check) ou retirer une machine déclarée.
// Chaque carte porte aussi l'accès SSH relevé par la collecte (résumé plié, détail déplié) : tout ce qui touche une
// machine est ici ; Connecteurs ne garde que les services lus par leur API.
import { Check, ChevronDown, ChevronRight, Loader2, Plus, Radar, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { Field, NoteLine, Switch } from "../components/form";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Dim } from "../components/ui";
import { ipNum } from "../lib/format";
import type { Detection, MachineConf, MachinesSettings as State, NetHost, NetScan } from "../types";
import { DISMISSED_KEY } from "../lib/firstSteps";
import { needsLink } from "../lib/netScan";
import { MachineIcon } from "../components/MachineIcon";
import { MSTATE, mState, osOfMachine } from "../lib/machines";
import { AuthorizeKey } from "../components/AuthorizeKey";
import { SshGuide } from "../components/SshGuide";
import { SshDetails } from "../components/ssh";
import { sshBrief, sshWarn } from "../lib/ssh";
import { tx } from "../lib/i18n";

const FLAGS: { k: keyof MachineConf; label: string; help: string }[] = [
  { k: "off", label: tx("Souvent éteinte"), help: tx("PC, portable : pas d'alerte si elle ne répond pas") },
  { k: "gateway", label: tx("Passerelle"), help: tx("box / routeur : sous-titre de la page") },
  { k: "npm", label: tx("Héberge NPM"), help: tx("sous-titre de la page") },
  { k: "npm_only", label: tx("Joignable seulement par NPM"), help: tx("pare-feu : ses services sont testés via NPM") },
  { k: "vm", label: tx("Machine virtuelle"), help: tx("la santé n'y lit pas SMART") },
];

export function MachinesSettings({ snap, focusIp }: { snap: Snapshot; focusIp?: string }) {
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [detecting, setDetecting] = useState(false);
  // Système vu par le dernier scan du réseau, pour les machines que le SSH ne renseigne pas (suggestion)
  const [scanOs, setScanOs] = useState<Record<string, { os?: string; apps: string[]; ssh?: boolean }>>({});
  const [hosts, setHosts] = useState<NetHost[]>([]);
  useEffect(() => { read<NetScan>("network/scan").then((n) => { setHosts(n.found || []); setScanOs(Object.fromEntries((n.found || []).map((h) => [h.ip, { os: h.os ?? undefined, apps: h.apps ?? [], ssh: !!h.ssh_port }]))); }).catch(() => undefined); }, []);
  const reload = useCallback(() => {
    read<State>("machines/settings")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);
  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  const live = new Map((snap.data.machine_list || []).map((m) => [m.ip, m]));
  // « Non terminé » : accès encore à régler (SSH absent alors que la machine l'offre, jeton Home Assistant manquant). Ceux que l'on
  // a fait « Passer » dans les premiers pas le sont forcément : on le dit aussi ici, pour ne pas les oublier.
  let passed: string[] = [];
  try { passed = JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]") as string[]; } catch { /* mémoire du navigateur illisible */ }
  const asMachines = Object.entries(st.machines).map(([ip, c]) => ({ ip, ssh: c.ssh ?? (typeof c.health === "string" ? c.health : null) }));
  const unfinished: Record<string, { why: "ha" | "ssh"; passed: boolean }> = {};
  for (const h of hosts) {
    if (!st.machines[h.ip] || st.machines[h.ip].disabled) continue;
    const why = needsLink(h, asMachines, snap.data.services_status ?? []);
    if (why) unfinished[h.ip] = { why, passed: passed.includes(h.ip) };
  }
  const ips = Object.keys(st.machines).sort((a, b) => ipNum(a) - ipNum(b));
  return (
    <div className="flex flex-col gap-4">
      <div id="authorize-key" className="scroll-mt-24"><AuthorizeKey failing={(snap.data.connectors || []).filter((c) => c.type === "docker" && !c.ok)} /></div>
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
          return <MachineRow key={ip} unfinished={unfinished[ip]} scan={scanOs[ip]} focus={ip === focusIp} ip={ip} m={st.machines[ip]} st={st} live={lm} statuses={stat} reload={reload} />;
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
      <MachineForm ip={d.ip} m={d.machine} st={st} isNew={!d.known} detected={[...(d.detected ?? []), ...(d.machine.off && !d.known ? ["off"] : [])]} extra={d.web.filter((w) => web.includes(w.port))} onDone={onDone} />
    </div>
  );
}

function MachineRow({ ip, m, st, live, statuses, reload, focus, scan, unfinished }: {
  unfinished?: { why: "ha" | "ssh"; passed: boolean }; scan?: { os?: string; apps: string[]; ssh?: boolean }; focus?: boolean; ip: string; m: MachineConf; st: State; live?: Snapshot["data"]["machine_list"][number]; statuses: NonNullable<Snapshot["data"]["connectors"]>; reload: () => void;
}) {
  const [open, setOpen] = useState(!!focus), [confirm, setConfirm] = useState(false);  // focus : arrivée depuis un lien (Connecteurs → machine)
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus) card.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focus]);
  const [note, setNote] = useState<Note>(null), [lines, setLines] = useState<string[] | null>(null), [busy, setBusy] = useState(false);
  const linesTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(linesTimer.current), []);
  const keyMissing = statuses.some((c) => c.type === "docker" && !c.ok);  // accès SSH activé, mais la clé de l'app n'est pas autorisée
  const goAuthorize = () => document.getElementById("authorize-key")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const state = live ? MSTATE[mState(live)] : null;
  const verify = async () => {
    setBusy(true); setLines(null);
    try {
      const r = await send<{ lines: string[]; failed: number }>("POST", `machines/settings/${ip}/check`);
      setLines(r.lines);
      clearTimeout(linesTimer.current);
      linesTimer.current = setTimeout(() => setLines(null), 15_000);  // résultat visible 15 s, puis il disparaît
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  const access = m.os === "windows" ? tx("Windows · santé par {0}", m.health) : m.ssh ? `SSH ${m.ssh}` : tx("sans SSH");
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div ref={card} className={`rounded-xl border bg-card text-sm ${m.disabled ? "opacity-60" : ""} ${focus ? "border-link shadow-[0_0_0_1px_rgb(var(--link))]" : "border-line"}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl p-3 text-left hover:bg-bg2">
        <Chevron size={14} className="text-dim" /><MachineIcon m={{ name: m.name, role: m.role, os: m.os, info: live?.info, ttl: live?.ttl }} scan={scan} reserve /><b>{m.name}</b><Dim>{ip}</Dim>
        <span className="ml-auto flex items-center gap-1.5">
          {keyMissing && (
            <span role="button" tabIndex={0} className="grid h-5 w-5 cursor-pointer place-items-center rounded-full bg-warn text-xs font-extrabold text-bg hover:brightness-110"
              title={tx("Docker illisible sur cette machine : la clé SSH de l'app n'y est pas encore autorisée. Cliquez pour voir la commande à lancer sur la machine.")}
              aria-label={tx("Action requise : autoriser la clé de l'app sur cette machine")}
              onClick={(e) => { e.stopPropagation(); goAuthorize(); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); goAuthorize(); } }}>!</span>
          )}
          {unfinished && <Badge tone="warn" title={unfinished.why === "ha" ? tx("Jeton Home Assistant manquant") : tx("Accès SSH à régler")}>{unfinished.passed ? tx("Non terminé (passé)") : tx("Non terminé")}</Badge>}
          {m.off && <Badge tone="off">{tx("souvent éteinte")}</Badge>}
          {live && sshWarn(live) && <Badge tone="warn" title={tx("sshd : root ou mot de passe autorisé")}>{tx("sshd")}</Badge>}
          {statuses.some((c) => !c.ok) && <Badge tone="bad">{statuses.filter((c) => !c.ok).length} {tx("en échec")}</Badge>}
          {m.disabled ? <Badge tone="off">{tx("non suivie")}</Badge> : state && <Badge tone={state[0]} title={state[2]}>{state[1]}</Badge>}
        </span>
        {!open && <span className="basis-full truncate pl-5 text-xs text-dim">{[m.role, (live && sshBrief(live)) || access, st.process_hosts[ip] ? tx("process lus") : null].filter(Boolean).join(" · ")}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <NoteLine note={note} />
          {lines && (
            <ul className="rounded-lg bg-bg2 p-2 font-mono text-xs">
              {lines.map((l, i) => <li key={i} className={l.startsWith("✓") ? "text-ok" : l.startsWith("✗") ? "text-bad" : "text-warn"}>{l}</li>)}
            </ul>
          )}
          {keyMissing && (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-muted">
              <b className="text-warn">!</b> {tx("Action requise : la clé SSH de l'app n'est pas autorisée sur cette machine, donc Docker n'est pas lisible.")}{" "}
              <button type="button" className="text-link hover:underline" onClick={goAuthorize}>{tx("Voir la commande à lancer")}</button>
            </p>
          )}
          {unfinished && (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-muted">
              <b className="text-warn">{tx("Non terminé")}</b>{unfinished.passed ? ` · ${tx("vous l'aviez passé dans les premiers pas")}` : ""} {" : "}
              {unfinished.why === "ha" ? <>{tx("le jeton de Home Assistant manque : ")}<a className="text-link hover:underline" href="#settings/connectors">{tx("Réglages → Connecteurs")}</a></>
                : tx("cette machine offre SSH mais MyServices n'y a pas d'accès : activez « Lecture par SSH » ci-dessous.")}
            </p>
          )}
          {live && (
            <section className="rounded-lg border border-line/60 bg-bg2/40 p-2.5">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-dim">{tx("SSH, relevé par la collecte")}</h4>
              <SshDetails m={live} statuses={statuses} />
            </section>
          )}
          <MachineForm report={setNote} ip={ip} m={m} st={st} live={live} windowsGuess={osOfMachine({ os: m.os, info: live?.info, ttl: live?.ttl }, scan?.os, scan?.ssh)?.kind === "windows"} process={!!st.process_hosts[ip]} onDone={reload} actions={<>
            <button type="button" className={quiet} disabled={busy} onClick={() => void verify()}><ShieldCheck size={14} />{busy ? tx("Vérification…") : tx("Vérifier")}</button>
            <span className="ml-auto flex items-center gap-1.5">
              {confirm ? <>
                <button type="button" className={danger} onClick={() => void act(() => send("DELETE", `machines/settings/${ip}`), tx("machine retirée"), setNote).then((ok) => ok && reload())}>{tx("Confirmer le retrait")}</button>
                <button type="button" className={quiet} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
              </> : <button type="button" className={danger} onClick={() => setConfirm(true)}><Trash2 size={14} />{tx("Retirer")}</button>}
            </span>
          </>} />
        </div>
      )}
    </div>
  );
}

/** Groupe d'interrupteurs : titre, éventuel rappel, interrupteurs en dessous */
function OptionGroup({ title, hint, tone, dim, children }: { title: string; hint?: string; tone?: "ok"; dim?: boolean; children: React.ReactNode }) {
  return (
    <fieldset className={`flex flex-col gap-1.5 rounded-lg border p-2.5 ${tone === "ok" ? "border-ok/40 bg-ok/5" : "border-line/60"} ${dim ? "bg-bg2/30" : ""}`}>
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-dim">{title}</legend>
      {hint && <p className="text-xs text-dim">{hint}</p>}
      {children}
    </fieldset>
  );
}

function MachineForm({ ip, m, st, isNew, process, extra, detected = [], live, actions, windowsGuess, report, onDone }: {
  report?: (n: Note) => void;  // dans une carte de machine : le message s'affiche en haut de la carte
  windowsGuess?: boolean;
  live?: Snapshot["data"]["machine_list"][number]; actions?: React.ReactNode; detected?: string[]; ip: string; m: MachineConf; st: State; isNew?: boolean; process?: boolean; extra?: Detection["web"]; onDone: () => void;
}) {
  const [v, setV] = useState<MachineConf>(m);
  const [proc, setProc] = useState(!!process);
  const [unlock, setUnlock] = useState(false);  // détection incomplète : débloque tous les interrupteurs
  const [hasAdguard] = useState(() => !!m.adguard);  // figé à l'ouverture : vider le champ ne le fait pas disparaître
  // Menu ouvert d'office dès qu'il y a quelque chose de détecté ou d'allumé à montrer ; les « non détectés » restent pliés
  const [options, setOptions] = useState(() => !!m.disabled || detected.length > 0 || (live?.detected?.length ?? 0) > 0 || FLAGS.some((f) => !!m[f.k]));
  const [missingOpen, setMissingOpen] = useState(false);
  const [sshOpen, setSshOpen] = useState(!!isNew);  // replié d'office ; ouvert à l'ajout d'une machine, où il faut choisir l'accès
  const [localNote, setLocalNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const setNote = report ?? setLocalNote;
  const windows = v.os === "windows";
  // Ce que l'accès choisi permet de lire (suit le formulaire, avant même l'enregistrement)
  const access = windows ? !!v.health : !!v.ssh, health = access && !v.off && v.health !== false;
  const gives: [string, boolean, string][] = [
    ["Docker", !windows && access, tx("Conteneurs, images, ports (onglet Services)")],
    [tx("Santé"), health, v.off ? tx("Souvent éteinte : la santé ne la lit pas") : tx("Disques, mémoire, CPU, systemd, mises à jour (onglet Santé)")],
    [tx("Système"), !windows && access, tx("Système, noyau, sshd, Apache (onglet Machines)")],
    ...(hasAdguard ? [["AdGuard Home", !windows && access, tx("Réécritures et réponses DNS (onglet DNS)")] as [string, boolean, string]] : []),
    [tx("Services en écoute"), !windows && access && proc, tx("Ports en écoute hors Docker (option ci-dessous)")],
  ];
  // Interrupteurs détectables (passerelle, VM, hôte NPM, poste Windows) : grisés si la détection ne les confirme pas et qu'ils
  // sont éteints. Un interrupteur déjà allumé reste modifiable (pour le retirer). Les autres (NPM seulement, services hors Docker)
  // ne se détectent pas : toujours libres.
  const found = new Set([...(live?.detected ?? []), ...detected]);
  const DETECTABLE = ["gateway", "vm", "npm", "off"];
  const locked = (k: string) => !unlock && DETECTABLE.includes(k) && !found.has(k) && !v[k as keyof MachineConf];
  const isOn = (k: string) => found.has(k) || !!v[k as keyof MachineConf];
  const detectedFlags = FLAGS.filter((f) => DETECTABLE.includes(String(f.k)) && isOn(String(f.k)));
  const missingFlags = FLAGS.filter((f) => DETECTABLE.includes(String(f.k)) && !isOn(String(f.k)));
  const manualFlags = FLAGS.filter((f) => !DETECTABLE.includes(String(f.k)));
  const flagRow = (f: (typeof FLAGS)[number]) => (
    <label key={String(f.k)} className={`flex items-start gap-2 ${locked(String(f.k)) ? "opacity-50" : ""}`}
      title={locked(String(f.k)) ? tx("Non détecté sur cette machine : grisé") : undefined}>
      <Switch on={!!v[f.k]} disabled={locked(String(f.k)) || pending === String(f.k)} onChange={(on) => void autoSave(String(f.k), { [f.k]: on })} label={f.label} />
      <span>{f.label} {found.has(String(f.k)) && <Badge tone="info" title={tx("Trouvé par la détection : décochez si c'est faux")}>{tx("détecté")}</Badge>} <Saved k={String(f.k)} /> <Dim>· {f.help}</Dim></span>
    </label>
  );
  // Machine déjà enregistrée : un interrupteur se sauvegarde tout seul (sans toucher aux champs texte en cours de saisie) ;
  // une coche « ✓ enregistré » s'anime à côté. À l'ajout (isNew), tout part avec « Enregistrer la machine ».
  const [saved, setSaved] = useState<MachineConf>(m), [savedProc, setSavedProc] = useState(!!process);
  const [flash, setFlash] = useState(""), [pending, setPending] = useState("");
  const autoSave = async (key: string, next: Partial<MachineConf>, nextProc = savedProc) => {
    if (isNew) { setV((x) => ({ ...x, ...next })); if (key === "proc") setProc(nextProc); return; }
    setPending(key);
    const machine = { ...saved, ...next };
    const ok = await act(() => send("PUT", `machines/settings/${ip}`, { machine, process: windows ? null : nextProc, extra: [] }), tx("enregistré"), (n) => setNote(n && !n.ok ? n : null));  // succès : seulement la coche animée ; erreur : message
    setPending("");
    if (!ok) return;
    setSaved(machine); setSavedProc(nextProc);
    setV((x) => ({ ...x, ...next })); if (key === "proc") setProc(nextProc);
    setFlash(key); setTimeout(() => setFlash((f) => (f === key ? "" : f)), 1800);
  };
  const Saved = ({ k }: { k: string }) => (pending === k ? <Loader2 size={13} className="animate-spin text-dim" aria-label={tx("enregistrement…")} />
    : flash === k ? <span className="saved-pop inline-flex items-center gap-1 text-xs font-semibold text-ok"><Check size={13} aria-hidden />{tx("enregistré")}</span> : null);
  // Accès SSH : un simple interrupteur. Actif = l'accès de cette IP (créé avec la clé de l'app s'il n'existe pas encore, compte root
  // port 22 comme « Lire cette machine par SSH »), inactif = on le retire. Le choix d'un autre compte se fait dans la config SSH.
  const [winGuide, setWinGuide] = useState(false);
  const key = (windows ? v.health : v.ssh) as string | null | undefined | false;
  const sshOn = typeof key === "string" && key !== "";
  const info = st.aliases.find((a) => a.alias === key);
  const sshWho = info ? `${info.user ? `${info.user}@` : ""}${info.ip || info.host}${info.port ? `:${info.port}` : ""}` : String(key || "");
  const toggleSsh = async (on: boolean) => {
    if (!on) { setWinGuide(false); return void autoSave("ssh", { ssh: null, health: undefined }); }
    if (windows || windowsGuess) return void setWinGuide(true);  // PC Windows : guide (compte Windows, OpenSSH), pas d'accès root par défaut
    setPending("ssh");
    try {
      const r = await send<{ alias: string; created: boolean }>("POST", "machines/ssh-alias", { ip });
      setPending("");
      await autoSave("ssh", windows ? { health: r.alias } : { ssh: r.alias });
      setWinGuide(true);  // Linux : commandes pour autoriser la clé de l'app (utile si l'installation n'avait pas été terminée)
    } catch (e) {
      setPending("");
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
  };
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
      <section>
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-dim">{tx("Identité")}</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tx("Nom")}><input className={input} required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label={tx("Rôle (libre)")}><input className={input} maxLength={80} value={v.role || ""} onChange={(e) => setV({ ...v, role: e.target.value })} /></Field>
        </div>
      </section>
      <section className="rounded-xl border border-line/60 bg-bg2/30 p-3">
        <button type="button" onClick={() => setSshOpen(!sshOpen)} aria-expanded={sshOpen} className="flex w-full flex-wrap items-center gap-2 text-left">
          {sshOpen ? <ChevronDown size={14} className="text-dim" aria-hidden /> : <ChevronRight size={14} className="text-dim" aria-hidden />}
          <h4 className="text-xs font-semibold uppercase tracking-wide text-dim">{tx("Accès SSH")}</h4>
          {live && <Badge tone={MSTATE[mState(live)][0]} title={MSTATE[mState(live)][2]}>{MSTATE[mState(live)][1]}</Badge>}
          {!sshOpen && <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            {sshOn && <code className="font-mono text-xs text-muted">{sshWho}</code>}
            {gives.filter(([, on]) => on).map(([label, , why]) => <Badge key={label} tone="ok" title={why}>✓ {label}</Badge>)}
          </span>}
        </button>
        {sshOpen && <div className="mt-2">
        <p className="mb-2 text-xs text-muted">
          {tx("Permet à MyServices de lire cette machine : Docker, santé, système, Apache.")} <b className="text-txt">{tx("Lecture seule")}</b>{tx(" : rien n'y est modifié.")}
          <span className="block text-dim">{tx("Sans accès : ping et services web seulement.")}</span>
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex min-w-[240px] flex-1 items-center gap-2.5 text-sm">
            <Switch on={sshOn} disabled={pending === "ssh"} onChange={(on) => void toggleSsh(on)} label={tx("Lecture par SSH")} />
            <span><b>{sshOn ? tx("Actif") : tx("Inactif")}</b> <Saved k="ssh" />
              <Dim> · {sshOn ? sshWho : tx("ping et services web seulement")}</Dim></span>
          </label>
          {sshOn && !winGuide && live && ["refused", "nossh"].includes(mState(live)) && (
            <button type="button" className="text-xs text-link hover:underline" onClick={() => setWinGuide(true)}>{tx("La connexion échoue ? Voir les commandes")}</button>
          )}
          <ul className="flex flex-wrap items-center justify-end gap-1.5" aria-label={tx("Ce que cet accès permet de lire")}>
            {gives.map(([label, on, why]) => (
              <li key={label} title={why}><Badge tone={on ? "ok" : "off"}>{on ? "✓" : "–"} {label}</Badge></li>
            ))}
          </ul>
        </div>
        {winGuide && <SshGuide ip={ip} os={windows || windowsGuess ? "windows" : "linux"} onCancel={() => setWinGuide(false)}
          onReady={async (alias) => { await autoSave("ssh", { os: "windows", health: alias, ssh: null }); setWinGuide(false); }} />}
        {!windows && v.ssh && hasAdguard && (  // seulement si AdGuard a été trouvé sur la machine (ou déjà réglé) : sinon rien à montrer
          <div className="mt-3 sm:max-w-[50%]">
            <Field label={tx("AdGuard Home trouvé (conteneur ou chemin du .yaml)")}>
              <input className={input} maxLength={80} value={v.adguard || ""} placeholder={tx("aucun")} onChange={(e) => setV({ ...v, adguard: e.target.value })} />
            </Field>
          </div>
        )}
        <p className="mt-1.5 text-xs text-dim">
          {tx("Un clic sur l'interrupteur prépare l'accès (compte root, port 22) avec la clé de l'app ; cette clé est à autoriser sur la machine : Réglages → Clé SSH.")}
        </p>
        </div>}
      </section>
      {/* Menu pliant des interrupteurs : replié, sauf à l'ajout avec une détection à confirmer ou si la machine n'est pas suivie */}
      <div className="rounded-xl border border-line/60 bg-bg2/30">
        <button type="button" onClick={() => setOptions(!options)} aria-expanded={options}
          className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-bg2/60">
          {options ? <ChevronDown size={14} className="text-dim" aria-hidden /> : <ChevronRight size={14} className="text-dim" aria-hidden />}
          {tx("Options de la machine")}
          <span className="flex flex-wrap items-center gap-1 font-normal">
            {v.disabled && <Badge tone="warn">{tx("non suivie")}</Badge>}
            {FLAGS.filter((f) => v[f.k]).map((f) => <Badge key={String(f.k)} tone={found.has(String(f.k)) ? "info" : "off"}>{f.label}</Badge>)}
            {proc && !windows && !!v.ssh && <Badge tone="off">{tx("services hors Docker")}</Badge>}
          </span>
        </button>
        {options && (
          <div className="flex flex-col gap-1.5 border-t border-line/60 p-3">
          <label className="flex items-start gap-2 rounded-lg border border-line/60 bg-bg2/40 p-2">
            <Switch on={!v.disabled} disabled={pending === "disabled"} onChange={(on) => void autoSave("disabled", { disabled: !on })} label={tx("Machine suivie")} />
            <span><b>{tx("Machine suivie")}</b> <Saved k="disabled" /> <Dim>· {tx("coupée : ni ping, ni SSH, ni santé, aucune alerte ; elle reste ici pour être réactivée")}</Dim></span>
          </label>
          {detectedFlags.length > 0 && (
            <OptionGroup title={tx("Détectés sur cette machine")} tone="ok">{detectedFlags.map(flagRow)}</OptionGroup>
          )}
          <OptionGroup title={tx("À changer manuellement")} hint={tx("Non détectables : c'est à vous de choisir.")}>
            {manualFlags.map(flagRow)}
            {!windows && v.ssh && (
              <label className="flex items-start gap-2">
                <Switch on={proc} disabled={pending === "proc"} onChange={(on) => void autoSave("proc", {}, on)} label={tx("Lire les services hors Docker")} />
                <span>{tx("Lire les services hors Docker")} <Saved k="proc" /> <Dim>{tx("· ports en écoute (ss -tlnp, root requis sur la machine)")}</Dim></span>
              </label>
            )}
          </OptionGroup>
          {missingFlags.length > 0 && (
            <div className="rounded-lg border border-line/60 bg-bg2/30">
              <button type="button" onClick={() => setMissingOpen(!missingOpen)} aria-expanded={missingOpen}
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-dim hover:text-txt">
                {missingOpen ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                {tx("Non détectés")} <span className="font-mono normal-case">({missingFlags.length})</span>
              </button>
              {missingOpen && (
                <div className="flex flex-col gap-1.5 border-t border-line/60 p-2.5">
                  {!unlock && <p className="text-xs text-dim">{tx("Grisés : la détection ne les confirme pas (elle relit la machine à chaque collecte).")}</p>}
                  {missingFlags.map(flagRow)}
                  {!unlock && <button type="button" className="self-start text-xs text-link hover:underline" onClick={() => setUnlock(true)}>{tx("Détection incomplète ? Tout débloquer")}</button>}
                </div>
              )}
            </div>
          )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={primary} disabled={busy}>{isNew ? tx("Enregistrer la machine") : tx("Enregistrer le nom et l'accès")}</button>
        {actions}
      </div>
      {!report && <NoteLine note={localNote} />}
    </form>
  );
}
