// Réglages → Machines : équivalent graphique de « setup.py --add ». Détecter (IP, nom ou alias SSH : ping,
// ports, SSH Linux / Windows, Docker, AdGuard, VM, services web, connecteurs reconnus), relire la proposition,
// enregistrer ; modifier, vérifier (mêmes contrôles que setup.py --check) ou retirer une machine déclarée.
// Chaque carte porte aussi l'accès SSH relevé par la collecte (résumé plié, détail déplié) : tout ce qui touche une
// machine est ici ; Connecteurs ne garde que les services lus par leur API.
import { ArrowRight, Check, ChevronDown, ChevronRight, Eye, EyeOff, IdCard, KeyRound, Loader2, Monitor, Plus, Power, Radar, RefreshCw, Server, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { LOGIN, LoginRequired, read, refreshSnapshot, send, type Snapshot } from "../api";
import { Field, NoteLine, Switch, TagInput } from "../components/form";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Count, Dim } from "../components/ui";
import { dateTime, ipNum } from "../lib/format";
import type { AgentInfo, Connector, Detection, MachineConf, MachinesSettings as State, NetHost, NetScan, Redetection, RedetectItem } from "../types";
import { DISMISSED_KEY } from "../lib/firstSteps";
import { needsLink } from "../lib/netScan";
import { MachineIcon } from "../components/MachineIcon";
import { IconChoice } from "../components/IconChoice";
import { IconPicker } from "../components/IconPicker";
import { mState, osOfMachine } from "../lib/machines";
import { AuthorizeKey } from "../components/AuthorizeKey";
import { SshGuide } from "../components/SshGuide";
import { SshAccess, SshDetails } from "../components/ssh";
import { SourceBadges } from "../components/SourceBadges";
import { focusConnector } from "../lib/connectorPrefill";
import { ReadBySsh } from "../components/ReadBySsh";
import { useWide } from "../lib/useWide";
import { rolesOf, sshWarn } from "../lib/ssh";
import { pokeScan } from "../lib/scan";
import { hardwareRows } from "../lib/hardware";
import { tx } from "../lib/i18n";

const FLAGS: { k: keyof MachineConf; label: string; help: string }[] = [
  { k: "off", label: tx("Souvent éteinte"), help: tx("PC, portable : pas d'alerte si elle ne répond pas") },
  { k: "gateway", label: tx("Passerelle"), help: tx("box / routeur : sous-titre de la page") },
  { k: "npm", label: tx("Héberge NPM"), help: tx("sous-titre de la page") },
  { k: "npm_only", label: tx("Joignable seulement par NPM"), help: tx("pare-feu : ses services sont testés via NPM") },
  { k: "vm", label: tx("Machine virtuelle"), help: tx("pas de SMART ni de température du processeur : le disque et le processeur sont virtuels, rien de réel à lire (se coche seule si détectée)") },
];

const VM_AUTO_KEY = "ms.vm.auto";

/** Machine Windows déclarée (système ou accès de santé seul) : la commande « authorized_keys » ne la concerne pas */
const isWindowsConf = (c?: MachineConf) => !!c && (c.os === "windows" || (typeof c.health === "string" && !c.ssh));

/** « compte@adresse:port » de l'accès (alias) d'une machine, d'après la liste des accès connus */
function sshWho(st: State, alias: string): string {
  const a = st.aliases.find((x) => x.alias === alias);
  return a ? `${a.user ? `${a.user}@` : ""}${a.ip || a.host}${a.port ? `:${a.port}` : ""}` : alias;
}

export function MachinesSettings({ snap, focusIp }: { snap: Snapshot; focusIp?: string }) {
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [redetecting, setRedetecting] = useState(false);
  // Système vu par le dernier scan du réseau, pour les machines que le SSH ne renseigne pas (suggestion)
  const [scanOs, setScanOs] = useState<Record<string, { os?: string; apps: string[]; ssh?: boolean; sshPort?: number }>>({});
  const [hosts, setHosts] = useState<NetHost[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});  // agent actif par IP
  useEffect(() => { read<{ agents: AgentInfo[] }>("agents").then((r) => setAgents(Object.fromEntries(r.agents.filter((a) => a.state !== "révoqué").map((a) => [a.ip, a])))).catch(() => undefined); }, []);
  useEffect(() => { read<NetScan>("network/scan").then((n) => { setHosts(n.found || []); setScanOs(Object.fromEntries((n.found || []).map((h) => [h.ip, { os: h.os ?? undefined, apps: h.apps ?? [], ssh: !!h.ssh_port, sshPort: h.ssh_port ?? undefined }]))); }).catch(() => undefined); }, []);
  const [accepted, setAccepted] = useState<{ gen: string; ips: string[] }>({ gen: "", ips: [] });
  const [showOff, setShowOff] = useState(false);   // machines not followed: hidden, like in the Machines tab   // clés acceptées depuis le dernier passage : la carte se retire sans attendre le suivant
  const reload = useCallback(() => {
    read<State>("machines/settings")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);
  const wide = useWide();
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
  const all = Object.keys(st.machines).sort((a, b) => ipNum(a) - ipNum(b));
  const nOff = all.filter((ip) => st.machines[ip].disabled).length;
  const ips = showOff || (focusIp && st.machines[focusIp]?.disabled) ? all : all.filter((ip) => !st.machines[ip].disabled);
  // Machines dont la clé n'est pas autorisée : retrouvées par leur IP (le nom d'un connecteur est celui de la machine, pas son adresse) ; chacune a son compte SSH
  const machineOf = (c: Connector) => (c.ip ? st.machines[c.ip] : Object.values(st.machines).find((x) => x.name === c.name));
  const userOf = (c: Connector) => st.aliases.find((al) => al.alias === machineOf(c)?.ssh)?.user || "root";
  const hidden = accepted.gen === snap.data.generated ? accepted.ips : [];
  const failingKey = (snap.data.connectors || []).filter((c) => c.type === "docker" && !c.ok && !isWindowsConf(machineOf(c)) && !hidden.includes(c.ip ?? c.name));
  return (
    <div className="flex flex-col gap-4">
      <div id="authorize-key" className="scroll-mt-24"><AuthorizeKey userOf={userOf} failing={failingKey} onAccepted={() => setAccepted({ gen: snap.data.generated, ips: [...hidden, ...failingKey.map((c) => c.ip ?? c.name)] })} /></div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold"><Server size={16} aria-hidden />{tx("Machines")} <Count n={all.length - nOff} />
            {nOff > 0 && <button type="button" onClick={() => setShowOff(!showOff)} aria-pressed={showOff} title={tx("Machines dont « Machine suivie » est coupé : plus lues, cachées ici et dans l'onglet Machines")}
              className={`ml-1 inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-semibold ${showOff ? "border-link bg-link/15 text-txt" : "border-line text-muted hover:text-txt"}`}>
              {showOff ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}{tx("Non suivies")} ({nOff})</button>}</h2>
          {!detecting && (
            <div className="flex flex-wrap gap-2">
              {!redetecting && <button type="button" className={quiet} onClick={() => setRedetecting(true)}><RefreshCw size={14} />{tx("Redétecter")}</button>}
              <button type="button" className={primary} onClick={() => setDetecting(true)}><Plus size={14} />{tx("Ajouter une machine")}</button>
            </div>
          )}
        </div>
        {redetecting && <Redetect st={st} onDone={() => { setRedetecting(false); reload(); }} />}
        {detecting && <Detect st={st} onDone={() => { setDetecting(false); reload(); }} onCancel={() => setDetecting(false)} />}
      </Card>
      {/* Deux colonnes indépendantes (une ligne sur deux dans chacune) : ouvrir un cadre ne déplace ni n'étire l'autre colonne */}
      {(() => {
        const cards = ips.map((ip) => {
          const lm = live.get(ip);
          // Un PC Windows n'a ni Docker ni services en écoute à lire : pas d'état de connecteur SSH Linux (reste d'un ancien relevé)
          const stat = st.machines[ip].os === "windows" ? [] : (snap.data.connectors || []).filter((c) => ["docker", "process", "adguard"].includes(c.type) && (c.ip ? c.ip === ip : c.name === ip || c.name === lm?.name));
          return <MachineRow key={ip} agent={agents[ip]} unfinished={unfinished[ip]} scan={scanOs[ip]} focus={ip === focusIp} ip={ip} m={st.machines[ip]} st={st} live={lm} statuses={stat} reload={reload} />;
        });
        return wide
          ? <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">{[0, 1].map((c) => <div key={c} className="flex min-w-0 flex-col gap-3">{cards.filter((_, i) => i % 2 === c)}</div>)}</div>
          : <div className="flex flex-col gap-3">{cards}</div>;
      })()}
      <ReadBySsh snap={snap} />
    </div>
  );
}

