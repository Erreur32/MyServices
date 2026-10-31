// Réglages → Machines : équivalent graphique de « setup.py --add ». Détecter (IP, nom ou alias SSH : ping,
// ports, SSH Linux / Windows, Docker, AdGuard, VM, services web, connecteurs reconnus), relire la proposition,
// enregistrer ; modifier, vérifier (mêmes contrôles que setup.py --check) ou retirer une machine déclarée.
// Les réglages de chaque machine sont dans sa page (#machines/<ip>) ; ici, trois sous-pages du menu Machines : ajouter et détecter,
// les appareils vus par les outils et pas suivis, les agents. La clé refusée par une machine est signalée sur la page de la clé SSH.
import { NetworkSettings } from "./NetworkSettings";
import { Box, Check, ChevronDown, Monitor, ChevronRight, IdCard, Info, KeyRound, Loader2, MonitorUp, Plug, Plus, Power, RefreshCw, Server, Gauge, ShieldCheck, Thermometer, Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type KeyboardEvent, type SetStateAction } from "react";
import { LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { Copyable, Field, NoteLine, Switch, TagInput } from "../components/form";
import { act, danger, input, primary, quiet, type Note } from "../lib/forms";
import { Badge, Card, Count, Dim } from "../components/ui";
import { dateTime } from "../lib/format";
import type { Advice, AgentInfo, Connector, Detection, MachineConf, MachinesSettings as State, NetHost, NetScan, Redetection, RedetectItem } from "../types";
import { DISMISSED_KEY } from "../lib/firstSteps";
import { needsLink } from "../lib/netScan";
import { BackButton } from "../components/BackButton";
import { MachineIcon } from "../components/MachineIcon";
import { AccessGuide, AgentBlock, AgentsOverview } from "./Agents";
import { IconPicker } from "../components/IconPicker";
import { mState, osOfMachine } from "../lib/machines";
import { AuthorizeKey } from "../components/AuthorizeKey";
import { KeyToAuthorize, SshParams, type CheckResult } from "../components/SshParams";
import { SshDetails } from "../components/ssh";
import { focusConnector } from "../lib/connectorPrefill";
import { rolesOf } from "../lib/ssh";
import { pokeScan } from "../lib/scan";
import { hardwareRows } from "../lib/hardware";
import { tx } from "../lib/i18n";
import { InfoNote } from "../components/InfoNote";
import { describeAdvice } from "../lib/access";
import { AddMachine } from "../components/AddMachine";
import { SshConnections } from "./SshConnections";

const FLAGS: { k: keyof MachineConf; label: string; help: string }[] = [
  { k: "off", label: tx("Souvent éteinte"), help: tx("Pour un PC ou un portable souvent éteint ou débranché : MyServices n'enverra pas d'alerte quand il ne répond pas. À laisser décoché pour un serveur, qui doit rester allumé.") },
  { k: "gateway", label: tx("Passerelle"), help: tx("box / routeur : sous-titre de la page") },
  { k: "npm_only", label: tx("Joignable seulement par NPM"), help: tx("pare-feu : ses services sont testés via NPM") },
  { k: "vm", label: tx("Machine virtuelle"), help: tx("ajoute l'étiquette « VM » à la machine (se coche seule si détectée). Sur Linux par SSH, SMART et la température du processeur ne sont plus lus : une VM n'en a pas") },
];

const VM_AUTO_KEY = "ms.vm.auto";

/** Machine Windows déclarée (système ou accès de santé seul) : la commande « authorized_keys » ne la concerne pas */
const isWindowsConf = (c?: MachineConf) => !!c && (c.os === "windows" || (typeof c.health === "string" && !c.ssh));

/** « compte@adresse:port » de l'accès (alias) d'une machine, d'après la liste des accès connus */
function sshWho(st: State, alias: string): string {
  const a = st.aliases.find((x) => x.alias === alias);
  return a ? `${a.user ? `${a.user}@` : ""}${a.ip || a.host}${a.port ? `:${a.port}` : ""}` : alias;
}

/** Sub-page of Machines in the address (#settings/machines/devices): add and detect (/new: its form open, /redetect: the redetection run), devices seen by the tools, agents, SSH connections */
export type MachinesPart = "add" | "devices" | "agents" | "ssh";
export const machinesPart = (v?: string): MachinesPart => (v === "devices" || v === "agents" || v === "ssh" ? v : "add");

function useMachinesState(): [State | null, string, () => void] {
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    read<State>("machines/settings")
      .then((s) => { setSt(s); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);
  return [st, error, reload];
}

export function MachinesSettings({ snap, part }: Readonly<{ snap: Snapshot; part: MachinesPart }>) {
  const [st, error, reload] = useMachinesState();
  const [detecting, setDetecting] = useState(() => location.hash.endsWith("/machines/new"));
  const [redetecting, setRedetecting] = useState(() => location.hash.endsWith("/machines/redetect"));
  const [showAccess, setShowAccess] = useState(false);
  if (!st) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  if (part === "devices") return <NetworkSettings snap={snap} parts={["hosts"]} />;
  const one = location.hash.split("/")[3];   // #settings/machines/ssh/<ip> | new: that SSH access alone; #settings/machines/agents/<ip>: the list, that row lit
  // The address only picks a known machine: its IP is then taken from the list, never from the address (nothing typed in the URL reaches the page)
  const wanted = one ? decodeURIComponent(one) : undefined;
  const open = wanted === "new" ? "new" : Object.keys(st.machines).find((ip) => ip === wanted);
  if (part === "agents") return <AgentsOverview machines={st.machines} open={open} />;
  if (part === "ssh" && open === "new") return <NewSshPage snap={snap} st={st} />;
  if (part === "ssh" && open) return <SshPage ip={open} snap={snap} st={st} />;
  if (part === "ssh") return <div className="flex flex-col gap-4"><KeyRefusedAlert snap={snap} /><SshConnections st={st} snap={snap} /></div>;
  const all = Object.keys(st.machines);
  const nOff = all.filter((ip) => st.machines[ip].disabled).length;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold"><Server size={16} aria-hidden />{tx("Machines")} <Count n={all.length - nOff} /></h2>
        {!detecting && (
          <div className="flex flex-wrap gap-2">
            {!redetecting && <button type="button" className={quiet} onClick={() => setRedetecting(true)}><RefreshCw size={14} />{tx("Redétecter")}</button>}
            <button type="button" className={primary} onClick={() => setDetecting(true)}><Plus size={14} />{tx("Ajouter une machine")}</button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setShowAccess(!showAccess)} aria-pressed={showAccess} aria-label={tx("Accès aux machines")} title={tx("Accès aux machines : agent, SSH ou connecteur, lequel choisir")}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-semibold ${showAccess ? "border-link bg-link/15 text-txt" : "border-line text-muted hover:text-txt"}`}><Info size={12} aria-hidden />{tx("Accès")}</button>
        {nOff > 0 && <Dim>{tx("{0} non suivie(s)", nOff)}</Dim>}
      </div>
      {showAccess && <AccessGuide />}
      {redetecting && <Redetect st={st} onDone={() => { setRedetecting(false); reload(); }} />}
      {detecting && <AddMachine st={st} onDone={() => { setDetecting(false); reload(); location.hash = "machines"; }}
        onCancel={() => { setDetecting(false); if (location.hash.endsWith("/machines/new")) location.hash = "machines"; }} />}
    </Card>
  );
}

/** The SSH access of one machine on a page of its own (the other machines are not listed while it is set), from Machines → SSH connections */
const toSshList = () => { location.hash = "settings/machines/ssh"; };

/** Head of an SSH page: the way back on the left, the machine (icon, name, address) as the title */
function SshHead({ title, m, ip }: Readonly<{ title: string; m?: MachineConf; ip?: string }>) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <BackButton label={tx("Connexions SSH")} onClick={toSshList} />
      <h2 className="flex items-center gap-2 text-lg font-bold">
        {m ? <MachineIcon m={{ name: m.name, os: m.os }} reserve /> : <KeyRound size={16} aria-hidden />}
        {m ? <>{m.name}<Dim>{ip}</Dim><span className="text-sm font-normal text-muted">· {title}</span></> : title}
      </h2>
      {m && ip && <button type="button" onClick={() => { location.hash = `machines/${ip}`; }} className={`${quiet} ml-auto`}><Monitor size={14} aria-hidden />{tx("Page de la machine")}</button>}
    </div>
  );
}

/** Settings are saved as they are typed: « Done » only goes back to the list */
const DoneButton = () => <div className="mt-3 flex justify-end"><button type="button" className={quiet} onClick={toSshList}><Check size={14} aria-hidden />{tx("Terminé")}</button></div>;

function SshPage({ ip, snap, st }: Readonly<{ ip: string; snap: Snapshot; st: State }>) {
  return (
    <Card>
      <SshHead title={tx("Connexion SSH")} m={st.machines[ip] ?? { name: ip }} ip={ip} />
      <MachineModal ip={ip} snap={snap} only="ssh" />
      <DoneButton />
    </Card>
  );
}

/** A new SSH connection: pick a followed machine that has none, then set its access on the same page */
function NewSshPage({ snap, st }: Readonly<{ snap: Snapshot; st: State }>) {
  const free = Object.entries(st.machines).filter(([, m]) => !m.disabled && typeof m.ssh !== "string").sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const [ip, setIp] = useState("");
  return (
    <Card>
      <SshHead title={tx("Nouvelle connexion SSH")} m={ip ? st.machines[ip] : undefined} ip={ip || undefined} />
      {free.length === 0 ? <p className="text-sm text-dim">{tx("Toutes les machines suivies ont déjà une connexion SSH. Une machine nouvelle s'ajoute dans Machines, « Ajouter une machine ».")}</p> : (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{tx("Machine")}</span>
          <select className={input} value={ip} onChange={(e) => setIp(e.target.value)}>
            <option value="">{tx("Choisir la machine…")}</option>
            {free.map(([at, m]) => <option key={at} value={at}>{m.name} · {at}</option>)}
          </select>
        </label>
      )}
      {ip && <><div className="mt-3"><MachineModal key={ip} ip={ip} snap={snap} only="ssh" /></div><DoneButton /></>}
    </Card>
  );
}

/** Machines whose Docker read is refused because the app's key is not authorised there: on top of SSH connections, with the command and a new test */
function KeyRefusedAlert({ snap }: Readonly<{ snap: Snapshot }>) {
  const [st] = useMachinesState();
  const [accepted, setAccepted] = useState<{ gen: string; ips: string[] }>({ gen: "", ips: [] });
  if (!st) return null;
  // Retrouvées par leur IP (le nom d'un connecteur est celui de la machine, pas son adresse) ; chacune a son compte SSH
  const machineOf = (c: Connector) => (c.ip ? st.machines[c.ip] : Object.values(st.machines).find((x) => x.name === c.name));
  const userOf = (c: Connector) => st.aliases.find((al) => al.alias === machineOf(c)?.ssh)?.user || "root";
  const hidden = accepted.gen === snap.data.generated ? accepted.ips : [];
  const failing = (snap.data.connectors || []).filter((c) => c.type === "docker" && !c.ok && !isWindowsConf(machineOf(c)) && !hidden.includes(c.ip ?? c.name));
  return <AuthorizeKey userOf={userOf} failing={failing} onAccepted={() => setAccepted({ gen: snap.data.generated, ips: [...hidden, ...failing.map((c) => c.ip ?? c.name)] })} />;
}

const REDETECT_FLAGS: Record<string, string> = { vm: tx("Machine virtuelle"), gateway: tx("Passerelle"), off: tx("Souvent éteinte") };

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
function Redetect({ st, onDone }: Readonly<{ st: State; onDone: () => void }>) {
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
      {res?.machines.filter((r) => r.note !== null && r.note !== "rien à changer").map((r) => <Dim key={r.ip}>{r.name} · {tx("Injoignable ou illisible : non vérifiable")}</Dim>)}
      {note && <NoteLine note={note} />}
      <div className="flex gap-2">
        {withChanges.length > 0 && <button type="button" className={primary} disabled={busy} onClick={apply}><Check size={14} />{busy ? tx("Enregistrement…") : tx("Appliquer")}</button>}
        <button type="button" className={quiet} onClick={onDone}>{withChanges.length > 0 ? tx("Annuler") : tx("Fermer")}</button>
      </div>
    </div>
  );
}

type Live = Snapshot["data"]["machine_list"][number];
type Statuses = NonNullable<Snapshot["data"]["connectors"]>;
type ScanInfo = { os?: string; apps: string[]; ssh?: boolean; sshPort?: number };
type Unfinished = { passed: boolean };

/** Only this machine is re-read (SSH, Docker, health): the others stay cached, so the pass is short */
function refreshMachine(ip: string) { void send("POST", `machines/settings/${ip}/refresh`).then(pokeScan, () => undefined); }

/** A failed check: back to the login page when the session ended, otherwise the message */
function onCheckError(e: unknown, set: (n: Note) => void) {
  if (e instanceof LoginRequired) location.replace(LOGIN);
  else set({ ok: false, text: (e as Error).message });
}

/** Access check of a machine: result lines (shown 15 s), busy flag, and the "accepted" state that lifts the warnings after a good test */
function useAccessCheck(ip: string, stamp: string, setNote: (n: Note) => void) {
  const [lines, setLines] = useState<string[] | null>(null), [busy, setBusy] = useState(false);
  const linesTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(linesTimer.current), []);
  // Un test réussi lève les avertissements tout de suite : les badges viennent du dernier passage de la collecte (une minute ou plus), sans cela
  // la carte « port faux » ou « clé refusée » resterait affichée et reviendrait « en boucle » après chaque correction.
  const [accepted, setAccepted] = useState(false);
  useEffect(() => setAccepted(false), [stamp]);   // nouveau passage : on retrouve l'état réel
  const verify = async () => {
    setBusy(true); setLines(null);
    try {
      const r = await send<{ lines: string[]; failed: number }>("POST", `machines/settings/${ip}/check`);
      setLines(r.lines);
      if (!r.failed) { setAccepted(true); refreshMachine(ip); }  // l'accès répond : avertissements levés, le badge (état du dernier passage) est remis à jour
      clearTimeout(linesTimer.current);
      linesTimer.current = setTimeout(() => setLines(null), 15_000);  // résultat visible 15 s, puis il disparaît
    } catch (e) {
      onCheckError(e, setNote);
    }
    setBusy(false);
  };
  return { lines, busy, setBusy, accepted, verify };
}

/** Warnings of the card: the app key is refused (Docker unreadable), or the SSH alias points at another port than sshd's. A machine read by its agent has neither */
function rowWarnings(accepted: boolean, statuses: Statuses, live?: Live, scan?: ScanInfo) {
  if (live?.agent) return { keyMissing: false, wrongPort: false };
  const keyMissing = !accepted && statuses.some((c) => c.type === "docker" && !c.ok);  // accès SSH activé, mais la clé de l'app n'est pas autorisée (ou le port est faux)
  const wrongPort = !accepted && !!(scan?.sshPort && live?.ssh && scan.sshPort !== live.ssh.port);   // alias sur un autre port que celui où sshd répond
  return { keyMissing, wrongPort };
}

function lineTone(l: string): string {
  if (l.startsWith("✓")) return "text-ok";
  return l.startsWith("✗") ? "text-bad" : "text-warn";
}

function CheckLines({ lines }: Readonly<{ lines: string[] }>) {
  return (
    <ul className="rounded-lg bg-bg2 p-2 font-mono text-xs">
      {lines.map((l, i) => <li key={`${i}:${l}`} className={lineTone(l)}>{l}</li>)}
    </ul>
  );
}

/** What the agent read of a Windows PC (read only), with its hardware */
function AgentReading({ agent, hw }: Readonly<{ agent: AgentInfo; hw: ReturnType<typeof hardwareRows> }>) {
  return (
    <>
    <p className="text-muted">{tx("Lu par l'agent MyServices, en lecture seule : système, disques, services, processeur, mémoire, mises à jour Windows, journal Système, ports en écoute. Pas de Docker.")}{" "}
      {agent.last_seen ? tx("Dernier relevé {0}.", dateTime(agent.last_seen * 1000)) : tx("Aucun relevé reçu pour l'instant.")}{" "}
      <a className="text-link hover:underline" href="#settings/connectors">{tx("Réglages → Connecteurs")}</a></p>
      {hw.length > 0 && <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {hw.map(([k, v]) => <Fragment key={k}><dt className="text-dim">{k}</dt><dd className="break-words text-txt">{v}</dd></Fragment>)}
      </dl>}
    </>
  );
}

function WindowsConnection({ ip, m, st, agent, hw }: Readonly<{ ip: string; m: MachineConf; st: State; agent?: AgentInfo; hw: ReturnType<typeof hardwareRows> }>) {
  if (agent) return <AgentReading agent={agent} hw={hw} />;
  if (typeof m.health === "string" && m.health) {
    return (
      <p className="text-muted">{tx("Lu par OpenSSH et PowerShell, en lecture seule : disques, services, processeur, mises à jour Windows, journal Système. Pas de Docker. Accès :")} <code className="font-mono text-xs">{sshWho(st, m.health)}</code>.
        {m.off ? <span className="block text-dim">{tx("Marqué « souvent éteinte » : la santé ne le relève pas tant que cette option est cochée.")}</span> : null}</p>
    );
  }
  return (
    <p className="text-dim">{tx("Pas d'agent : ping et services web seulement.")}{" "}
      <button type="button" className="text-link hover:underline" onClick={() => { location.hash = `machines/${ip}/agent`; }}>{tx("Installer l'agent")}</button>{tx(" pour lire sa santé sans SSH.")}</p>
  );
}

/** What the collection (SSH) or the agent read of the connection: shown in the "Accès" frame, under the switch */
function MachineConnection({ ip, m, st, live, statuses, agent }: Readonly<{ ip: string; m: MachineConf; st: State; live?: Live; statuses: Statuses; agent?: AgentInfo }>) {
  if (m.os !== "windows") return live ? <SshDetails m={live} statuses={statuses} /> : null;
  const hw = hardwareRows(live?.agent?.hardware);  // matériel lu par l'agent (modèle, BIOS, processeur, mémoire...)
  return <div className="text-sm"><WindowsConnection ip={ip} m={m} st={st} agent={agent} hw={hw} /></div>;
}

function WrongPortNotice({ live, scan, busy, onFix }: Readonly<{ live?: Live; scan?: ScanInfo; busy: boolean; onFix: () => void }>) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-muted">
      <p className="min-w-[240px] flex-1">
        <b className="text-warn">!</b> {tx("Ce n'est pas la clé : le port SSH est faux. L'accès utilise le port")} <b className="text-txt">{live?.ssh?.port}</b>
        {tx(", mais la recherche réseau a vu SSH sur le port")} <b className="text-txt">{scan?.sshPort}</b>.
      </p>
      <button type="button" className={primary} disabled={busy} onClick={onFix}>{tx("Utiliser le port {0}", scan?.sshPort ?? "")}</button>
    </div>
  );
}

function KeyMissingNotice({ sshUser, statuses }: Readonly<{ sshUser: string; statuses: Statuses }>) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-muted">
      <p>
        <b className="text-warn">!</b> {tx("Action requise : la clé SSH de l'app est refusée pour le compte")} <b className="text-txt">{sshUser}</b>{tx(" sur cette machine, donc Docker n'est pas lisible. Ce n'est pas la clé qui a changé : elle n'est pas (encore) dans les clés autorisées de ce compte.")}
      </p>
      <p>{tx("Sur la machine, connecté en")} <b className="text-txt">{sshUser}</b>{tx(", lancez :")}</p>
      <AuthorizeKey bare user={sshUser} failing={statuses.filter((c) => c.type === "docker" && !c.ok)} />
      <InfoNote>{tx("Puis « Vérifier ». Si l'accès marchait avec un autre compte (root, par exemple), revenez-y en réactivant l'accès avec ce compte.")}</InfoNote>
    </div>
  );
}

function UnfinishedNotice({ unfinished }: Readonly<{ unfinished: Unfinished }>) {
  const passed = unfinished.passed ? ` · ${tx("vous l'aviez passé dans les premiers pas")}` : "";
  return (
    <InfoNote tone="warn">
      <b className="text-warn">{tx("Non terminé")}</b>{passed} {" : "}
      {tx("le jeton de Home Assistant manque : ")}<a className="text-link hover:underline" href="#settings/connectors">{tx("Réglages → Connecteurs")}</a>
    </InfoNote>
  );
}

/** The warning notices at the top of the machine window */
function RowNotices({ keyMissing, wrongPort, unfinished, live, scan, sshUser, statuses, busy, onFixPort }: Readonly<{
  keyMissing: boolean; wrongPort: boolean; unfinished?: Unfinished; live?: Live; scan?: ScanInfo; sshUser: string; statuses: Statuses; busy: boolean; onFixPort: () => void;
}>) {
  return (
    <>
      {keyMissing && wrongPort && <WrongPortNotice live={live} scan={scan} busy={busy} onFix={onFixPort} />}
      {keyMissing && !wrongPort && <KeyMissingNotice sshUser={sshUser} statuses={statuses} />}
      {unfinished && <UnfinishedNotice unfinished={unfinished} />}
    </>
  );
}

function RowActions({ ip, busy, confirm, setConfirm, setNote, reload, verify, canRemove = true }: Readonly<{
  canRemove?: boolean; ip: string; busy: boolean; confirm: boolean; setConfirm: (on: boolean) => void; setNote: (n: Note) => void; reload: () => void; verify: () => Promise<void>;
}>) {
  return (
    <>
      <button type="button" className={quiet} disabled={busy} onClick={() => void verify()}><ShieldCheck size={14} />{busy ? tx("Vérification…") : tx("Vérifier")}</button>
      {canRemove && <span className="ml-auto flex items-center gap-1.5">
        {confirm ? <>
          <button type="button" className={danger} onClick={() => void act(() => send("DELETE", `machines/settings/${ip}`), tx("machine retirée : la recherche réseau ne la proposera plus (Machines › Appareils non suivis pour la faire revenir)"), setNote).then((ok) => { if (ok) { reload(); location.hash = "machines"; } })}>{tx("Confirmer le retrait")}</button>
          <button type="button" className={quiet} onClick={() => setConfirm(false)}>{tx("Annuler")}</button>
        </> : <button type="button" className={`${danger} px-2`} onClick={() => setConfirm(true)} aria-label={tx("Retirer")}
          title={tx("Retirer : MyServices ne suit plus cette machine et la recherche réseau ne la propose plus (une confirmation est demandée)")}><Trash2 size={15} aria-hidden /></button>}
      </span>}
    </>
  );
}

const ROLES_SHOWN = 3, ROLE_CHARS = 14;   // the card keeps one height: at most this many roles, each cut short, the others behind a « +N »

/** The roles of a machine on one line: the first ones, long names cut short (full name in the tooltip), and « +N » for the rest (listed in its tooltip) */
export function RoleBadges({ roles }: Readonly<{ roles: string[] }>) {
  const rest = roles.slice(ROLES_SHOWN);
  return (
    <>
      {roles.slice(0, ROLES_SHOWN).map((t) => <Badge key={t} tone="off" title={t}>{t.length > ROLE_CHARS ? `${t.slice(0, ROLE_CHARS - 1)}…` : t}</Badge>)}
      {rest.length > 0 && <span className="inline-flex cursor-help items-center rounded-md border border-line bg-bg2 px-1.5 py-0.5 text-xs font-semibold text-muted hover:border-link hover:text-txt" title={rest.join("\n")}>+{rest.length}</span>}
    </>
  );
}

/** The settings of one machine, in its page (#machines/<ip>): the access check, the notices and the form */
function MachineRow({ ip, m, st, live, statuses, reload, focusTab, onAgent, scan, unfinished, agent, only }: Readonly<{
  focusTab?: "access"; only?: AccessOnly; onAgent: () => void; agent?: AgentInfo; unfinished?: Unfinished; scan?: ScanInfo; ip: string; m: MachineConf; st: State; live?: Live; statuses: Statuses; reload: () => void;
}>) {
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const sshUser = st.aliases.find((a) => a.alias === m.ssh)?.user || "root";  // compte de l'accès, pour le chemin de authorized_keys
  const stamp = `${statuses.map((c) => c.ok).join()}|${live?.ssh?.port}`;
  const { lines, busy, setBusy, accepted, verify } = useAccessCheck(ip, stamp, setNote);
  const { keyMissing, wrongPort } = rowWarnings(accepted, statuses, live, scan);
  const fixPort = async () => {   // l'alias garde son compte ; seul le port change
    setBusy(true);
    await act(() => send("POST", "machines/ssh-alias", { ip, user: sshUser, port: scan?.sshPort }), tx("port corrigé : test en cours"), setNote);
    setBusy(false);
    await verify();
    reload();
  };
  const connection = m.os === "windows" || live ? <MachineConnection ip={ip} m={m} st={st} live={live} statuses={statuses} agent={agent} /> : null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <NoteLine note={note} />
      {lines && <CheckLines lines={lines} />}
      <RowNotices keyMissing={keyMissing} wrongPort={wrongPort} unfinished={unfinished} live={live} scan={scan} sshUser={sshUser} statuses={statuses} busy={busy} onFixPort={() => void fixPort()} />
      <MachineForm tabbed focusTab={focusTab} only={only} onAgent={onAgent} agent={agent} connection={connection} report={setNote} ip={ip} m={m} st={st} live={live} scan={scan} windowsGuess={osOfMachine({ os: m.os, info: live?.info, ttl: live?.ttl }, scan?.os, scan?.ssh)?.kind === "windows"} process={!!st.process_hosts[ip]} onDone={reload}
        actions={<RowActions ip={ip} busy={busy} confirm={confirm} setConfirm={setConfirm} setNote={setNote} reload={reload} verify={verify} canRemove={!only} />} />
    </div>
  );
}

/** Connector state shown in the Access tab: answering, answering late, or not answering */
function connectorState(a: { ok: boolean; stale?: boolean }): string {
  if (a.ok) return "ok";
  return a.stale ? "stale" : "bad";
}

/** Records (once per machine, in the browser) that "Machine virtuelle" was ticked alone; false when it already was */
function markVmAuto(ip: string): boolean {
  let done: string[] = [];
  try { done = JSON.parse(localStorage.getItem(VM_AUTO_KEY) || "[]") as string[]; } catch { /* mémoire du navigateur illisible */ }
  if (done.includes(ip)) return false;
  try { localStorage.setItem(VM_AUTO_KEY, JSON.stringify([...done, ip])); } catch { /* navigation privée : tant pis */ }
  return true;
}

function offHintText(ssh: MachineConf["ssh"], foundSsh: boolean): string {
  if (foundSsh) return tx("activé tout seul au prochain passage");
  return ssh === false ? tx("coupé : ping et services web seulement") : tx("ping et services web seulement");
}

/** Groupe d'interrupteurs : titre, éventuel rappel, interrupteurs en dessous */
function OptionGroup({ title, hint, tone, children }: Readonly<{ title: string; hint?: string; tone?: "ok"; children: React.ReactNode }>) {
  return (
    <fieldset className={`flex flex-col gap-2 rounded-xl border p-3 ${tone === "ok" ? "border-ok/40 bg-ok/10" : "border-dim/50 bg-bg2/70"}`}>
      <legend className="inline-flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-dim"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone === "ok" ? "bg-ok" : "bg-dim"}`} />{title}</legend>
      {hint && <InfoNote>{hint}</InfoNote>}
      {children}
    </fieldset>
  );
}

/** Une catégorie d'accès (SSH, agent, connecteurs) : titre, état à droite, contenu en dessous ; pliable (fold) */
function AccessCategory({ icon: Icon, title, badge, fold, open, children }: Readonly<{ icon: typeof KeyRound; title: string; badge?: React.ReactNode; fold?: boolean; open?: boolean; children: React.ReactNode }>) {
  const head = <><Icon size={16} className="text-link" aria-hidden />{title}{badge && <span className="ml-auto">{badge}</span>}</>;
  const cls = "rounded-2xl border border-dim/50 border-l-2 border-l-link bg-bg2/30 p-4 shadow-sm";
  if (fold) {
    return (
      <details open={open} className={`group ${cls}`}>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} className="text-dim transition-transform group-open:rotate-90" aria-hidden />{head}
        </summary>
        <div className="mt-3 flex flex-col gap-3">{children}</div>
      </details>
    );
  }
  return (
    <section className={cls}>
      <h4 className="mb-3 flex items-center gap-2 text-sm font-bold">{head}</h4>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

const CONNECTOR_STATE: Record<string, React.ReactNode> = {
  ok: <Badge tone="ok" title={tx("Ce connecteur répond et voit cette machine")}>{tx("actif")}</Badge>,
  stale: <Badge tone="warn" title={tx("Ce connecteur répond avec retard : ses données sont anciennes")}>{tx("en retard")}</Badge>,
  bad: <Badge tone="off" title={tx("Ce connecteur ne répond pas ou est coupé")}>{tx("inactif")}</Badge>,
};

type Tab = "identity" | "options" | "access";
type SaveState = { pending: string; failed: { k: string; text: string } | null; flash: string };
type AutoSave = (key: string, next: Partial<MachineConf>, nextProc?: boolean, refresh?: boolean) => Promise<void>;
type Linked = ReturnType<typeof linkedConnectors>;
type SshCtl = {
  agentMode: boolean; sshOn: boolean; foundSsh: boolean; offHint: string; winGuide: boolean; setWinGuide: (on: boolean) => void;
  reuse: Note; toggleSsh: (on: boolean) => Promise<void>; known?: State["aliases"][number];
};
type OptionsState = {
  options: boolean; setOptions: (on: boolean) => void; manualOpen: boolean; setManualOpen: (on: boolean) => void;
  missingOpen: boolean; setMissingOpen: (on: boolean) => void; unlock: boolean; setUnlock: (on: boolean) => void;
};
type FlagDef = (typeof FLAGS)[number];
type FlagCtx = { v: MachineConf; found: Set<string>; unlock: boolean; ss: SaveState; autoSave: AutoSave };

// Interrupteurs détectables (passerelle, VM, hôte NPM, poste Windows) : grisés si la détection ne les confirme pas et qu'ils
// sont éteints. Un interrupteur déjà allumé reste modifiable (pour le retirer). Les autres (NPM seulement, services hors Docker)
// ne se détectent pas : toujours libres.
const DETECTABLE = new Set(["gateway", "vm", "off"]);
const QUICK = new Set(["off"]);   // réglages courants, montrés en haut de la carte (jamais grisés ni cachés dans le menu des options)

function isLocked(k: string, ctx: FlagCtx): boolean {
  return !QUICK.has(k) && !ctx.unlock && DETECTABLE.has(k) && !ctx.found.has(k) && !ctx.v[k as keyof MachineConf];
}

/** The switches split by group: on (shown outside the menu), detected but off, not detected, not detectable */
function flagGroups(v: MachineConf, found: Set<string>) {
  const isOn = (k: string) => found.has(k) || !!v[k as keyof MachineConf];
  const menu = FLAGS.filter((f) => !QUICK.has(String(f.k)));
  return {
    active: menu.filter((f) => !!v[f.k]),
    detected: menu.filter((f) => DETECTABLE.has(String(f.k)) && isOn(String(f.k)) && !v[f.k]),
    missing: menu.filter((f) => DETECTABLE.has(String(f.k)) && !isOn(String(f.k))),
    manual: menu.filter((f) => !DETECTABLE.has(String(f.k)) && !v[f.k]),
  };
}

function failedNote(n: Note): Note {
  return n && !n.ok ? n : null;
}

function clearFlash(key: string) {
  return (f: string) => (f === key ? "" : f);
}

/** Saves a setting alone (existing machine), with the animated tick next to it; when adding (isNew), everything goes with "Enregistrer" */
function useAutoSave(o: {
  ip: string; isNew?: boolean; windows: boolean; m: MachineConf; process?: boolean; setV: Dispatch<SetStateAction<MachineConf>>; setProc: (on: boolean) => void;
  setNote: (n: Note) => void; onDone: () => void;
}) {
  const { ip, isNew, windows, setV, setProc, setNote, onDone } = o;
  const [saved, setSaved] = useState<MachineConf>(o.m), [savedProc, setSavedProc] = useState(!!o.process);
  const [flash, setFlash] = useState(""), [pending, setPending] = useState(""), [failed, setFailed] = useState<SaveState["failed"]>(null);
  const applyLocal = (key: string, next: Partial<MachineConf>, nextProc: boolean) => {
    setV((x) => ({ ...x, ...next }));
    if (key === "proc") setProc(nextProc);
  };
  const persist = async (key: string, next: Partial<MachineConf>, nextProc: boolean) => {
    setPending(key); setFailed(null);
    const machine = { ...saved, ...next };
    const body = { machine, process: windows ? null : nextProc, extra: [] };
    // Refused: the reason shows next to the field itself (not only at the bottom of the card), the old value stays on screen
    const ok = await act(() => send("PUT", `machines/settings/${ip}`, body), tx("enregistré"),
      (n) => { const bad = failedNote(n); setNote(bad); if (bad) setFailed({ k: key, text: bad.text }); });  // succès : seulement la coche animée ; erreur : message
    setPending("");
    return { ok, machine };
  };
  const autoSave: AutoSave = async (key, next, nextProc = savedProc, refresh = true) => {
    if (isNew) { applyLocal(key, next, nextProc); return; }
    const { ok, machine } = await persist(key, next, nextProc);
    if (!ok) return;
    setSaved(machine); setSavedProc(nextProc);
    applyLocal(key, next, nextProc);
    if (refresh) refreshMachine(ip);  // un réglage changé (accès, options) : cette machine est relue tout de suite, pas au prochain horaire
    onDone();            // the card list re-reads the saved settings: a tag added or removed stays after closing and reopening the card
    // name and tags already published by the server: the other tabs show them now (the PUT itself asked the page to reload)
    setFlash(key); setTimeout(() => setFlash(clearFlash(key)), 1800);
  };
  const ss: SaveState = { pending, failed, flash };
  return { autoSave, saved, setSaved, savedProc, ss };
}

// Machine virtuelle détectée sur une machine déjà enregistrée : « Machine virtuelle » se coche toute seule, une fois par machine
// (la liste est gardée par le navigateur : si l'on décoche ensuite, c'est respecté)
function useAutoVm(ip: string, isNew: boolean | undefined, m: MachineConf, live: Live | undefined, autoSave: AutoSave) {
  useEffect(() => {
    if (isNew || m.vm || m.disabled || !live?.detected?.includes("vm")) return;
    if (!markVmAuto(ip)) return;
    void autoSave("vm", { vm: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.detected?.join(), isNew]);
}

/** State of the collapsible options menu: folded, except when adding a machine whose detection is to be confirmed */
function useOptionsState(isNew: boolean | undefined, detected: string[]): OptionsState {
  const [unlock, setUnlock] = useState(false);  // détection incomplète : débloque tous les interrupteurs
  const [options, setOptions] = useState(() => !!isNew && detected.length > 0);
  const [missingOpen, setMissingOpen] = useState(false), [manualOpen, setManualOpen] = useState(false);
  return { options, setOptions, manualOpen, setManualOpen, missingOpen, setMissingOpen, unlock, setUnlock };
}

/** Connectors that see this machine (API and matched network tools), without duplicates */
function linkedConnectors(live?: Live) {
  return [...new Map([
    ...(live?.api ?? []).map((a) => [`${a.type}/${a.name}`, { type: a.type, name: a.name, label: a.label, state: connectorState(a) }] as const),
    ...(live?.links?.sources ?? []).map((x) => [`${x.source}/${x.instance}`, { type: x.source, name: x.instance, label: x.label, state: x.ok === false ? "bad" : "ok" }] as const),
  ]).values()];
}

/** What the chosen access allows (follows the form, even before saving) */
function sshStatus(o: { v: MachineConf; windows: boolean; windowsGuess?: boolean; agent?: AgentInfo; live?: Live }) {
  const { v, windows, windowsGuess, agent, live } = o;
  const sshAccess = windows ? !!v.health : !!v.ssh;
  const agentMode = windows || windowsGuess === true || (!!agent && !v.ssh);  // un PC Windows se lit par l'agent (pas de SSH) ; on garde le SSH s'il est déjà réglé
  const key = (windows ? v.health : v.ssh) as string | null | undefined | false;
  const sshOn = typeof key === "string" && key !== "";
  const refusedSsh = sshOn && !!live && ["refused", "nossh", "down"].includes(mState(live));
  // Interrupteur coupé, mais la collecte lit déjà la machine par SSH (alias de ~/.ssh/config pour cette adresse) : à dire clairement
  const foundSsh = !agentMode && !sshOn && v.ssh !== false && !!live?.ssh?.alias && !!live.info;
  return { sshAccess, agentMode, sshOn, refusedSsh, foundSsh };
}

/**
 * SSH access: a simple switch. On = the access of this IP (created with the app key if it does not exist yet, root account
 * port 22), off = removed. Re-enabling reuses an existing access and tests the key at once; the guide opens only if it fails
 * (or if there is no access yet).
 */
function useSshToggle(ip: string, known: State["aliases"][number] | undefined, autoSave: AutoSave) {
  const [winGuide, setWinGuide] = useState(false), [reuse, setReuse] = useState<Note>(null);
  const recheck = async () => {
    try {
      const r = await send<{ lines: string[]; failed: number }>("POST", `machines/settings/${ip}/check`);
      if (r.failed) { setReuse({ ok: false, text: tx("L'accès existe mais la connexion échoue : la clé n'est pas (ou plus) autorisée sur la machine.") }); setWinGuide(true); return; }
      setReuse({ ok: true, text: tx("Accès rétabli : la clé est déjà valide, rien à refaire. L'état se met à jour à la fin du prochain passage.") });
      refreshMachine(ip);
    } catch (e) {
      onCheckError(e, setReuse);
    }
  };
  const toggleSsh = async (on: boolean) => {
    if (!on) { setWinGuide(false); setReuse(null); return void autoSave("ssh", { ssh: false, health: undefined }); }   // coupé à la main : plus lu par SSH, jamais réactivé seul
    if (!known) return setWinGuide(true);  // premier accès : le guide demande le compte et crée l'alias
    await autoSave("ssh", { ssh: known.alias, health: undefined });
    await recheck();
  };
  return { winGuide, setWinGuide, reuse, toggleSsh };
}

/** Tags offered in one click from what the machine really is: Docker (containers read), Apache, nginx, SSH, Windows, VM, gateway, NPM */
function roleSuggestionsOf(live: Live | undefined, v: MachineConf, found: Set<string>): string[] {
  const i = live?.info;
  let os = "";
  if (v.os === "windows") os = "Windows";
  else if (v.ssh) os = "SSH";
  const roles: [boolean, string][] = [
    [!!(i?.docker || i?.docker_installed), "Docker"], [!!i?.apache, "Apache"], [!!i?.nginx, "nginx"], [!!os, os],
    [!!(v.vm || found.has("vm")), "VM"], [!!(v.gateway || found.has("gateway")), "Passerelle"], [!!(v.npm || found.has("npm")), "NPM"],
  ];
  return roles.filter(([on]) => on).map(([, name]) => name);
}

function submitMessage(isNew?: boolean): string {
  return isNew ? tx("machine ajoutée : relevé et santé lancés") : tx("enregistrée : prise en compte au prochain passage");
}

function submitBody(v: MachineConf, proc: boolean, extra?: Detection["web"]) {
  return { machine: v, process: v.os === "windows" ? null : proc, extra: extra || [] };
}

const asText = (x: unknown) => (typeof x === "string" ? x : "");

/** Existing card: SSH and switches save alone; the button is only for the text fields */
function isDirty(isNew: boolean | undefined, v: MachineConf, saved: MachineConf): boolean {
  return !!isNew || ["name", "adguard", "adguard_sync"].some((k) => asText(v[k]) !== asText(saved[k]));
}

function SavedMark({ k, s }: Readonly<{ k: string; s: SaveState }>) {
  if (s.pending === k) return <Loader2 size={13} className="animate-spin text-dim" aria-label={tx("enregistrement…")} />;
  if (s.failed?.k === k) return <span className="text-xs font-semibold text-bad" role="alert">⚠ {tx("non enregistré :")} {s.failed.text}</span>;
  if (s.flash === k) return <span className="saved-pop inline-flex items-center gap-1 text-xs font-semibold text-ok"><Check size={13} aria-hidden />{tx("enregistré")}</span>;
  return null;
}

function TabBar({ tab, setTab }: Readonly<{ tab: Tab; setTab: (t: Tab) => void }>) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {([["identity", tx("Identité"), IdCard], ["options", tx("Options"), Power], ["access", tx("Accès"), KeyRound]] as const).map(([id, label, Icon]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
          className={`flex items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-sm font-semibold transition-colors ${tab === id ? "bg-card text-txt shadow-[inset_0_-1.5px_0_rgb(var(--link))]" : "text-muted hover:bg-bg2 hover:text-txt"}`}>
          <Icon size={15} strokeWidth={1.75} aria-hidden />{label}
        </button>
      ))}
    </div>
  );
}

/* ---- Access tab ---- */

function SshSummary({ sshOn, agentMode, refused }: Readonly<{ sshOn: boolean; agentMode: boolean; refused: boolean }>) {
  if (!sshOn || agentMode) return <Badge tone="off">{tx("inactif")}</Badge>;
  return <Badge tone={refused ? "warn" : "ok"} title={refused ? tx("L'accès est réglé mais la connexion échoue") : undefined}>{refused ? tx("refusé") : tx("actif")}</Badge>;
}

/** Why one would install an agent (shown when there is none) */
const AGENT_HINT = () => tx("Utile quand le SSH est impossible et qu'aucun connecteur ne voit la machine.");

function AgentSummary({ agent }: Readonly<{ agent?: AgentInfo }>) {
  if (!agent) return <Badge tone="off" title={AGENT_HINT()}>{tx("aucun")}</Badge>;
  return <Badge tone={agent.state === "actif" ? "ok" : "warn"}>{agent.state}</Badge>;
}

function ConnectorSummary({ linked }: Readonly<{ linked: Linked }>) {
  if (linked.length === 0) return <Badge tone="off">{tx("aucun")}</Badge>;
  const active = linked.filter((c) => c.state === "ok").length;
  return <Badge tone={active === linked.length ? "ok" : "warn"}>{active}/{linked.length} {tx("actifs")}</Badge>;
}

function SshSwitchRow({ ctl, live, ss, proc, autoSave }: Readonly<{ ctl: SshCtl; live?: Live; ss: SaveState; proc: boolean; autoSave: AutoSave }>) {
  const { agentMode, sshOn, offHint, toggleSsh } = ctl;
  const notRoot = !!ctl.known?.user && ctl.known.user !== "root";
  const showHelp = !agentMode && sshOn && !ctl.winGuide && !!live && ["refused", "nossh"].includes(mState(live));
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-line/60 bg-bg2/70 p-3">
      <label className="flex min-w-[240px] flex-1 items-center gap-3 text-sm">
        {agentMode ? <span className="text-sm text-muted">{tx("Lue par l'agent MyServices : son état et ses réglages sont plus bas.")}</span> : <>
          <Switch on={sshOn} disabled={ss.pending === "ssh"} onChange={(on) => void toggleSsh(on)} label={tx("Lecture par SSH")} />
          <span><b>{sshOn ? tx("Actif") : tx("Inactif")}</b> <SavedMark k="ssh" s={ss} />
            {!sshOn && <Dim> · {offHint}</Dim>}</span>
        </>}
      </label>
      {ctl.foundSsh && (
        <InfoNote className="basis-full">
          {tx("La clé marche déjà avec l'accès « {0} » trouvé dans la configuration SSH (d'où « SSH OK ») : l'interrupteur passe tout seul sur Actif au prochain passage de la collecte. Pour ne pas lire cette machine par SSH, coupez-le ensuite : il ne sera plus réactivé.", live?.ssh?.alias)}
          {" "}<button type="button" className="font-semibold text-link hover:underline" disabled={ss.pending === "ssh"} onClick={() => void toggleSsh(true)}>{tx("Activer maintenant")}</button>
        </InfoNote>
      )}
      {!agentMode && sshOn && (
        <label className="flex items-center gap-2 text-sm" title={tx("Ports en écoute hors Docker (ss -tlnp : root, ou une règle sudo sur la machine)")}>
          <Switch on={proc} disabled={ss.pending === "proc"} onChange={(on) => void autoSave("proc", {}, on)} label={tx("Services hors Docker")} />
          <span><b>{tx("Services hors Docker")}</b> <SavedMark k="proc" s={ss} /> <Dim>· {tx("ports en écoute")}</Dim></span>
        </label>
      )}
      {!agentMode && sshOn && notRoot && <NotRootHint user={ctl.known?.user ?? ""} />}
      {showHelp && (
        <button type="button" className="text-xs text-link hover:underline" onClick={() => ctl.setWinGuide(true)}>{tx("La connexion échoue ? Revoir les paramètres et la clé")}</button>
      )}
    </div>
  );
}

/** SSH account that is not root: the listening ports of the other accounts need a sudo rule on the machine, given behind a discreet link */
function NotRootHint({ user }: Readonly<{ user: string }>) {
  const [how, setHow] = useState(false);
  const rule = `echo '${user} ALL=(root) NOPASSWD: /usr/bin/ss -tlnpH' | sudo tee /etc/sudoers.d/myservices-ports >/dev/null && sudo chmod 440 /etc/sudoers.d/myservices-ports`;
  return (
    <InfoNote tone="warn" className="basis-full">
      <b className="text-warn">!</b> {tx("Le compte SSH est « {0} », pas root : il ne voit que ses propres ports en écoute, pas ceux des autres comptes.", user)}
      {" "}<button type="button" className="text-link hover:underline" aria-expanded={how} onClick={() => setHow(!how)}>{how ? tx("Masquer") : tx("Comment faire sur la machine ?")}</button>
      {how && (
        <span className="mt-2 block">
          {tx("Sur la machine, en root (ou avec sudo), autorisez ce compte à lancer « ss -tlnpH » seul, sans mot de passe : lecture seule, rien d'autre. La collecte l'utilise au passage suivant.")}
          <Copyable text={rule} />
        </span>
      )}
    </InfoNote>
  );
}

function osKind(windows: boolean, windowsGuess?: boolean): "windows" | "linux" {
  return windows || windowsGuess ? "windows" : "linux";
}

function SshBody({ ctl, ip, v, setV, live, scan, windowsGuess, hasAdguard, connection, ss, autoSave, proc }: Readonly<{
  ctl: SshCtl; ip: string; v: MachineConf; setV: (v: MachineConf) => void; live?: Live; scan?: ScanInfo; windowsGuess?: boolean; hasAdguard: boolean;
  connection?: React.ReactNode; ss: SaveState; autoSave: AutoSave; proc: boolean;
}>) {
  const windows = v.os === "windows";
  const kind = osKind(windows, windowsGuess);
  const [user, setUser] = useState(ctl.known?.user || "root");
  const refused = !!live && ["refused", "nossh"].includes(mState(live));
  const setup = ctl.winGuide;   // switch turned on without any access yet: the parameters are asked first
  const alias = ctl.known?.alias ?? (typeof v.ssh === "string" ? v.ssh : typeof v.health === "string" ? v.health : null);
  // The alias is written: the machine takes it (Windows: health access, Linux: ssh), then it is checked
  const applied = async (r: { alias: string }) => {
    ctl.setWinGuide(false);
    if (alias !== r.alias || !ctl.sshOn) await autoSave("ssh", windows ? { health: r.alias, ssh: null } : { ssh: r.alias, health: undefined });
    refreshMachine(ip);
  };
  return (
    <>
        <InfoNote>
          {ctl.agentMode ? tx("Un petit script PowerShell sur le PC envoie sa santé à MyServices : système, disques, services, processeur, mémoire, mises à jour, journal, ports en écoute.") : tx("Lecture seule par SSH avec la clé de l'app : Docker, santé, système, Apache. Sans accès : ping et services web seulement.")}
        </InfoNote>
        <SshSwitchRow ctl={ctl} live={live} ss={ss} proc={proc} autoSave={autoSave} />
        <NoteLine note={ctl.reuse} />
        {!ctl.agentMode && (ctl.sshOn || setup) && (
          <div className={`flex flex-col gap-3 rounded-lg border p-3 ${setup ? "border-link/60 bg-link/5" : "border-line/60 bg-bg2/70"}`}>
            <h5 className="text-xs font-semibold uppercase tracking-wide text-dim">{tx("Paramètres de connexion")}</h5>
            <SshParams ip={ip} known={ctl.known} alias={alias} first={setup} onUser={setUser} defaults={{ port: live?.ssh?.port ?? scan?.sshPort ?? 22 }}
              onApplied={applied} probe={() => send<CheckResult>("POST", `machines/settings/${ip}/check`)} />
            <details open={setup || refused} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <ChevronRight size={14} className="text-dim transition-transform group-open:rotate-90" aria-hidden />{tx("Clé de l'app à autoriser sur la machine")}
                {refused && <Badge tone="warn">{tx("connexion refusée")}</Badge>}
              </summary>
              <div className="mt-2"><KeyToAuthorize user={user} kind={kind} /></div>
            </details>
            {setup && <button type="button" className={`${quiet} self-start`} onClick={() => ctl.setWinGuide(false)}>{tx("Annuler")}</button>}
          </div>
        )}
        {connection && !ctl.agentMode && (
          <div className="rounded-lg border border-line/60 bg-bg2/70 p-3">
            <h5 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-dim">{tx("État de la connexion")}</h5>
            {connection}
          </div>
        )}
        {!windows && v.ssh && hasAdguard && (  // seulement si AdGuard a été trouvé sur la machine (ou déjà réglé) : sinon rien à montrer
          <div className="sm:max-w-[50%]">
            <Field label={tx("AdGuard Home trouvé (conteneur ou chemin du .yaml)")}>
              <input className={input} maxLength={80} value={v.adguard || ""} placeholder={tx("aucun")} onChange={(e) => setV({ ...v, adguard: e.target.value })} />
            </Field>
          </div>
        )}
        {!ctl.agentMode && !ctl.sshOn && !setup && <Dim>{tx("Allumez « Lecture par SSH » pour régler l'adresse, le port et le compte.")}</Dim>}
    </>
  );
}

/** The server advice for this machine (access_advice.py); null until it is read or when the read fails */
function useAdvice(ip: string, skip?: boolean): Advice | null {
  const [advice, setAdvice] = useState<Advice | null>(null);
  useEffect(() => {
    if (skip) return;
    read<{ advice: Record<string, Advice> }>("machines/advice").then((r) => setAdvice(r.advice[ip] ?? null)).catch(() => undefined);
  }, [ip, skip]);
  return advice;
}

function AgentBody({ ip, v, windowsGuess, agent, agentMode, isNew, onAgent, connection }: Readonly<{
  ip: string; v: MachineConf; windowsGuess?: boolean; agent?: AgentInfo; agentMode: boolean; isNew?: boolean; onAgent?: () => void; connection?: React.ReactNode;
}>) {
  const windows = v.os === "windows";
  const advice = useAdvice(ip, isNew || !onAgent || !!agent);
  if (!agent && advice && !advice.agent_possible)   // Freebox, ESXi, Home Assistant OS, closed NAS: nothing to install, say why
    return <InfoNote>{tx("Pas d'agent possible sur cette machine.")} {describeAdvice(ip, advice).why}</InfoNote>;
  return (
    <>
        {connection && agentMode && (
          <div className="rounded-lg border border-line/60 bg-bg2/70 p-3">
            <h5 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-dim">{tx("Lecture par l'agent")}</h5>
            {connection}
          </div>
        )}
        {!isNew && onAgent && !agent && <InfoNote>{AGENT_HINT()}</InfoNote>}
        {!isNew && onAgent && <AgentBlock ip={ip} name={v.name} kind={osKind(windows, windowsGuess)} agent={agent} onChanged={onAgent} />}
    </>
  );
}

function ConnectorsBody({ linked }: Readonly<{ linked: Linked }>) {
  if (linked.length === 0) return <p className="text-sm text-dim">{tx("Aucun connecteur ne voit cette machine pour l'instant.")} <a className="text-link hover:underline" href="#settings/connectors">{tx("Réglages → Connecteurs")}</a></p>;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line/60 bg-bg2/70 p-3 text-sm">
        <b>{tx("Connecteurs")}</b>
        <ul className="flex flex-col divide-y divide-line/40">
          {linked.map((c) => (
            <li key={`${c.type}/${c.name}`} className="flex items-center gap-3 py-1.5">
              <a href="#settings/connectors" onClick={() => focusConnector(c.type, c.name)} title={tx("Ouvrir ce connecteur")} className="font-semibold text-link hover:underline">{c.label}</a>
              <Dim>{c.name}</Dim>
              <span className="ml-auto">{CONNECTOR_STATE[c.state]}</span>
            </li>
          ))}
        </ul>
      </div>
  );
}

type AccessOnly = "ssh" | "agent";

/** One access alone, on its own settings page: the SSH block (or why the machine has none), or the agent's */
function OnlyAccess({ only, agentMode, sshBody, agentBody }: Readonly<{ only: AccessOnly; agentMode: boolean; sshBody: React.ReactNode; agentBody: React.ReactNode }>) {
  if (only === "agent") return <>{agentBody}</>;
  return agentMode ? <p className="text-sm text-muted">{tx("Cette machine est lue par son agent, sans SSH.")}</p> : <>{sshBody}</>;
}

/** L'accès d'une machine en trois catégories distinctes : SSH, agent, connecteurs (dans la fenêtre) ; à l'ajout, une seule section comme avant */
function AccessTab({ tabbed, agentMode, sshBody, agentBody, connectorsBody, sshSummary, agentSummary, connectorSummary, agentActive, connectorsActive }: Readonly<{
  tabbed?: boolean; agentActive: boolean; connectorsActive: boolean; agentMode: boolean; sshBody: React.ReactNode; agentBody: React.ReactNode; connectorsBody: React.ReactNode;
  sshSummary: React.ReactNode; agentSummary: React.ReactNode; connectorSummary: React.ReactNode;
}>) {
  if (!tabbed) return <AccessCategory icon={KeyRound} title={tx("Sources de lecture")}>{sshBody}</AccessCategory>;
  return (
    <>
      <section className="grid gap-2 sm:grid-cols-3" aria-label={tx("Accès disponibles")}>
        {([["SSH", KeyRound, sshSummary], [tx("Agent"), MonitorUp, agentSummary], [tx("Connecteurs"), Plug, connectorSummary]] as const).map(([label, Icon, badge]) => (
          <div key={label} className="flex items-center gap-2 rounded-xl border border-line/60 bg-bg2/70 px-3 py-2">
            <Icon size={16} className="shrink-0 text-link" aria-hidden />
            <b className="text-sm">{label}</b>
            <span className="ml-auto">{badge}</span>
          </div>
        ))}
      </section>
      <AccessCategory fold icon={KeyRound} title="SSH" badge={sshSummary}>
        {agentMode ? <p className="text-sm text-muted">{tx("Cette machine est lue par son agent, sans SSH.")}</p> : sshBody}
      </AccessCategory>
      <AccessCategory fold open={agentActive || location.hash.endsWith("/agent")} icon={MonitorUp} title={tx("Agent")} badge={agentSummary}>{agentBody}</AccessCategory>
      <AccessCategory fold open={connectorsActive} icon={Plug} title={tx("Connecteurs")} badge={connectorSummary}>{connectorsBody}</AccessCategory>
    </>
  );
}