const REDETECT_FLAGS: Record<string, string> = { vm: tx("Machine virtuelle"), gateway: tx("Passerelle"), npm: tx("Héberge NPM"), off: tx("Souvent éteinte") };

/** Écarts d'un item en lignes cochables : clé stable, texte, effet sur la machine (ou sur « process_hosts ») */
function redetectChanges(r: RedetectItem): { key: string; text: string }[] {
  return [
    ...r.flags_on.map((f) => ({ key: `on:${f}`, text: `${tx("Allumer")} « ${REDETECT_FLAGS[f] ?? f} »` })),
    ...r.flags_off.map((f) => ({ key: `off:${f}`, text: `${tx("Éteindre")} « ${REDETECT_FLAGS[f] ?? f} »` })),
    ...(r.os ? [{ key: "os", text: tx("Système : Windows") }] : []),
    ...(r.role_add ?? []).map((t) => ({ key: `tag+:${t}`, text: `${tx("Ajouter l'étiquette")} « ${t} »` })),
    ...(r.role_remove ?? []).map((t) => ({ key: `tag-:${t}`, text: `${tx("Retirer l'étiquette")} « ${t} » ${tx("(plus vue sur la machine)")}` })),
    ...(r.process ? [{ key: "process", text: `${tx("Lire les services hors Docker")} (${r.ports.slice(0, 5).map((p) => `${p.name} :${p.port}`).join(", ")}${r.ports.length > 5 ? "…" : ""})` }] : []),
  ];
}