/* ---- Identity tab ---- */

function IdentityTab({ v, setV, isNew, live, scan, found, ss, autoSave, savedProc }: Readonly<{
  v: MachineConf; setV: (v: MachineConf) => void; isNew?: boolean; live?: Live; scan?: ScanInfo; found: Set<string>; ss: SaveState; autoSave: AutoSave; savedProc: boolean;
}>) {
  return (
    <section className="rounded-2xl border border-dim/50 border-l-2 border-l-ok bg-bg2/30 p-4">
      <h4 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim"><IdCard size={13} className="text-ok" aria-hidden />{tx("Identité")}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tx("Nom")}><input className={input} required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <div>
          <TagInput label={tx("Rôle (étiquettes)")} value={v.role || ""} suggestions={roleSuggestionsOf(live, v, found)} placeholder={tx("ex. Docker, NAS…")}
            onChange={(role) => (isNew ? setV({ ...v, role }) : void autoSave("role", { role }, savedProc, false))} />{/* chaque étiquette s'enregistre seule, comme un interrupteur */}
          <SavedMark k="role" s={ss} />
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center gap-2 text-sm text-muted">{tx("Icône")} <SavedMark k="icon" s={ss} /></div>
        <IconPicker value={v.icon as string | undefined} disabled={ss.pending === "icon"} autoHint={tx("appli reconnue, sinon système")}
          auto={<MachineIcon large m={{ name: v.name, role: v.role, os: v.os as string | undefined, info: live?.info, ttl: live?.ttl }} scan={scan} empty={<span className="text-xs font-semibold text-dim">{tx("Auto")}</span>} />}
          onPick={(icon) => (isNew ? setV({ ...v, icon }) : void autoSave("icon", { icon }))} />
      </div>
    </section>
  );
}

/* ---- Options tab ---- */

function FlagRow({ f, ctx }: Readonly<{ f: FlagDef; ctx: FlagCtx }>) {
  const k = String(f.k);
  const locked = isLocked(k, ctx);
  return (
    <label className={`flex items-start gap-2 ${locked ? "opacity-50" : ""}`}
      title={locked ? tx("Non détecté sur cette machine : grisé") : undefined}>
      <Switch on={!!ctx.v[f.k]} disabled={locked || ctx.ss.pending === k} onChange={(on) => void ctx.autoSave(k, { [f.k]: on })} label={f.label} />
      <span>{f.label} {ctx.found.has(k) && <Badge tone="info" title={tx("Trouvé par la détection : décochez si c'est faux")}>{tx("détecté")}</Badge>} <SavedMark k={k} s={ctx.ss} /> <Dim>· {f.help}</Dim></span>
    </label>
  );
}


/** Réglages courants, toujours visibles : suivre la machine, et « souvent éteinte » (PC, portable : pas d'alerte quand elle est éteinte) */
function QuickSettings({ ctx }: Readonly<{ ctx: FlagCtx }>) {
  const { v, ss, autoSave } = ctx;
  return (
    <section className="rounded-2xl border border-dim/50 border-l-2 border-l-warn bg-bg2/30 p-4" aria-label={tx("Réglages courants")}>
      <h4 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim"><Power size={13} className="text-warn" aria-hidden />{tx("Réglages courants")}</h4>
      <InfoNote className="mb-3">{tx("Suivre une machine, c'est la pinger et la lire avec ses sources (SSH, agent, connecteurs) pour la santé et les alertes. Une machine souvent éteinte (PC, portable) ne déclenche pas d'alerte quand elle ne répond pas.")}</InfoNote>
      <div className="grid gap-2 lg:grid-cols-2">
        <label className="flex items-start gap-2 rounded-lg border border-line/60 bg-bg2/70 p-3">
          <Switch on={!v.disabled} disabled={ss.pending === "disabled"} onChange={(on) => void autoSave("disabled", { disabled: !on })} label={tx("Machine suivie")} />
          <span><b>{tx("Machine suivie")}</b> <SavedMark k="disabled" s={ss} /> <Dim>· {tx("coupée : ni ping, ni SSH, ni santé, aucune alerte ; elle reste ici pour être réactivée")}</Dim></span>
        </label>
        <div className="rounded-lg border border-line/60 bg-bg2/70 p-3"><FlagRow f={FLAGS[0]} ctx={ctx} /></div>
      </div>
    </section>
  );
}