/** Redétection de toutes les machines : écarts proposés, cochés par défaut ; rien n'est écrit avant « Appliquer » */
function Redetect({ st, onDone }: { st: State; onDone: () => void }) {
  const [res, setRes] = useState<Redetection | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());  // écarts décochés : « ip|clé »
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    send<Redetection>("POST", "machines/redetect", {}).then(setRes, (err) => {
      if (err instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (err as Error).message });
    });
  }, []);
  const withChanges = (res?.machines ?? []).filter((r) => r.note === null);
  const toggle = (id: string) => setOff((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });
  const apply = async () => {
    setBusy(true); setNote(null);
    let failed = 0;
    for (const r of withChanges) {
      const keep = (k: string) => !off.has(`${r.ip}|${k}`);
      const machine: MachineConf = { ...st.machines[r.ip] };
      let proc: boolean | null = null, touched = false;
      for (const f of r.flags_on) if (keep(`on:${f}`)) { (machine as Record<string, unknown>)[f] = true; touched = true; }
      for (const f of r.flags_off) if (keep(`off:${f}`)) { delete (machine as Record<string, unknown>)[f]; touched = true; }
      if (r.os && keep("os")) { machine.os = r.os; touched = true; }
      if (r.process && keep("process")) { proc = true; touched = true; }
      const tags = rolesOf(machine.role).filter((t) => !(r.role_remove ?? []).some((x) => x === t && keep(`tag-:${x}`)));
      for (const t of r.role_add ?? []) if (keep(`tag+:${t}`) && !tags.includes(t)) tags.push(t);
      if (tags.join(", ") !== rolesOf(machine.role).join(", ")) { machine.role = tags.join(", ").slice(0, 200); touched = true; }
      if (!touched) continue;
      try {
        await send("PUT", `machines/settings/${r.ip}`, { machine, process: proc, extra: [] });
        void send("POST", `machines/settings/${r.ip}/refresh`).then(pokeScan, () => undefined);
      } catch (err) {
        if (err instanceof LoginRequired) { location.replace(LOGIN); return; }
        failed++;
      }
    }
    setBusy(false);
    if (failed) setNote({ ok: false, text: `${failed} ${tx("machine(s) non enregistrée(s)")}` });
    else onDone();
  };
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border-2 border-link bg-link/5 p-3">
      {!res && !note && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" />{tx("Détection de toutes les machines…")}</p>}
      {res && withChanges.length === 0 && <p className="text-sm text-ok">{tx("Rien à changer")}</p>}
      {withChanges.map((r) => (
        <div key={r.ip} className="flex flex-col gap-1 text-sm">
          <div className="font-semibold">{r.name} <Dim>· {r.ip}</Dim></div>
          {redetectChanges(r).map((c) => (
            <label key={c.key} className="flex items-center gap-2 pl-3">
              <input type="checkbox" checked={!off.has(`${r.ip}|${c.key}`)} onChange={() => toggle(`${r.ip}|${c.key}`)} />{c.text}
            </label>
          ))}
        </div>
      ))}
      {res && res.machines.filter((r) => r.note !== null && r.note !== "rien à changer").map((r) => <Dim key={r.ip}>{r.name} · {tx("Injoignable ou illisible : non vérifiable")}</Dim>)}
      {note && <NoteLine note={note} />}
      <div className="flex gap-2">
        {withChanges.length > 0 && <button type="button" className={primary} disabled={busy} onClick={apply}><Check size={14} />{busy ? tx("Enregistrement…") : tx("Appliquer")}</button>}
        <button type="button" className={quiet} onClick={onDone}>{withChanges.length > 0 ? tx("Annuler") : tx("Fermer")}</button>
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
    <div className="mt-3 flex flex-col gap-3 rounded-xl border-2 border-link bg-link/5 p-3">
      <form onSubmit={run} className="flex flex-wrap items-end gap-2">
        <Field label={tx("IP, nom ou alias SSH")}>
          <input className={`${input} min-w-[260px]`} list="ssh-aliases" required value={target} onChange={(e) => setTarget(e.target.value)} placeholder={tx("ex. 192.168.1.20 ou nas")} />
          <datalist id="ssh-aliases">{st.aliases.map((a) => <option key={a.alias} value={a.alias}>{a.ip || a.host}</option>)}</datalist>
        </Field>
        <button type="submit" className={primary} disabled={busy}><Radar size={14} />{busy ? tx("Détection…") : tx("Détecter")}</button>
        <button type="button" className={quiet} onClick={onCancel}>{tx("Annuler")}</button>
      </form>
      <p className="text-sm text-muted">
        {tx("Lecture seule sur le réseau, comme la collecte. L'accès SSH passe par un alias de")} <code className="font-mono text-xs">{st.ssh_conf}</code>
        {" "}({st.aliases.length} {tx("connus) ; la clé publique de l'app doit être dans")} <code className="font-mono text-xs">{tx("authorized_keys")}</code> {tx("du compte visé. Un changement est pris en compte au prochain passage de la collecte.")}
      </p>
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

function MachineRow({ ip, m, st, live, statuses, reload, focus, scan, unfinished, agent }: {
  agent?: AgentInfo; unfinished?: { why: "ha" | "ssh"; passed: boolean }; scan?: { os?: string; apps: string[]; ssh?: boolean; sshPort?: number }; focus?: boolean; ip: string; m: MachineConf; st: State; live?: Snapshot["data"]["machine_list"][number]; statuses: NonNullable<Snapshot["data"]["connectors"]>; reload: () => void;
}) {
  const [open, setOpen] = useState(!!focus), [confirm, setConfirm] = useState(false);  // focus : arrivée depuis un lien (Connecteurs → machine)
  const [icon, setIcon] = useState(m.icon as string | undefined);  // icône choisie dans le formulaire : l'en-tête de la carte la reprend aussitôt
  useEffect(() => setIcon(m.icon as string | undefined), [m.icon]);
  const [off, setOff] = useState(!!m.disabled);  // « Machine suivie » basculée dans le formulaire : la carte (grisée ou non) suit aussitôt
  useEffect(() => setOff(!!m.disabled), [m.disabled]);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus) card.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focus]);
  const [note, setNote] = useState<Note>(null), [lines, setLines] = useState<string[] | null>(null), [busy, setBusy] = useState(false);
  const linesTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(linesTimer.current), []);
  const sshUser = st.aliases.find((a) => a.alias === m.ssh)?.user || "root";  // compte de l'accès, pour le chemin de authorized_keys
  // Un test réussi lève les avertissements tout de suite : les badges viennent du dernier passage de la collecte (une minute ou plus), sans cela
  // la carte « port faux » ou « clé refusée » resterait affichée et reviendrait « en boucle » après chaque correction.
  const [accepted, setAccepted] = useState(false);
  const stamp = `${statuses.map((c) => c.ok).join()}|${live?.ssh?.port}`;
  useEffect(() => setAccepted(false), [stamp]);   // nouveau passage : on retrouve l'état réel
  const keyMissing = !accepted && statuses.some((c) => c.type === "docker" && !c.ok);  // accès SSH activé, mais la clé de l'app n'est pas autorisée (ou le port est faux)
  const wrongPort = !accepted && !!(scan?.sshPort && live?.ssh && scan.sshPort !== live.ssh.port);   // alias sur un autre port que celui où sshd répond
  const goAuthorize = () => document.getElementById("authorize-key")?.scrollIntoView({ behavior: "smooth", block: "start" });
  // Les badges viennent du dernier passage de la collecte : après un test réussi, on en lance un (sans bloquer si un passage est déjà en cours)
  // Seule cette machine est relue (SSH, Docker, santé) : les autres restent en cache, le passage est court.
  const refreshState = () => { void send("POST", `machines/settings/${ip}/refresh`).then(pokeScan, () => undefined); };
  const verify = async () => {
    setBusy(true); setLines(null);
    try {
      const r = await send<{ lines: string[]; failed: number }>("POST", `machines/settings/${ip}/check`);
      setLines(r.lines);
      if (!r.failed) { setAccepted(true); refreshState(); }  // l'accès répond : avertissements levés, le badge (état du dernier passage) est remis à jour
      clearTimeout(linesTimer.current);
      linesTimer.current = setTimeout(() => setLines(null), 15_000);  // résultat visible 15 s, puis il disparaît
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  const fixPort = async () => {   // l'alias garde son compte ; seul le port change
    setBusy(true);
    await act(() => send("POST", "machines/ssh-alias", { ip, user: sshUser, port: scan?.sshPort }), tx("port corrigé : test en cours"), setNote);
    setBusy(false);
    await verify();
    reload();
  };
  const access = agent ? tx("agent MyServices") : m.os === "windows" ? (m.health ? tx("Windows · santé par {0}", m.health) : tx("Windows · sans agent")) : m.ssh ? `SSH ${m.ssh}` : tx("sans SSH");
  const Chevron = open ? ChevronDown : ChevronRight;
  // Ce que la collecte (SSH) ou l'agent a lu de la connexion : montré dans le cadre « Accès », sous l'interrupteur
  const hw = hardwareRows(live?.agent?.hardware);  // matériel lu par l'agent (modèle, BIOS, processeur, mémoire...)
  const connection = m.os === "windows" ? (
    <div className="text-sm">
      {agent ? (
        <>
        <p className="text-muted">{tx("Lu par l'agent MyServices, en lecture seule : système, disques, services, processeur, mémoire, mises à jour Windows, journal Système, ports en écoute. Pas de Docker.")}{" "}
          {agent.last_seen ? tx("Dernier relevé {0}.", dateTime(agent.last_seen * 1000)) : tx("Aucun relevé reçu pour l'instant.")}{" "}
          <a className="text-link hover:underline" href="#settings/connectors">{tx("Réglages → Connecteurs")}</a></p>
          {hw.length > 0 && <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {hw.map(([k, v]) => <Fragment key={k}><dt className="text-dim">{k}</dt><dd className="break-words text-txt">{v}</dd></Fragment>)}
          </dl>}
        </>
      ) : typeof m.health === "string" && m.health ? (
        <p className="text-muted">{tx("Lu par OpenSSH et PowerShell, en lecture seule : disques, services, processeur, mises à jour Windows, journal Système. Pas de Docker. Accès :")} <code className="font-mono text-xs">{sshWho(st, m.health)}</code>.
          {m.off ? <span className="block text-dim">{tx("Marqué « souvent éteinte » : la santé ne le relève pas tant que cette option est cochée.")}</span> : null}</p>
      ) : <p className="text-dim">{tx("Pas d'agent : ping et services web seulement.")}{" "}
        <a className="text-link hover:underline" href={`#settings/agents/${ip}`}>{tx("Installer l'agent")}</a>{tx(" pour lire sa santé sans SSH.")}</p>}
    </div>
  ) : live ? <SshDetails m={live} statuses={statuses} /> : null;
  return (
    <div ref={card} className={`flex w-full min-w-0 flex-col rounded-xl border bg-card text-sm transition-colors self-start ${off ? "opacity-60" : ""} ${focus || open ? "border-link ring-1 ring-link" : "border-dim/50"}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={`flex w-full flex-wrap content-start items-center gap-x-2 gap-y-1 rounded-xl p-3 text-left hover:bg-bg2 ${open ? "" : "h-[5.5rem] overflow-hidden"}`}>
        <Chevron size={14} className="text-txt" /><MachineIcon m={{ name: m.name, role: m.role, os: m.os, info: live?.info, ttl: live?.ttl, icon: icon }} scan={scan} reserve /><b className="max-w-[10rem] truncate">{m.name}</b><Dim>{ip}</Dim>
        <span className={`ml-auto flex min-w-0 items-center justify-end gap-1.5 ${open ? "flex-wrap" : "flex-nowrap overflow-hidden"}`}>
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
          {off && <Badge tone="off">{tx("non suivie")}</Badge>}
        </span>
        {/* Qui lit la machine : un badge court par source, coloré selon son état (détail en infobulle). Le détail de l'accès SSH n'est que dans la carte dépliée */}
        <span className="flex basis-full flex-wrap items-center gap-1 pl-5 text-xs text-dim">
          {!open && rolesOf(m.role).map((t) => <Badge key={t} tone="off">{t}</Badge>)}
          {live ? <SourceBadges all={open} m={live} agent={agent} /> : agent ? <Badge tone={agent.state === "actif" ? "ok" : "warn"} title={tx("Agent MyServices : {0}", agent.state)}>{tx("agent")}</Badge> : <span className="truncate">{access}</span>}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <NoteLine note={note} />
          {lines && (
            <ul className="rounded-lg bg-bg2 p-2 font-mono text-xs">
              {lines.map((l, i) => <li key={i} className={l.startsWith("✓") ? "text-ok" : l.startsWith("✗") ? "text-bad" : "text-warn"}>{l}</li>)}
            </ul>
          )}
          {keyMissing && wrongPort && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-muted">
              <p className="min-w-[240px] flex-1">
                <b className="text-warn">!</b> {tx("Ce n'est pas la clé : le port SSH est faux. L'accès utilise le port")} <b className="text-txt">{live?.ssh?.port}</b>
                {tx(", mais la recherche réseau a vu SSH sur le port")} <b className="text-txt">{scan?.sshPort}</b>.
              </p>
              <button type="button" className={primary} disabled={busy} onClick={() => void fixPort()}>{tx("Utiliser le port {0}", scan?.sshPort ?? "")}</button>
            </div>
          )}
          {keyMissing && !wrongPort && (
            <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-muted">
              <p>
                <b className="text-warn">!</b> {tx("Action requise : la clé SSH de l'app est refusée pour le compte")} <b className="text-txt">{sshUser}</b>{tx(" sur cette machine, donc Docker n'est pas lisible. Ce n'est pas la clé qui a changé : elle n'est pas (encore) dans les clés autorisées de ce compte.")}
              </p>
              <p>{tx("Sur la machine, connecté en")} <b className="text-txt">{sshUser}</b>{tx(", lancez :")}</p>
              <AuthorizeKey bare user={sshUser} failing={statuses.filter((c) => c.type === "docker" && !c.ok)} />
              <p className="text-xs text-dim">{tx("Puis « Vérifier ». Si l'accès marchait avec un autre compte (root, par exemple), revenez-y en réactivant l'accès avec ce compte.")}</p>
            </div>
          )}
          {unfinished && (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-muted">
              <b className="text-warn">{tx("Non terminé")}</b>{unfinished.passed ? ` · ${tx("vous l'aviez passé dans les premiers pas")}` : ""} {" : "}
              {unfinished.why === "ha" ? <>{tx("le jeton de Home Assistant manque : ")}<a className="text-link hover:underline" href="#settings/connectors">{tx("Réglages → Connecteurs")}</a></>
                : tx("cette machine offre SSH mais MyServices n'y a pas d'accès : activez « Lecture par SSH » ci-dessous.")}
            </p>
          )}
          <MachineForm agent={agent} connection={connection} report={setNote} onIcon={setIcon} onFollow={(on) => setOff(!on)} ip={ip} m={m} st={st} live={live} scan={scan} windowsGuess={osOfMachine({ os: m.os, info: live?.info, ttl: live?.ttl }, scan?.os, scan?.ssh)?.kind === "windows"} process={!!st.process_hosts[ip]} onDone={reload} actions={<>
            <button type="button" className={quiet} disabled={busy} onClick={() => void verify()}><ShieldCheck size={14} />{busy ? tx("Vérification…") : tx("Vérifier")}</button>
            <span className="ml-auto flex items-center gap-1.5">
              {confirm ? <>
                <button type="button" className={danger} onClick={() => void act(() => send("DELETE", `machines/settings/${ip}`), tx("machine retirée : la recherche réseau ne la proposera plus (Réglages → Découverte pour la faire revenir)"), setNote).then((ok) => ok && reload())}>{tx("Confirmer le retrait")}</button>
                <button type="button" className={quiet} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
              </> : <button type="button" className={`${danger} px-2`} onClick={() => setConfirm(true)} aria-label={tx("Retirer")}
                title={tx("Retirer : MyServices ne suit plus cette machine et la recherche réseau ne la propose plus (une confirmation est demandée)")}><Trash2 size={15} aria-hidden /></button>}
            </span>
          </>} />
        </div>
      )}
    </div>
  );
}

/** Groupe d'interrupteurs : titre, éventuel rappel, interrupteurs en dessous */
function OptionGroup({ title, hint, tone, children }: { title: string; hint?: string; tone?: "ok"; children: React.ReactNode }) {
  return (
    <fieldset className={`flex flex-col gap-2 rounded-xl border p-3 ${tone === "ok" ? "border-ok/40 bg-ok/10" : "border-dim/50 bg-bg2/70"}`}>
      <legend className="inline-flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-dim"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone === "ok" ? "bg-ok" : "bg-dim"}`} />{title}</legend>
      {hint && <p className="text-xs text-dim">{hint}</p>}
      {children}
    </fieldset>
  );
}

function MachineForm({ ip, m, st, isNew, process, extra, detected = [], live, scan, actions, windowsGuess, report, onDone, onIcon, onFollow, agent, connection }: {
  onFollow?: (followed: boolean) => void;  // « Machine suivie » vient d'être enregistrée : la carte de la machine se dégrise (ou se grise)
  onIcon?: (icon: string | undefined) => void;  // l'icône vient d'être enregistrée : la carte de la machine se met à jour
  scan?: { os?: string; apps: string[]; ssh?: boolean; sshPort?: number };  // ce que le dernier scan du réseau a vu : aperçu de l'icône automatique
  connection?: React.ReactNode;  // ce qui a été lu de la connexion (SSH ou agent), montré dans le cadre « Accès »
  agent?: AgentInfo;  // agent actif de la machine : c'est son accès (Windows), ou une deuxième source de santé à ordonner (avec SSH)
  report?: (n: Note) => void;  // dans une carte de machine : le message s'affiche en haut de la carte
  windowsGuess?: boolean;
  live?: Snapshot["data"]["machine_list"][number]; actions?: React.ReactNode; detected?: string[]; ip: string; m: MachineConf; st: State; isNew?: boolean; process?: boolean; extra?: Detection["web"]; onDone: () => void;
}) {
  const [v, setV] = useState<MachineConf>(m);
  const [proc, setProc] = useState(!!process);
  const [unlock, setUnlock] = useState(false);  // détection incomplète : débloque tous les interrupteurs
  const [hasAdguard] = useState(() => !!m.adguard);  // figé à l'ouverture : vider le champ ne le fait pas disparaître
  // Menu des options replié ; les options ACTIVES sont montrées dehors, sous « Options actives ». Ouvert d'office seulement à l'ajout
  // d'une machine dont la détection est à confirmer.
  const [options, setOptions] = useState(() => !!isNew && detected.length > 0);
  const [missingOpen, setMissingOpen] = useState(false), [manualOpen, setManualOpen] = useState(false);
  const [sshOpen, setSshOpen] = useState(!!isNew);  // replié d'office ; ouvert à l'ajout d'une machine, où il faut choisir l'accès
  const [localNote, setLocalNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const setNote = report ?? setLocalNote;
  const windows = v.os === "windows";
  // Ce que l'accès choisi permet de lire (suit le formulaire, avant même l'enregistrement)
  const sshAccess = windows ? !!v.health : !!v.ssh;
  // Connecteurs qui voient cette machine (API et outils réseau rapprochés), sans doublon
  const linked = [...new Map([...(live?.api ?? []).map((a) => [`${a.type}/${a.name}`, { type: a.type, name: a.name, label: a.label }] as const),
    ...(live?.links?.sources ?? []).filter((x) => x.ok !== false).map((x) => [`${x.source}/${x.instance}`, { type: x.source, name: x.instance, label: x.label }] as const)]).values()];
  const access = sshAccess || !!agent, health = access && (!!agent || (!v.off && v.health !== false));  // un agent lit même un poste « souvent éteint »
  const gives: [string, boolean, string][] = [
    // Pas de pastille Docker quand la machine est lue par SSH et qu'il n'y en a pas : rien à dire, ce n'est pas un manque
    ...(access && !windows && live?.info?.docker_installed === false ? [] : [["Docker", !windows && access, tx("Conteneurs, images, ports (onglet Services)")] as [string, boolean, string]]),
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
  const QUICK = ["off"];   // réglages courants, montrés en haut de la carte (jamais grisés ni cachés dans le menu des options)
  const locked = (k: string) => !QUICK.includes(k) && !unlock && DETECTABLE.includes(k) && !found.has(k) && !v[k as keyof MachineConf];
  const isOn = (k: string) => found.has(k) || !!v[k as keyof MachineConf];
  const activeFlags = FLAGS.filter((f) => !!v[f.k] && !QUICK.includes(String(f.k)));  // allumées : montrées hors du menu
  const procOn = proc && !windows && !!v.ssh;
  const detectedFlags = FLAGS.filter((f) => !QUICK.includes(String(f.k)) && DETECTABLE.includes(String(f.k)) && isOn(String(f.k)) && !v[f.k]);
  const missingFlags = FLAGS.filter((f) => !QUICK.includes(String(f.k)) && DETECTABLE.includes(String(f.k)) && !isOn(String(f.k)));
  const manualFlags = FLAGS.filter((f) => !QUICK.includes(String(f.k)) && !DETECTABLE.includes(String(f.k)) && !v[f.k]);
  const flagRow = (f: (typeof FLAGS)[number]) => (
    <label key={String(f.k)} className={`flex items-start gap-2 ${locked(String(f.k)) ? "opacity-50" : ""}`}
      title={locked(String(f.k)) ? tx("Non détecté sur cette machine : grisé") : undefined}>
      <Switch on={!!v[f.k]} disabled={locked(String(f.k)) || pending === String(f.k)} onChange={(on) => void autoSave(String(f.k), { [f.k]: on })} label={f.label} />
      <span>{f.label} {found.has(String(f.k)) && <Badge tone="info" title={tx("Trouvé par la détection : décochez si c'est faux")}>{tx("détecté")}</Badge>} <Saved k={String(f.k)} /> <Dim>· {f.help}</Dim></span>
    </label>
  );
  // Machine déjà enregistrée : un interrupteur se sauvegarde tout seul (sans toucher aux champs texte en cours de saisie) ;
  // une coche « ✓ enregistré » s'anime à côté. À l'ajout (isNew), tout part avec « Enregistrer ».
  const [saved, setSaved] = useState<MachineConf>(m), [savedProc, setSavedProc] = useState(!!process);
  const [flash, setFlash] = useState(""), [pending, setPending] = useState(""), [failed, setFailed] = useState<{ k: string; text: string } | null>(null);
  // Seule cette machine est relue (SSH, Docker, santé) : les autres restent en cache, le passage est court.
  const refreshState = () => { void send("POST", `machines/settings/${ip}/refresh`).then(pokeScan, () => undefined); };
  const autoSave = async (key: string, next: Partial<MachineConf>, nextProc = savedProc, refresh = true) => {
    if (isNew) { setV((x) => ({ ...x, ...next })); if (key === "proc") setProc(nextProc); return; }
    setPending(key); setFailed(null);
    const machine = { ...saved, ...next };
    // Refused: the reason shows next to the field itself (not only at the bottom of the card), the old value stays on screen
    const ok = await act(() => send("PUT", `machines/settings/${ip}`, { machine, process: windows ? null : nextProc, extra: [] }), tx("enregistré"),
      (n) => { setNote(n && !n.ok ? n : null); if (n && !n.ok) setFailed({ k: key, text: n.text }); });  // succès : seulement la coche animée ; erreur : message
    setPending("");
    if (!ok) return;
    setSaved(machine); setSavedProc(nextProc);
    if (key === "icon") onIcon?.(next.icon as string | undefined);
    if (key === "disabled") onFollow?.(!next.disabled);
    setV((x) => ({ ...x, ...next })); if (key === "proc") setProc(nextProc);
    if (refresh) refreshState();  // un réglage changé (accès, options) : cette machine est relue tout de suite, pas au prochain horaire
    onDone();            // the card list re-reads the saved settings: a tag added or removed stays after closing and reopening the card
    refreshSnapshot();   // name and tags already published by the server: the other tabs show them now
    setFlash(key); setTimeout(() => setFlash((f) => (f === key ? "" : f)), 1800);
  };
  // Machine virtuelle détectée sur une machine déjà enregistrée : « Machine virtuelle » se coche toute seule, une fois par machine
  // (la liste est gardée par le navigateur : si l'on décoche ensuite, c'est respecté)
  useEffect(() => {
    if (isNew || m.vm || m.disabled || !live?.detected?.includes("vm")) return;
    let done: string[] = [];
    try { done = JSON.parse(localStorage.getItem(VM_AUTO_KEY) || "[]") as string[]; } catch { /* mémoire du navigateur illisible */ }
    if (done.includes(ip)) return;
    try { localStorage.setItem(VM_AUTO_KEY, JSON.stringify([...done, ip])); } catch { /* navigation privée : tant pis */ }
    void autoSave("vm", { vm: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.detected?.join(), isNew]);
  const Saved = ({ k }: { k: string }) => (pending === k ? <Loader2 size={13} className="animate-spin text-dim" aria-label={tx("enregistrement…")} />
    : failed?.k === k ? <span className="text-xs font-semibold text-bad" role="alert">⚠ {tx("non enregistré :")} {failed.text}</span>
    : flash === k ? <span className="saved-pop inline-flex items-center gap-1 text-xs font-semibold text-ok"><Check size={13} aria-hidden />{tx("enregistré")}</span> : null);
  // Étiquettes proposées en un clic d'après ce que la machine est réellement : Docker (conteneurs lus), Apache, nginx, SSH, Windows, VM, passerelle, NPM
  const i = live?.info;
  const roleSuggestions = [
    ...(i?.docker || i?.docker_installed ? ["Docker"] : []), ...(i?.apache ? ["Apache"] : []), ...(i?.nginx ? ["nginx"] : []),
    ...(windows ? ["Windows"] : v.ssh ? ["SSH"] : []), ...((v.vm || found.has("vm")) ? ["VM"] : []),
    ...((v.gateway || found.has("gateway")) ? ["Passerelle"] : []), ...((v.npm || found.has("npm")) ? ["NPM"] : []),
  ];
  const procRow = (
    <label className="flex items-start gap-2">
      <Switch on={proc} disabled={pending === "proc"} onChange={(on) => void autoSave("proc", {}, on)} label={tx("Lire les services hors Docker")} />
      <span>{tx("Lire les services hors Docker")} <Saved k="proc" /> <Dim>{tx("· ports en écoute (ss -tlnp, root requis sur la machine)")}</Dim></span>
    </label>
  );
  // Accès SSH : un simple interrupteur. Actif = l'accès de cette IP (créé avec la clé de l'app s'il n'existe pas encore, compte root
  // port 22 comme « Lire cette machine par SSH »), inactif = on le retire. Le choix d'un autre compte se fait dans la config SSH.
  const [winGuide, setWinGuide] = useState(false);
  const agentMode = windows || windowsGuess === true || (!!agent && !v.ssh);  // un PC Windows se lit par l'agent (pas de SSH) ; on garde le SSH s'il est déjà réglé
  const key = (windows ? v.health : v.ssh) as string | null | undefined | false;
  const sshOn = typeof key === "string" && key !== "";
  const info = st.aliases.find((a) => a.alias === key);
  const sshPills = <SshAccess alias={String(key || "")} user={info?.user} ip={info ? info.ip || info.host : null} port={info?.port} />;
  // Réactivation : si un accès existe déjà pour cette IP (la config SSH garde l'alias quand on coupe l'interrupteur), on le reprend et on
  // teste la clé tout de suite ; le guide ne s'ouvre que si la connexion échoue (ou s'il n'y a encore aucun accès).
  const known = st.aliases.find((a) => a.ip === ip);
  // Interrupteur coupé, mais la collecte lit déjà la machine par SSH (alias de ~/.ssh/config pour cette adresse) : à dire clairement
  const foundSsh = !agentMode && !sshOn && v.ssh !== false && !!live?.ssh?.alias && !!live.info;
  const [reuse, setReuse] = useState<Note>(null);
  const toggleSsh = async (on: boolean) => {
    if (!on) { setWinGuide(false); setReuse(null); return void autoSave("ssh", { ssh: false, health: undefined }); }   // coupé à la main : plus lu par SSH, jamais réactivé seul
    if (!known) return setWinGuide(true);  // premier accès : le guide demande le compte et crée l'alias
    await autoSave("ssh", { ssh: known.alias, health: undefined });
    try {
      const r = await send<{ lines: string[]; failed: number }>("POST", `machines/settings/${ip}/check`);
      if (r.failed) { setReuse({ ok: false, text: tx("L'accès existe mais la connexion échoue : la clé n'est pas (ou plus) autorisée sur la machine.") }); setWinGuide(true); }
      else {
        setReuse({ ok: true, text: tx("Accès rétabli : la clé est déjà valide, rien à refaire. L'état se met à jour à la fin du prochain passage.") });
        refreshState();
      }
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setReuse({ ok: false, text: (e as Error).message });
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(() => send("PUT", `machines/settings/${ip}`, { machine: v, process: windows ? null : proc, extra: extra || [] }),
      isNew ? tx("machine ajoutée : relevé et santé lancés") : tx("enregistrée : prise en compte au prochain passage"), setNote);
    setBusy(false);
    if (ok && !isNew) setSaved(v);
    if (ok) refreshState();  // ajout ou modification : cette machine est relue tout de suite
    if (ok) setTimeout(onDone, 900);
  };
  // Carte d'une machine déjà enregistrée : l'accès SSH et les interrupteurs s'enregistrent seuls ; ce bouton ne sert qu'aux champs texte
  const dirty = isNew || ["name", "adguard", "adguard_sync"].some((k) => String(v[k] ?? "") !== String(saved[k] ?? ""));
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <section className="rounded-2xl border border-dim/50 border-l-2 border-l-link bg-bg2/30 p-4 shadow-sm">
        <button type="button" onClick={() => setSshOpen(!sshOpen)} aria-expanded={sshOpen} className="flex w-full flex-wrap items-center gap-2 text-left">
          {sshOpen ? <ChevronDown size={14} className="text-txt" aria-hidden /> : <ChevronRight size={14} className="text-txt" aria-hidden />}
          <h4 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim"><KeyRound size={13} className="text-link" aria-hidden />{tx("Sources de lecture")}</h4>
          {!sshOpen && live && <span className="ml-auto"><SourceBadges m={live} agent={agent} /></span>}
        </button>
        {sshOpen && <div className="mt-4 flex flex-col gap-4">
        <p className="text-xs leading-relaxed text-muted">
          {agentMode ? tx("Un petit script PowerShell sur le PC envoie sa santé à MyServices : système, disques, services, processeur, mémoire, mises à jour, journal, ports en écoute.") : tx("Permet à MyServices de lire cette machine : Docker, santé, système, Apache.")} <b className="text-txt">{tx("Lecture seule")}</b>{tx(" : rien n'y est modifié.")}
          <span className="block text-dim">{tx("Sans accès : ping et services web seulement.")}</span>
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-line/60 bg-bg2/70 p-3">
          <label className="flex min-w-[240px] flex-1 items-center gap-3 text-sm">
            {agentMode ? <>
              <Switch on={!!agent} onChange={() => { location.hash = `#settings/agents/${ip}`; }} label={tx("Lecture par l'agent")} />
              <span><b>{agent ? tx("Actif") : tx("Inactif")}</b>
                <Dim> · {agent ? (agent.last_seen ? tx("dernier relevé {0}", dateTime(agent.last_seen * 1000)) : tx("en attente du premier relevé")) : tx("cliquez pour installer l'agent")}</Dim></span>
            </> : <>
              <Switch on={sshOn} disabled={pending === "ssh"} onChange={(on) => void toggleSsh(on)} label={tx("Lecture par SSH")} />
              <span><b>{sshOn ? tx("Actif") : tx("Inactif")}</b> <Saved k="ssh" />
                {sshOn ? <> <Dim>·</Dim> {sshPills}</> : <Dim> · {foundSsh ? tx("activé tout seul au prochain passage") : v.ssh === false ? tx("coupé : ping et services web seulement") : tx("ping et services web seulement")}</Dim>}</span>
            </>}
          </label>
          {foundSsh && (
            <p className="basis-full rounded-lg border border-link/40 bg-link/5 px-3 py-2 text-sm text-muted">
              {tx("La clé marche déjà avec l'accès « {0} » trouvé dans la configuration SSH (d'où « SSH OK ») : l'interrupteur passe tout seul sur Actif au prochain passage de la collecte. Pour ne pas lire cette machine par SSH, coupez-le ensuite : il ne sera plus réactivé.", live!.ssh!.alias)}
              {" "}<button type="button" className="font-semibold text-link hover:underline" disabled={pending === "ssh"} onClick={() => void toggleSsh(true)}>{tx("Activer maintenant")}</button>
            </p>
          )}
          {!agentMode && sshOn && !winGuide && live && ["refused", "nossh"].includes(mState(live)) && (
            <button type="button" className="text-xs text-link hover:underline" onClick={() => setWinGuide(true)}>{tx("La connexion échoue ? Voir les commandes")}</button>
          )}
          <ul className="flex flex-wrap items-center justify-end gap-2" aria-label={tx("Ce que cet accès permet de lire")}>
            {gives.map(([label, on, why]) => (
              <li key={label} title={why}><Badge tone={on ? "ok" : "off"}>{on ? "✓" : "–"} {label}</Badge></li>
            ))}
          </ul>
        </div>
        <NoteLine note={reuse} />
        {connection && (
          <div className="rounded-lg border border-line/60 bg-bg2/70 p-3">
            <h5 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-dim">{agentMode ? tx("Lecture par l'agent") : tx("État de la connexion")}</h5>
            {connection}
          </div>
        )}
        {winGuide && <SshGuide ip={ip} port={scan?.sshPort} user={known?.user} guess={windows || windowsGuess ? "windows" : "linux"} onCancel={() => setWinGuide(false)}
          onReady={(alias) => autoSave("ssh", { os: undefined, ssh: alias, health: undefined })} />}
        {!windows && v.ssh && hasAdguard && (  // seulement si AdGuard a été trouvé sur la machine (ou déjà réglé) : sinon rien à montrer
          <div className="sm:max-w-[50%]">
            <Field label={tx("AdGuard Home trouvé (conteneur ou chemin du .yaml)")}>
              <input className={input} maxLength={80} value={v.adguard || ""} placeholder={tx("aucun")} onChange={(e) => setV({ ...v, adguard: e.target.value })} />
            </Field>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dim/50 bg-bg2/50 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-link/15 text-link"><KeyRound size={17} aria-hidden /></span>
          <div className="min-w-[220px] flex-1">
            <b className="block text-sm text-txt">{tx("La clé de l'app doit être autorisée sur cette machine")}</b>
            <span className="block text-xs leading-relaxed text-dim">{tx("L'interrupteur prépare l'accès (compte root, port 22) ; il reste à ajouter la clé publique de l'app dans authorized_keys de la machine.")}</span>
          </div>
          <a href="#settings/ssh" className={`${quiet} no-underline`} title={tx("Ouvre la clé publique et la commande à copier")}>
            <KeyRound size={14} aria-hidden />{tx("Voir la clé SSH")}<ArrowRight size={14} aria-hidden />
          </a>
        </div>
        {!agentMode && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line/60 bg-bg2/70 p-3 text-sm">
            <b>{tx("Agent")}</b>
            {agent ? <>
              <Badge tone={agent.state === "actif" ? "ok" : agent.state === "silencieux" ? "warn" : "info"}>{agent.state}</Badge>
              <Dim>v{agent.version ?? "?"} · {agent.last_seen ? tx("dernier relevé {0}", dateTime(agent.last_seen * 1000)) : tx("en attente du premier relevé")}</Dim>
              <a href={`#settings/agents/${ip}`} className="ml-auto text-xs font-semibold text-link hover:underline">{tx("Gérer l'agent")}</a>
            </> : <>
              <Dim>{tx("aucun : utile si le SSH est impossible")}</Dim>
              <a href={`#settings/agents/${ip}`} className="ml-auto text-xs font-semibold text-link hover:underline">{tx("Installer un agent")}</a>
            </>}
          </div>
        )}
        {linked.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line/60 bg-bg2/70 p-3 text-sm">
            <b>{tx("Connecteurs")}</b>
            {linked.map((c) => <a key={`${c.type}/${c.name}`} href="#settings/connectors" onClick={() => focusConnector(c.type, c.name)} title={tx("Ouvrir ce connecteur")}
              className="rounded-full border border-link/60 px-2 py-0.5 text-xs font-semibold text-link hover:bg-link/10">{c.label}</a>)}
          </div>
        )}
        {agent && sshAccess && (
          <div className="flex flex-col gap-2 rounded-lg border border-line/60 bg-bg2/70 p-3">
            <div className="flex flex-wrap items-center gap-2"><b>{tx("Lu d'abord par")}</b> <Saved k="health_sources" /></div>
            <IconChoice label={tx("Santé lue d'abord par")} disabled={pending === "health_sources"} value={((v.health_sources as string[] | undefined)?.[0] ?? "") as "" | "ssh" | "agent"}
              onPick={(src) => void autoSave("health_sources", { health_sources: src ? [src] : undefined })}
              options={[
                { value: "", label: tx("Automatique"), hint: windows ? tx("Automatique (l'agent, puis SSH)") : tx("Automatique (SSH, puis l'agent)"), icon: <Sparkles size={24} className="text-link" aria-hidden /> },
                { value: "ssh", label: "SSH", hint: tx("Lire d'abord par SSH"), icon: <KeyRound size={24} className="text-ok" aria-hidden /> },
                { value: "agent", label: tx("L'agent"), hint: tx("Lire d'abord par l'agent MyServices"), icon: <Monitor size={24} className="text-warn" aria-hidden /> },
              ]} />
            <Dim>{tx("la première source qui répond fait foi, l'autre prend le relais si elle se tait et complète ce qui manque")}</Dim>
          </div>
        )}
        </div>}
      </section>
      <section className="rounded-2xl border border-dim/50 border-l-2 border-l-ok bg-bg2/30 p-4">
        <h4 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim"><IdCard size={13} className="text-ok" aria-hidden />{tx("Identité")}</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tx("Nom")}><input className={input} required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <div>
            <TagInput label={tx("Rôle (étiquettes)")} value={v.role || ""} suggestions={roleSuggestions} placeholder={tx("ex. Docker, NAS…")}
              onChange={(role) => (isNew ? setV({ ...v, role }) : void autoSave("role", { role }, savedProc, false))} />  {/* chaque étiquette s'enregistre seule, comme un interrupteur */}
            <Saved k="role" />
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-2 text-sm text-muted">{tx("Icône")} <Saved k="icon" /></div>
          <IconPicker value={v.icon as string | undefined} disabled={pending === "icon"} autoHint={tx("appli reconnue, sinon système")}
            auto={<MachineIcon large m={{ name: v.name, role: v.role, os: v.os as string | undefined, info: live?.info, ttl: live?.ttl }} scan={scan} empty={<span className="text-xs font-semibold text-dim">{tx("Auto")}</span>} />}
            onPick={(icon) => (isNew ? setV({ ...v, icon }) : void autoSave("icon", { icon }))} />
        </div>
      </section>
      {/* Réglages courants, toujours visibles : suivre la machine, et « souvent éteinte » (PC, portable : pas d'alerte quand elle est éteinte) */}
      <section className="rounded-2xl border border-dim/50 border-l-2 border-l-warn bg-bg2/30 p-4" aria-label={tx("Réglages courants")}>
        <h4 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim"><Power size={13} className="text-warn" aria-hidden />{tx("Réglages courants")}</h4>
        <div className="grid gap-2 lg:grid-cols-2">
          <label className="flex items-start gap-2 rounded-lg border border-line/60 bg-bg2/70 p-3">
            <Switch on={!v.disabled} disabled={pending === "disabled"} onChange={(on) => void autoSave("disabled", { disabled: !on })} label={tx("Machine suivie")} />
            <span><b>{tx("Machine suivie")}</b> <Saved k="disabled" /> <Dim>· {tx("coupée : ni ping, ni SSH, ni santé, aucune alerte ; elle reste ici pour être réactivée")}</Dim></span>
          </label>
          <div className="rounded-lg border border-line/60 bg-bg2/70 p-3">{flagRow(FLAGS[0])}</div>
        </div>
      </section>
      {(activeFlags.length > 0 || procOn) && (
        <OptionGroup title={tx("Options actives")} hint={tx("Allumées pour cette machine ; les autres sont dans « Options de la machine »")}>
          {activeFlags.map(flagRow)}
          {procOn && procRow}
        </OptionGroup>
      )}
      {/* Menu pliant des autres interrupteurs : replié, sauf à l'ajout d'une machine dont la détection est à confirmer */}
      <div className="rounded-xl border border-dim/50 bg-bg2/30">
        <button type="button" onClick={() => setOptions(!options)} aria-expanded={options}
          className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-bg2/60">
          {options ? <ChevronDown size={14} className="text-txt" aria-hidden /> : <ChevronRight size={14} className="text-txt" aria-hidden />}
          {tx("Options de la machine")}
          <span className="font-mono text-xs font-normal text-dim">({detectedFlags.length + manualFlags.length + missingFlags.length + (!windows && !!v.ssh && !procOn ? 1 : 0)})</span>
        </button>
        {options && (
          <div className="flex flex-col gap-3 border-t border-line/60 p-3">
          {detectedFlags.length > 0 && (
            <OptionGroup title={tx("Détectés sur cette machine")} tone="ok">{detectedFlags.map(flagRow)}</OptionGroup>
          )}
          <div className="rounded-lg border border-line/60 bg-bg2/70">
            <button type="button" onClick={() => setManualOpen(!manualOpen)} aria-expanded={manualOpen}
              className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-dim hover:text-txt">
              {manualOpen ? <ChevronDown size={13} className="text-txt" aria-hidden /> : <ChevronRight size={13} className="text-txt" aria-hidden />}
              {tx("À changer manuellement")}
              <span className="flex flex-wrap items-center gap-1 normal-case tracking-normal">
                {manualFlags.filter((f) => v[f.k]).map((f) => <Badge key={String(f.k)} tone="off">{f.label}</Badge>)}
                {proc && !windows && !!v.ssh && <Badge tone="off">{tx("services hors Docker")}</Badge>}
              </span>
            </button>
            {manualOpen && (
              <div className="flex flex-col gap-2 border-t border-line/60 p-3">
                <p className="text-xs text-dim">{tx("Non détectables : c'est à vous de choisir.")}</p>
                {manualFlags.map(flagRow)}
                {!windows && v.ssh && !procOn && procRow}
              </div>
            )}
          </div>
          {missingFlags.length > 0 && (
            <div className="rounded-lg border border-line/60 bg-bg2/50">
              <button type="button" onClick={() => setMissingOpen(!missingOpen)} aria-expanded={missingOpen}
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-dim hover:text-txt">
                {missingOpen ? <ChevronDown size={13} className="text-txt" aria-hidden /> : <ChevronRight size={13} className="text-txt" aria-hidden />}
                {tx("Non détectés")} <span className="font-mono normal-case">({missingFlags.length})</span>
              </button>
              {missingOpen && (
                <div className="flex flex-col gap-2 border-t border-line/60 p-3">
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
        <button type="submit" className={primary} disabled={busy || !dirty} title={dirty ? undefined : tx("Rien à enregistrer : l'accès, les options et les étiquettes s'enregistrent tout seuls")}>{tx("Enregistrer")}</button>
        {actions}
      </div>
      {!report && <NoteLine note={localNote} />}
    </form>
  );
}