function Chevron({ open, size }: Readonly<{ open: boolean; size: number }>) {
  const Icon = open ? ChevronDown : ChevronRight;
  return <Icon size={size} className="text-txt" aria-hidden />;
}

function ManualGroup({ groups, ctx, menu }: Readonly<{
  groups: ReturnType<typeof flagGroups>; ctx: FlagCtx; menu: OptionsState;
}>) {
  const { v } = ctx;
  return (
    <div className="rounded-lg border border-line/60 bg-bg2/70">
      <button type="button" onClick={() => menu.setManualOpen(!menu.manualOpen)} aria-expanded={menu.manualOpen}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-dim hover:text-txt">
        <Chevron open={menu.manualOpen} size={13} />
        {tx("À changer manuellement")}
        <span className="flex flex-wrap items-center gap-1 normal-case tracking-normal">
          {groups.manual.filter((f) => v[f.k]).map((f) => <Badge key={String(f.k)} tone="off">{f.label}</Badge>)}
        </span>
      </button>
      {menu.manualOpen && (
        <div className="flex flex-col gap-2 border-t border-line/60 p-3">
          <p className="text-xs text-dim">{tx("Non détectables : c'est à vous de choisir.")}</p>
          {groups.manual.map((f) => <FlagRow key={String(f.k)} f={f} ctx={ctx} />)}
        </div>
      )}
    </div>
  );
}

function MissingGroup({ groups, ctx, menu }: Readonly<{ groups: ReturnType<typeof flagGroups>; ctx: FlagCtx; menu: OptionsState }>) {
  return (
    <div className="rounded-lg border border-line/60 bg-bg2/50">
      <button type="button" onClick={() => menu.setMissingOpen(!menu.missingOpen)} aria-expanded={menu.missingOpen}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-dim hover:text-txt">
        <Chevron open={menu.missingOpen} size={13} />
        {tx("Non détectés")} <span className="font-mono normal-case">({groups.missing.length})</span>
      </button>
      {menu.missingOpen && (
        <div className="flex flex-col gap-2 border-t border-line/60 p-3">
          {!menu.unlock && <p className="text-xs text-dim">{tx("Grisés : la détection ne les confirme pas (elle relit la machine à chaque collecte).")}</p>}
          {groups.missing.map((f) => <FlagRow key={String(f.k)} f={f} ctx={ctx} />)}
          {!menu.unlock && <button type="button" className="self-start text-xs text-link hover:underline" onClick={() => menu.setUnlock(true)}>{tx("Détection incomplète ? Tout débloquer")}</button>}
        </div>
      )}
    </div>
  );
}

function OptionsMenuBody({ groups, ctx, menu }: Readonly<{
  groups: ReturnType<typeof flagGroups>; ctx: FlagCtx; menu: OptionsState;
}>) {
  return (
    <div className="flex flex-col gap-3 border-t border-line/60 p-3">
      {groups.detected.length > 0 && (
        <OptionGroup title={tx("Détectés sur cette machine")} tone="ok">{groups.detected.map((f) => <FlagRow key={String(f.k)} f={f} ctx={ctx} />)}</OptionGroup>
      )}
      <ManualGroup groups={groups} ctx={ctx} menu={menu} />
      {groups.missing.length > 0 && <MissingGroup groups={groups} ctx={ctx} menu={menu} />}
    </div>
  );
}

/** Containers this machine may leave stopped: one stopped on purpose (even with an exit code 1) is not a Docker failure */
function StoppedOkSetting({ ctx }: Readonly<{ ctx: FlagCtx }>) {
  const { v, ss, autoSave } = ctx;
  const names = Array.isArray(v.stopped_ok) ? (v.stopped_ok as string[]) : [];
  return (
    <section className="rounded-2xl border border-dim/50 border-l-2 border-l-link bg-bg2/30 p-4" aria-label={tx("Conteneurs arrêtés exprès")}>
      <h4 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim"><Box size={13} className="text-link" aria-hidden />{tx("Conteneurs arrêtés exprès")}</h4>
      <InfoNote className="mb-3">{tx("Un conteneur arrêté avec un code d'erreur (par exemple 1, quand une appli sort en erreur à l'arrêt) compte comme une panne Docker. Un nom ajouté ici est rangé avec les arrêts voulus : plus d'avertissement, mais un conteneur qui redémarre en boucle reste signalé.")}</InfoNote>
      <TagInput label={tx("Peuvent rester arrêtés")} value={names.join(", ")} max={600} placeholder={tx("nom du conteneur, ex. koboldcpp")}
        onChange={(text) => void autoSave("stopped_ok", { stopped_ok: text.split(",").map((t) => t.trim()).filter(Boolean) })} />
      <SavedMark k="stopped_ok" s={ss} />
    </section>
  );
}

const TEMP_MIN = 50, TEMP_MAX = 110, TEMP_DEFAULT = 85;   // °C, as machines_admin.py accepts them

/** Processor temperature threshold of this machine: health warns above it once the machine stays hot (critical 10 °C higher) */
/** A number with a default: the field always shows the value in force, so that its arrows start from it; emptied, it goes back to the default.
 *  The default is not stored: the machine goes on following it. */
function useLimit(ctx: FlagCtx, k: LimitKey | "temp_warn_c", base: number, min: number, max: number) {
  const { v, autoSave } = ctx;
  const cur = typeof v[k] === "number" ? v[k] : null;
  const shown = String(cur ?? base);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const n = draft.trim() === "" ? base : Number(draft);
    if (!Number.isInteger(n) || n < min || n > max) { setDraft(shown); return; }
    setDraft(String(n));
    const kept = n === base ? null : n;
    if (kept !== cur) void autoSave(k, { [k]: kept ?? undefined });
  };
  return { value: draft, onChange: (e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value), onBlur: commit, onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter") commit(); } };
}

function TempSetting({ ctx }: Readonly<{ ctx: FlagCtx }>) {
  const field = useLimit(ctx, "temp_warn_c", TEMP_DEFAULT, TEMP_MIN, TEMP_MAX);
  return (
    <section className="rounded-2xl border border-dim/50 border-l-2 border-l-link bg-bg2/30 p-4" aria-label={tx("Seuil de température")}>
      <h4 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim"><Thermometer size={13} className="text-link" aria-hidden />{tx("Seuil de température")}</h4>
      <InfoNote className="mb-3">{tx("Au-dessus de ce seuil, le processeur met la machine « à surveiller » (critique 10 °C plus haut), mais seulement s'il y reste plus de dix minutes : un pic pendant une compilation ou une sauvegarde ne compte pas. Vide : {0} °C.", TEMP_DEFAULT)}</InfoNote>
      <label className="inline-flex items-center gap-2 text-sm text-muted">{tx("Avertir à partir de")}
        <input className={`${input} w-24`} type="number" min={TEMP_MIN} max={TEMP_MAX} step={1} {...field} />
        <span>°C</span>
      </label>
      <SavedMark k="temp_warn_c" s={ctx.ss} />
    </section>
  );
}

type LimitKey = "disk_warn_pct" | "disk_crit_pct" | "mem_warn_pct" | "mem_crit_pct";
const LIMITS: { kind: string; keys: [LimitKey, LimitKey]; defaults: [number, number] }[] = [
  { kind: tx("Disque"), keys: ["disk_warn_pct", "disk_crit_pct"], defaults: [80, 90] },
  { kind: tx("Mémoire"), keys: ["mem_warn_pct", "mem_crit_pct"], defaults: [90, 97] },
];   // defaults of health.py (DISK_*_PCT, MEM_*_PCT)

function LimitInput({ ctx, k, label, base }: Readonly<{ ctx: FlagCtx; k: LimitKey; label: string; base: number }>) {
  const field = useLimit(ctx, k, base, 1, 100);
  return (
    <label className="inline-flex items-center gap-2 text-sm text-muted">{label}
      <input className={`${input} w-20`} type="number" min={1} max={100} step={1} {...field} />
      %<SavedMark k={k} s={ctx.ss} />
    </label>
  );
}

/** Disk and memory alert limits of this machine (% used): « to watch » from the first, « critical » from the second */
function LimitsSetting({ ctx }: Readonly<{ ctx: FlagCtx }>) {
  return (
    <section className="rounded-2xl border border-dim/50 border-l-2 border-l-link bg-bg2/30 p-4" aria-label={tx("Seuils d'alerte")}>
      <h4 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim"><Gauge size={13} className="text-link" aria-hidden />{tx("Seuils d'alerte")}</h4>
      <InfoNote className="mb-3">{tx("Pourcentage utilisé à partir duquel la machine passe « à surveiller », puis « critique ». Un champ vidé revient à la valeur par défaut. Le seuil critique doit rester au-dessus de l'autre.")}</InfoNote>
      <div className="flex flex-col gap-2">
        {LIMITS.map((l) => (
          <div key={l.kind} className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <b className="w-20 text-sm">{l.kind}</b>
            <LimitInput ctx={ctx} k={l.keys[0]} label={tx("À surveiller dès")} base={l.defaults[0]} />
            <LimitInput ctx={ctx} k={l.keys[1]} label={tx("Critique dès")} base={l.defaults[1]} />
          </div>
        ))}
      </div>
    </section>
  );
}

function OptionsTab({ ctx, menu }: Readonly<{ ctx: FlagCtx; menu: OptionsState }>) {
  const groups = flagGroups(ctx.v, ctx.found);
  const count = groups.detected.length + groups.manual.length + groups.missing.length;
  return (
    <>
      <QuickSettings ctx={ctx} />
      {ctx.v.os !== "windows" && <StoppedOkSetting ctx={ctx} />}
      <LimitsSetting ctx={ctx} />
      {!ctx.v.vm && <TempSetting ctx={ctx} />}
      {groups.active.length > 0 && (
        <OptionGroup title={tx("Options actives")} hint={tx("Allumées pour cette machine ; les autres sont dans « Options de la machine »")}>
          {groups.active.map((f) => <FlagRow key={String(f.k)} f={f} ctx={ctx} />)}
        </OptionGroup>
      )}
      {/* Menu pliant des autres interrupteurs : replié, sauf à l'ajout d'une machine dont la détection est à confirmer */}
      <div className="rounded-xl border border-dim/50 bg-bg2/30">
        <button type="button" onClick={() => menu.setOptions(!menu.options)} aria-expanded={menu.options}
          className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-bg2/60">
          <Chevron open={menu.options} size={14} />
          {tx("Options de la machine")}
          <span className="font-mono text-xs font-normal text-dim">({count})</span>
        </button>
        {menu.options && <OptionsMenuBody groups={groups} ctx={ctx} menu={menu} />}
      </div>
    </>
  );
}

function MachineForm({ ip, m, st, isNew, process, extra, detected = [], live, scan, actions, windowsGuess, report, onDone, agent, connection, tabbed, focusTab, onAgent, only }: Readonly<{
  focusTab?: "access"; onAgent?: () => void;
  only?: AccessOnly;  // a settings page of its own (Machines → SSH connections or Agents): that access alone, no tabs
  tabbed?: boolean;  // dans la fenêtre d'une machine : Identité, Options et Accès en onglets
  scan?: ScanInfo;  // ce que le dernier scan du réseau a vu : aperçu de l'icône automatique
  connection?: React.ReactNode;  // ce qui a été lu de la connexion (SSH ou agent), montré dans le cadre « Accès »
  agent?: AgentInfo;  // agent actif de la machine : c'est son accès (Windows), ou une deuxième source de santé à ordonner (avec SSH)
  report?: (n: Note) => void;  // dans une carte de machine : le message s'affiche en haut de la carte
  windowsGuess?: boolean;
  live?: Live; actions?: React.ReactNode; detected?: string[]; ip: string; m: MachineConf; st: State; isNew?: boolean; process?: boolean; extra?: Detection["web"]; onDone: () => void;
}>) {
  const [v, setV] = useState<MachineConf>(m);
  const [proc, setProc] = useState(!!process);
  const [hasAdguard] = useState(() => !!m.adguard);  // figé à l'ouverture : vider le champ ne le fait pas disparaître
  const menu = useOptionsState(isNew, detected);
  const [tab, setTab] = useState<Tab>(focusTab ?? "identity");
  const show = (t: Tab) => !only && (!tabbed || tab === t);   // dans la fenêtre d'une machine : un onglet à la fois ; à l'ajout, tout d'un coup
  const [localNote, setLocalNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const setNote = report ?? setLocalNote;
  const windows = v.os === "windows";
  const { autoSave, saved, setSaved, savedProc, ss } = useAutoSave({ ip, isNew, windows, m, process, setV, setProc, setNote, onDone });
  useAutoVm(ip, isNew, m, live, autoSave);
  const found = new Set([...(live?.detected ?? []), ...detected]);
  const linked = linkedConnectors(live);
  const status = sshStatus({ v, windows, windowsGuess, agent, live });
  const named = [v.ssh, v.health].find((x): x is string => typeof x === "string" && x !== "" && x !== "local");
  const known = (named && st.aliases.find((a) => a.alias === named)) || st.aliases.find((a) => a.ip === ip);   // by name first: an access through another address
  const toggle = useSshToggle(ip, known, autoSave);
  const ctl: SshCtl = { agentMode: status.agentMode, sshOn: status.sshOn, foundSsh: status.foundSsh, offHint: offHintText(v.ssh, status.foundSsh), known, ...toggle };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act(() => send("PUT", `machines/settings/${ip}`, submitBody(v, proc, extra)), submitMessage(isNew), setNote);
    setBusy(false);
    if (!ok) return;
    if (!isNew) setSaved(v);
    refreshMachine(ip);  // ajout ou modification : cette machine est relue tout de suite
    setTimeout(onDone, 900);
  };
  const dirty = isDirty(isNew, v, saved);
  const flagCtx: FlagCtx = { v, found, unlock: menu.unlock, ss, autoSave };
  const sshBody = <SshBody ctl={ctl} ip={ip} v={v} setV={setV} live={live} scan={scan} windowsGuess={windowsGuess} hasAdguard={hasAdguard} connection={connection} ss={ss} autoSave={autoSave} proc={proc} />;
  const agentBody = <AgentBody ip={ip} v={v} windowsGuess={windowsGuess} agent={agent} agentMode={status.agentMode} isNew={isNew} onAgent={onAgent} connection={connection} />;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {tabbed && !only && <TabBar tab={tab} setTab={setTab} />}
      {only && <OnlyAccess only={only} agentMode={status.agentMode} sshBody={sshBody} agentBody={agentBody} />}
      {show("access") && <AccessTab tabbed={tabbed} agentActive={!!agent && agent.state !== "révoqué"} connectorsActive={linked.length > 0} agentMode={status.agentMode} sshBody={sshBody} agentBody={agentBody} connectorsBody={<ConnectorsBody linked={linked} />}
        sshSummary={<SshSummary sshOn={status.sshOn} agentMode={status.agentMode} refused={status.refusedSsh} />} agentSummary={<AgentSummary agent={agent} />} connectorSummary={<ConnectorSummary linked={linked} />} />}
      {show("identity") && <IdentityTab v={v} setV={setV} isNew={isNew} live={live} scan={scan} found={found} ss={ss} autoSave={autoSave} savedProc={savedProc} />}
      {show("options") && <OptionsTab ctx={flagCtx} menu={menu} />}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="submit" className={primary} disabled={busy || !dirty} title={dirty ? undefined : tx("Rien à enregistrer : l'accès, les options et les étiquettes s'enregistrent tout seuls")}>{tx("Enregistrer")}</button>
        {actions}
      </div>
      {!report && <NoteLine note={localNote} />}
    </form>
  );
}

/** The settings of one machine, in its page (#machines/<ip>) ;
 *  `focusTab`: open on the Access tab (#machines/<ip>/access, /agent with the agent's panel open, old #settings/agents/<ip>) */
export function MachineModal({ ip, snap, focusTab, only }: Readonly<{ ip: string; snap: Snapshot; focusTab?: "access"; only?: AccessOnly }>) {
  const [st, setSt] = useState<State | null>(null), [agents, setAgents] = useState<AgentInfo[]>([]), [scan, setScan] = useState<NetHost | undefined>();
  const reload = useCallback(() => { read<State>("machines/settings").then(setSt).catch(() => undefined); }, []);
  const loadAgents = useCallback(() => { read<{ agents: AgentInfo[] }>("agents").then((r) => setAgents(r.agents)).catch(() => undefined); }, []);
  useEffect(() => { reload(); loadAgents(); read<NetScan>("network/scan").then((n) => setScan((n.found || []).find((h) => h.ip === ip))).catch(() => undefined); }, [reload, loadAgents, ip]);
  const m = st?.machines[ip];
  if (!st || !m) return null;
  const live = snap.data.machine_list.find((x) => x.ip === ip);
  const statuses = m.os === "windows" ? [] : (snap.data.connectors || []).filter((c) => ["docker", "process", "adguard"].includes(c.type) && (c.ip ? c.ip === ip : c.name === ip || c.name === live?.name));
  // « Non terminé » : jeton Home Assistant manquant ; « passé » dans les premiers pas. Un port SSH ouvert ne demande rien : l'agent passe d'abord
  const noToken = !!scan && !m.disabled && needsLink(scan, [], snap.data.services_status ?? []) === "ha";
  let passed: string[] = [];
  try { passed = JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]") as string[]; } catch { /* mémoire du navigateur illisible */ }
  const unfinished = noToken ? { passed: passed.includes(ip) } : undefined;
  return <MachineRow focusTab={focusTab} only={only} unfinished={unfinished} ip={ip} m={m} st={st} live={live} statuses={statuses} reload={reload} onAgent={loadAgents}
    agent={agents.find((a) => a.ip === ip && a.state !== "révoqué")} scan={scan ? { os: scan.os ?? undefined, apps: scan.apps ?? [], ssh: !!scan.ssh_port, sshPort: scan.ssh_port ?? undefined } : undefined} />;
}
