// Machines : accès (ping, SSH), système, serveurs (NPM, Apache, Docker), services et santé de chaque machine.
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Eye, EyeOff } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { useFilter, useSort, type Facet } from "../lib/filter";
import { dur, ipNum, splitHostName } from "../lib/format";
import { status } from "../lib/status";
import type { AgentHardware, HealthHost, Machine, MachineConf, MachinesSettings, NetScan } from "../types";
import { NoteLine } from "../components/form";
import type { Note } from "../lib/forms";
import { MSTATE, ORDER, OS_LABEL, OS_ORDER, mState, osOfMachine, type MState, type OsKind } from "../lib/machines";
import { OsGlyph } from "../components/OsGlyph";
import { ViewToggle, useStoredView } from "../components/ViewToggle";
import { Dot } from "../components/marks";
import { LEVEL } from "../lib/level";
import { rolesOf } from "../lib/ssh";
import { MachineIcon } from "../components/MachineIcon";
import { Badge, Cards, Dim, Empty, FilterBar, Level, Table, Td, Th } from "../components/ui";
import { tx } from "../lib/i18n";
import { hardwareRows } from "../lib/hardware";

/** Ligne courte du matériel (modèle · mémoire) sous le système ; le détail est dans l'info-bulle. */
const hwLine = (hw?: AgentHardware | null) => [[hw?.maker, hw?.model].filter(Boolean).join(" "), hw?.ram_gb ? `${hw.ram_gb} ${tx("Go")}` : ""].filter(Boolean).join(" · ");

function healthByIp(hosts: HealthHost[] = []): Map<string, HealthHost> {
  return new Map(hosts.map((h) => [splitHostName(h.name)[1], h]));
}

function topDisk(h?: HealthHost) {
  return (h?.disks || []).reduce<NonNullable<HealthHost["disks"]>[number] | null>((a, d) => (!a || d.used_pct > a.used_pct ? d : a), null);
}

function Servers({ m, snap }: { m: Machine; snap: Snapshot }) {
  const rows = snap.data.hosts.filter((r) => (r.host_ip || r.ip || r.target_ip) === m.ip && r.service);
  const npm = rows.some((r) => /nginx-proxy-manager/.test(r.service!.image || ""));
  const apDown = rows.filter((r) => r.enabled && r.service!.kind === "apache" && status(r)[0] === "bad").length;
  const i = m.info || {};
  const tags = [
    npm && <Badge key="npm" tone="off"><span className="text-npm">{tx("NPM")}</span></Badge>,
    i.apache && <Badge key="ap" tone={apDown ? "bad" : "off"} title={(i.vhosts_unreadable || []).length ? tx("Vhosts actifs dont la config n'est pas lisible par le compte SSH : {0}. Leurs domaines et ports restent inconnus.", (i.vhosts_unreadable || []).join(", ")) : undefined}>
      <span className={apDown ? "" : "text-apache"}>{tx("Apache ·")} {(i.vhosts || []).length} {tx("vhosts")}{(i.vhosts_unreadable || []).length > 0 && ` (+${i.vhosts_unreadable!.length} ${tx("illisible(s)")} ⓘ)`}</span></Badge>,
    i.nginx && <Badge key="ng" tone="off">{tx("nginx")}</Badge>,
    i.docker ? <Badge key="dk" tone="off"><span className="text-link">{tx("Docker ·")} {i.docker}</span></Badge> : null,
  ].filter(Boolean);
  return tags.length ? <div className="flex flex-wrap gap-1">{tags}</div> : <Dim>—</Dim>;
}

function HealthCell({ h }: { h?: HealthHost }) {
  if (!h) return <Dim>{tx("non suivie")}</Dim>;
  const d = topDisk(h), failed = h.systemd?.failed.length || 0, apt = h.apt?.upgradable || 0;
  return (
    <div className="flex flex-col items-start gap-1">
      <Level level={h.reachable === false ? "down" : h.level} />
      {d && <span className={`text-xs ${d.critical ? "text-bad" : d.warning ? "text-warn" : "text-muted"}`}>{tx("disque")} {d.mount} {d.used_pct} %</span>}
      {(failed > 0 || apt > 0 || h.reboot_required) && (
        <span className="text-xs text-warn">{[failed && tx("{0} service(s) en échec", failed), apt && tx("{0} mise(s) à jour", apt), h.reboot_required && tx("redémarrage requis")].filter(Boolean).join(" · ")}</span>
      )}
    </div>
  );
}

/** Clé utilisée par l'alias (chemin et début d'empreinte) */
function KeyCell({ m }: { m: Machine }) {
  const s = m.ssh;
  if (!s) return <Dim>—</Dim>;
  if (!s.identity) return <Dim>{tx("aucune (accès manuel)")}</Dim>;
  return <div className="flex flex-col"><code className="break-all text-xs">{s.identity}</code>{s.key_fp && <span className="truncate font-mono text-[11px] text-dim" title={s.key_fp}>{s.key_fp.slice(0, 22)}…</span>}</div>;
}

/** ✓ vert = sûr, ⚠ orange = à revoir, — = inconnu ; l'explication est au survol */
function Mark({ tone, title, children }: { tone: "ok" | "warn" | "bad" | "off"; title: string; children: string }) {
  const c = { ok: "text-ok", warn: "text-warn", bad: "text-bad", off: "text-dim" }[tone];
  return <span className={`text-base font-bold ${c}`} title={title} aria-label={title}>{children}</span>;
}

function HostKey({ m }: { m: Machine }) {
  if (!m.ssh) return <Dim>—</Dim>;
  return m.ssh.host_key ? <Mark tone="ok" title={tx("Clé d'hôte connue (known_hosts)")}>✓</Mark>
    : <Mark tone="bad" title={tx("Clé d'hôte absente de known_hosts : 1re connexion non vérifiée")}>✗</Mark>;
}

/** Root et mot de passe selon sshd : refusé ou clé seule = vert, autorisé = orange */
function Sshd({ m, what }: { m: Machine; what: "root" | "pwd" }) {
  if (!m.ssh) return <Dim>—</Dim>;
  const sd = m.info?.sshd || {};
  const v = what === "root" ? sd.permitrootlogin
    : m.ssh.methods ? (m.ssh.methods.some((x) => x === "password" || x === "keyboard-interactive") ? "yes" : "no") : sd.passwordauthentication;
  if (!v) return <Dim>—</Dim>;
  const k = v.split(" ")[0];
  if (k === "yes") return <Mark tone="warn" title={what === "root" ? tx("root peut se connecter en SSH") : tx("sshd accepte le mot de passe")}>⚠</Mark>;
  if (/prohibit-password|without-password/.test(k)) return <Mark tone="ok" title={tx("Par clé uniquement")}>🔑</Mark>;
  return <Mark tone="ok" title={what === "root" ? tx("root refusé en SSH") : tx("mot de passe refusé : clé seulement")}>✓</Mark>;
}

/** Colonnes santé de la v1 : disque le plus rempli, services systemd en échec, mises à jour et redémarrage */
export function DiskCell({ h }: { h?: HealthHost }) {
  const d = topDisk(h);
  if (!d) return <Dim>—</Dim>;
  return <span title={tx("Disque le plus rempli")}><b className={d.critical || d.used_pct >= 90 ? "text-bad" : d.warning || d.used_pct >= 80 ? "text-warn" : "text-ok"}>{d.used_pct} %</b> <code className="text-xs">{d.mount}</code></span>;
}
export function ResCell({ h, what }: { h?: HealthHost; what: "cpu" | "mem" }) {
  const v = what === "cpu" ? h?.res?.cpu_pct : h?.res?.mem_pct;
  if (!h?.res?.available || v == null) return <Dim>—</Dim>;
  const tone = what === "mem" && v >= 97 ? "text-bad" : (what === "mem" && v >= 90) || (what === "cpu" && v >= 90) ? "text-warn" : "text-ok";
  return <b className={tone} title={what === "mem" && h.res?.mem_total_mb ? `${((h.res.mem_used_mb ?? 0) / 1024).toFixed(1)} / ${(h.res.mem_total_mb / 1024).toFixed(1)} Go` : undefined}>{Math.round(v)} %</b>;
}
export function SystemdCell({ h }: { h?: HealthHost }) {
  if (!h) return <Dim>—</Dim>;
  const f = h.systemd?.failed || [];
  return f.length ? <Mark tone="bad" title={f.map((u) => u.unit).join(", ")}>{String(f.length)}</Mark> : <Mark tone="ok" title={tx("Aucun service en échec")}>✓</Mark>;
}
export function UpdatesCell({ h }: { h?: HealthHost }) {
  if (!h) return <Dim>—</Dim>;
  const n = h.apt?.upgradable || 0;
  return (
    <span className="inline-flex items-center gap-1">
      {n ? <Mark tone="warn" title={tx("{0} paquet(s) à mettre à jour", n)}>{String(n)}</Mark> : <Mark tone="ok" title={tx("À jour")}>✓</Mark>}
      {h.reboot_required && <Mark tone="warn" title={tx("Redémarrage requis")}>↻</Mark>}
    </span>
  );
}

function Ssh({ m }: { m: Machine }) {
  if (!m.ssh) return <Dim>{m.local ? tx("local") : tx("pas d'accès SSH configuré")}</Dim>;
  const s = m.ssh, sd = m.info?.sshd || {};
  const pwd = s.methods ? s.methods.some((x) => x === "password" || x === "keyboard-interactive") : sd.passwordauthentication?.startsWith("yes");
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-xs">{s.user || "?"}@{m.ip}:{s.port}</span>
      <span className="text-xs text-dim">{tx("alias")} {s.alias}{s.identity ? "" : tx(" · sans clé")}{s.port !== 22 && <> · <span className="text-warn" title={tx("Port SSH non standard")}>{tx("port")} {s.port}</span></>}</span>
      {s.note && <span className="text-xs text-dim" title={tx("Note du script sshlist")}>📝 {s.note}</span>}
      {!m.info && s.identity && <span className="text-xs text-warn">{tx("connexion refusée ou impossible")}</span>}
      <span className="flex flex-wrap gap-1">
        {!s.host_key && <Badge tone="bad" title={tx("Clé d'hôte absente de known_hosts")}>{tx("clé d'hôte inconnue")}</Badge>}
        {sd.permitrootlogin?.startsWith("yes") && <Badge tone="warn">{tx("root autorisé")}</Badge>}
        {pwd && <Badge tone="warn">{tx("mot de passe accepté")}</Badge>}
      </span>
    </div>
  );
}

/** Accès SSH sur une ligne ; l'alias, la note et les alertes sont dans le détail déplié */
function SshShort({ m }: { m: Machine }) {
  if (!m.ssh) return <Dim>{m.local ? tx("local") : "—"}</Dim>;
  return <span className="inline-flex items-center gap-1.5"><span className="font-mono text-xs">{m.ssh.user || "?"}@{m.ip}:{m.ssh.port}</span>
    {!m.info && m.ssh.identity && <Badge tone="warn" title={tx("connexion refusée ou impossible")}>{tx("refusée")}</Badge>}</span>;
}

/** Système sur une ligne : logo de la distribution (ou icône de la famille) puis le nom, coupé, entier au survol */
function OsShort({ m, kind }: { m: Machine; kind: OsKind | null }) {
  const os = m.info?.os || m.agent?.os;
  if (!os && !kind) return <Dim>—</Dim>;
  return <span className="inline-flex max-w-[11rem] items-center gap-1.5" title={os || (kind ? OS_LABEL[kind] : "")}>{kind && <OsGlyph kind={kind} name={os} />}<span className="truncate">{os || (kind ? OS_LABEL[kind] : "")}</span></span>;
}

/** Origine d'une donnée : le connecteur ou la source qui l'a lue (rouge si en panne) */
export interface Origin { label: string; ok?: boolean; tip?: string }

/** D'où viennent les données de la machine : SSH, agent, recherche réseau, MynetworK, Beszel et connecteurs visant son IP */
function originsOf(m: Machine, snap: Snapshot, h: HealthHost | undefined, scanned: boolean, seen: boolean) {
  const linked = (types: string[]): Origin[] => (snap.data.connectors ?? []).filter((c) => c.ip === m.ip && types.includes(c.type))
    .map((c) => ({ label: c.type === "docker" ? "Docker (SSH)" : c.type === "process" ? tx("Ports (SSH)") : "AdGuard Home", ok: c.ok, tip: `${c.name} : ${c.message}` }));
  const health: Origin[] = (h?.sources ?? []).map((x) => ({ label: x === "ssh" ? "SSH" : x === "agent" ? tx("agent MyServices") : x === "beszel" ? "Beszel" : x }));
  return {
    role: [{ label: tx("Réglages → Machines") }] as Origin[],
    mac: seen ? [{ label: "MynetworK" }] : [],
    ssh: m.ssh ? [{ label: tx("alias SSH de MyServices") }] : [],
    os: m.info?.os ? [{ label: "SSH" }] : m.agent ? [{ label: tx("agent MyServices") }] : scanned ? [{ label: tx("recherche réseau") }] : [],
    services: [...(m.npm ? [{ label: "NPM" }] : []), ...linked(["docker", "process", "adguard"])],
    health,
  };
}

function From({ list }: { list: Origin[] }) {
  if (!list.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1 text-[11px] font-normal normal-case tracking-normal text-dim">
      {tx("source")} : {list.map((o) => <Badge key={o.label} tone={o.ok === false ? "bad" : "info"} title={o.tip}>{o.label}</Badge>)}
    </span>
  );
}

/** Ligne dépliée à la demande : tout ce que le tableau garde sur une seule ligne, avec l'origine de chaque donnée */
function Detail({ m, mac, from }: { m: Machine; mac?: string; from: ReturnType<typeof originsOf> }) {
  const roles = rolesOf(m.role);
  const box = "flex flex-col gap-1 text-xs";
  const title = "font-semibold uppercase tracking-wide text-dim";
  return (
    <div className="grid gap-x-6 gap-y-3 px-3 py-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className={box}><span className={title}>{tx("Rôle")}</span>
        <span className="flex flex-wrap gap-1">{roles.length ? roles.map((t) => <Badge key={t} tone="off">{t}</Badge>) : <Dim>—</Dim>}</span><From list={from.role} />
        {mac && <><span className="font-mono text-[11px] text-dim">{mac}</span><From list={from.mac} /></>}</div>
      <div className={box}><span className={title}>{tx("SSH")}</span><Ssh m={m} /><From list={from.ssh} /></div>
      <div className={box}><span className={title}>{tx("Clé utilisée")}</span><KeyCell m={m} /><From list={from.ssh} /></div>
      <div className={box}><span className={title}>{tx("Sécurité SSH")}</span>
        {m.ssh ? <span className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5"><HostKey m={m} />{tx("Clé d'hôte")}</span>
          <span className="inline-flex items-center gap-1.5"><Sshd m={m} what="root" />{tx("Root")}</span>
          <span className="inline-flex items-center gap-1.5"><Sshd m={m} what="pwd" />{tx("Mot de passe")}</span>
        </span> : <Dim>—</Dim>}</div>
      <div className={box}><span className={title}>{tx("Système")}</span>
        {m.info?.os ? <span>{m.info.os}<span className="block text-dim">{tx("noyau")} {m.info.kernel || "?"} {tx("· up")} {dur(m.info.uptime_s)}</span></span>
          : m.agent ? <span>{m.agent.os}<span className="block text-dim">{m.agent.kernel ? `${m.agent.kernel} · ` : ""}{tx("par l'agent")}{m.agent.uptime_s ? ` ${tx("· up")} ${dur(m.agent.uptime_s)}` : ""}</span>
            {hwLine(m.agent.hardware) && <span className="block text-dim" title={hardwareRows(m.agent.hardware).map(([k, v]) => `${k} : ${v}`).join("\n")}>{hwLine(m.agent.hardware)}</span>}</span>
          : <Dim>—</Dim>}<From list={from.os} /></div>
      <div className={box}><span className={title}>{tx("Services")}</span>
        <span>{m.services} <Dim>{tx("dont")} {m.npm} {tx("NPM")}</Dim>{m.down > 0 && <span className="text-bad"> · {m.down} {tx("en panne")}</span>}</span><From list={from.services} /></div>
      <div className={box}><span className={title}>{tx("Santé")}</span>
        {from.health.length ? <span className="text-muted">{tx("relevée par")}</span> : <Dim>{tx("non suivie")}</Dim>}<From list={from.health} /></div>
    </div>
  );
}

export function Machines({ snap, onMachine }: { snap: Snapshot; onMachine: (ip: string) => void }) {
  const hb = useMemo(() => healthByIp(snap.health?.hosts), [snap.health]);
  // Système et applis vus par le dernier scan du réseau, pour les machines que le SSH ne renseigne pas
  const [scanOs, setScanOs] = useState<Record<string, { os?: string; apps: string[]; ssh?: boolean }>>({});
  useEffect(() => { read<NetScan>("network/scan").then((n) => setScanOs(Object.fromEntries((n.found || []).map((h) => [h.ip, { os: h.os ?? undefined, apps: h.apps ?? [], ssh: !!h.ssh_port }])))).catch(() => undefined); }, []);
  const osOf = useCallback((m: Machine): OsKind | null => osOfMachine({ os: m.agent ? "windows" : undefined, info: m.info, ttl: m.ttl, name: m.name }, scanOs[m.ip]?.os, scanOs[m.ip]?.ssh)?.kind ?? null, [scanOs]);
  const facets = useMemo((): Facet<Machine>[] => [
    { key: "state", label: tx("État"), get: mState, name: (v) => MSTATE[v as MState][1], order: ORDER, mark: (v) => <Dot tone={MSTATE[v as MState][0]} /> },
    { key: "health", label: tx("Santé"), get: (m) => { const h = hb.get(m.ip); return h ? (h.reachable === false ? "down" : h.level) : ""; },
      name: (v) => ({ ok: "OK", warn: tx("à surveiller"), crit: "critique", down: "injoignable" } as Record<string, string>)[v] || v, order: ["ok", "warn", "crit", "down"], mark: (v) => <Dot tone={LEVEL[v]?.[0] ?? "off"} /> },
    { key: "os", label: tx("Système"), get: (m) => osOf(m) ?? "", name: (v) => OS_LABEL[v as OsKind], order: OS_ORDER, mark: (v) => <OsGlyph kind={v as OsKind} size={13} /> },
    { key: "access", label: tx("Accès"), get: (m) => (m.ssh ? "ssh" : m.agent ? "agent" : "none"), name: (v) => ({ ssh: "SSH", agent: tx("Agent"), none: tx("aucun") } as Record<string, string>)[v], order: ["ssh", "agent", "none"],
      mark: (v) => <Dot tone={v === "none" ? "off" : "ok"} /> },
    { key: "role", label: tx("Rôle"), get: (m) => rolesOf(m.role) },
    { key: "user", label: tx("Compte SSH"), get: (m) => m.ssh?.user || "" },
  ], [hb, osOf]);
  const text = useCallback((m: Machine) => [m.name, m.ip, m.role, MSTATE[mState(m)][1], m.ssh?.alias, m.ssh?.user, m.info?.os].join(" "), []);
  // « Ne plus suivre » sur chaque ligne (admin) : la machine passe en « non suivie » (ni ping, ni SSH, ni santé, aucune alerte), elle reste
  // dans Réglages → Machines pour être réactivée. Effet immédiat ici ; la collecte le reprend à son prochain passage.
  const admin = snap.me.role === "admin";
  const [conf, setConf] = useState<Record<string, MachineConf>>({});
  const [followed, setFollowed] = useState<Record<string, boolean>>({});  // ip -> suivie (réglage fait depuis cet onglet)
  const [note, setNote] = useState<Note>(null), [pending, setPending] = useState("");
  useEffect(() => { if (admin) read<MachinesSettings>("machines/settings").then((r) => setConf(r.machines)).catch(() => undefined); }, [admin]);
  const isOff = useCallback((m: Machine) => (m.ip in followed ? !followed[m.ip] : !!m.disabled), [followed]);
  const follow = async (m: Machine, on: boolean) => {
    if (!conf[m.ip]) return;
    setPending(m.ip); setNote(null);
    try {
      await send("PUT", `machines/settings/${m.ip}`, { machine: { ...conf[m.ip], disabled: !on }, process: null, extra: [] });
      setFollowed((f) => ({ ...f, [m.ip]: on }));
      setConf((c) => ({ ...c, [m.ip]: { ...c[m.ip], disabled: !on } }));
      setNote({ ok: true, text: on ? tx("{0} est de nouveau suivie", m.name) : tx("{0} n'est plus suivie : elle reste dans Réglages → Machines", m.name) });
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setPending("");
  };
  const followBtn = (m: Machine) => admin && conf[m.ip] ? (
    <button type="button" disabled={pending === m.ip} onClick={() => void follow(m, isOff(m))}
      title={isOff(m) ? tx("Suivre de nouveau cette machine") : tx("Ne plus suivre : ni ping, ni SSH, ni santé, aucune alerte")}
      className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-link hover:text-txt disabled:opacity-50">
      {isOff(m) ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}{isOff(m) ? tx("Suivre") : tx("Ne plus suivre")}
    </button>
  ) : null;
  // Machines non suivies : masquées d'office, un bouton les ramène (grisées)
  const [showOff, setShowOff] = useState(false);
  const nOff = snap.data.machine_list.filter(isOff).length;
  const items = useMemo(() => (showOff ? snap.data.machine_list : snap.data.machine_list.filter((m) => !isOff(m))), [snap.data.machine_list, showOff, isOff]);
  const f = useFilter(items, facets, text);
  const keyOf = useCallback((m: Machine, k: string): string | number => {
    switch (k) {
      case "state": return ORDER.indexOf(mState(m));
      case "os": return m.info?.os || "~";
      case "svc": return -m.services;
      case "health": return -(topDisk(hb.get(m.ip))?.used_pct ?? -1);
      default: return ipNum(m.ip);
    }
  }, [hb]);
  const sort = useSort(f.shown, keyOf, "ip");
  // Tableau sur une seule ligne par machine ; un clic sur le chevron (ou « Tout déplier ») montre le détail
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (ip: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(ip)) n.add(ip); return n; });
  const [view, pickView] = useStoredView("ms.machines.view", "table");  // Tableau ou Cartes, retenu
  const allOpen = sort.sorted.length > 0 && sort.sorted.every((m) => open.has(m.ip));

  // Inventaire de MynetworK (connecteur « network ») : MAC et fabricant sous l'IP, et les appareils vus mais pas suivis
  const seen = useMemo(() => new Map((snap.data.network ?? []).flatMap((c) => c.devices ?? []).map((d) => [d.ip, d])), [snap.data.network]);
  const untracked = useMemo(() => [...seen.values()].filter((d) => !snap.data.machine_list.some((m) => m.ip === d.ip)).sort((a, b) => ipNum(a.ip) - ipNum(b.ip)), [seen, snap.data.machine_list]);
  const macOf = (m: Machine) => { const d = seen.get(m.ip); return d ? [d.mac, d.vendor].filter(Boolean).join(" · ") : undefined; };
  const name = (m: Machine) => (
    <button type="button" onClick={() => onMachine(m.ip)} className="text-left" title={tx("Voir ses services")}>
      <b className="font-semibold hover:text-link">{m.name}</b>
      <span className="flex flex-wrap items-center gap-1 text-xs text-dim">{m.ip}{rolesOf(m.role).map((t) => <Badge key={t} tone="off">{t}</Badge>)}</span>
      {seen.get(m.ip) && <span className="block font-mono text-[11px] text-dim" title={tx("Vu par MynetworK")}>{[seen.get(m.ip)!.mac, seen.get(m.ip)!.vendor].filter(Boolean).join(" · ")}</span>}
    </button>
  );
  const svc = (m: Machine) => (
    <span><b>{m.services}</b> <Dim>{tx("dont")} {m.npm} {tx("NPM")}</Dim>{m.down > 0 && <span className="block text-xs text-bad">{m.down} {tx("en panne")}</span>}</span>
  );
  const st = (m: Machine) => { const [tone, label, tip] = MSTATE[mState(m)]; return <Badge tone={tone} title={tip}>{label}</Badge>; };

  return (
    <div className="py-1">
      <FilterBar f={f} placeholder={tx("Nom, IP, rôle, système, compte SSH…")}
        extra={<>
          <ViewToggle view={view} onPick={pickView} />
          <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(sort.sorted.map((m) => m.ip)))} aria-pressed={allOpen}
            className={`${view === "table" ? "hidden md:inline-flex" : "hidden"} items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm text-muted hover:text-txt`}>
            {allOpen ? <ChevronsDownUp size={14} aria-hidden /> : <ChevronsUpDown size={14} aria-hidden />}{allOpen ? tx("Tout replier") : tx("Tout déplier")}
          </button>
          {nOff > 0 && (
            <button type="button" onClick={() => setShowOff(!showOff)} aria-pressed={showOff}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${showOff ? "border-link text-txt" : "border-line text-muted hover:text-txt"}`}>
              {showOff ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}{showOff ? tx("Masquer les désactivées") : tx("Afficher les désactivées")} <b className="text-dim">({nOff})</b>
            </button>
          )}
        </>} />
      <NoteLine note={note} />
      {untracked.length > 0 && (
        <details className="mb-3 rounded-xl border border-line bg-bg2/40 px-4 py-2 text-sm">
          <summary className="cursor-pointer text-muted hover:text-txt">{tx("Vus par MynetworK, pas suivis ici")} <b className="text-dim">({untracked.length})</b></summary>
          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {untracked.slice(0, 120).map((d) => (
              <li key={d.ip} className="flex flex-wrap items-baseline gap-2"><Badge tone={d.status === "online" ? "ok" : "off"}>{d.status === "online" ? tx("en ligne") : tx("hors ligne")}</Badge>
                <span className="font-mono text-xs">{d.ip}</span><span>{d.hostname || d.vendor || ""}</span>{d.mac && <Dim>{d.mac}</Dim>}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-dim">{tx("Pour en suivre un : Réglages → Machines, ou refaites une recherche réseau.")}</p>
        </details>
      )}
      {sort.sorted.length === 0 ? <Empty>{tx("Aucune machine pour ce filtre.")}</Empty> : (
        <>
          {view === "table" && <Table fit head={<>
            <th className="w-8 px-1" aria-label={tx("Détails")} /><th className="w-10 px-2" aria-label={tx("Icône")} /><Th k="ip" sort={sort}>{tx("Machine")}</Th><Th k="state" sort={sort}>{tx("État")}</Th><Th>{tx("SSH")}</Th><Th k="os" sort={sort}>{tx("Système")}</Th>
            <Th>{tx("Serveurs")}</Th><Th k="svc" sort={sort}>{tx("Services")}</Th>{snap.health && <><Th k="health" sort={sort}>{tx("Santé")}</Th><Th>{tx("CPU")}</Th><Th>{tx("Mémoire")}</Th><Th>{tx("Disque")}</Th><Th>{tx("Systemd")}</Th><Th>{tx("Mises à jour")}</Th></>}{admin && <Th>{tx("Suivi")}</Th>}
          </>}>
            {sort.sorted.map((m) => {
              const shown = open.has(m.ip), h = hb.get(m.ip), cols = 8 + (snap.health ? 6 : 0) + (admin ? 1 : 0);
              return (
                <Fragment key={m.ip}>
                  <tr className={`hover:bg-bg2/60 ${isOff(m) ? "opacity-50" : ""}`}>
                    <td className="w-8 px-1 py-2 align-middle">
                      <button type="button" onClick={() => toggleOpen(m.ip)} aria-expanded={shown} aria-label={tx("Détails de {0}", m.name)} title={shown ? tx("Replier") : tx("Déplier le détail")}
                        className="grid h-6 w-6 place-items-center rounded-md text-dim hover:bg-bg2 hover:text-txt">{shown ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                    </td>
                    <td className="w-10 px-2 py-2 align-middle"><MachineIcon m={m} scan={scanOs[m.ip]} reserve /></td>
                    <Td><button type="button" onClick={() => onMachine(m.ip)} className="flex items-baseline gap-2 text-left" title={tx("Voir ses services")}>
                      <b className="font-semibold hover:text-link">{m.name}</b><span className="text-xs text-dim">{m.ip}</span></button></Td>
                    <Td>{st(m)}</Td><Td><SshShort m={m} /></Td>
                    <Td><OsShort m={m} kind={osOf(m)} /></Td><Td><Servers m={m} snap={snap} /></Td>
                    <Td><b>{m.services}</b>{m.down > 0 && <span className="text-xs text-bad"> · {m.down} {tx("en panne")}</span>}</Td>
                    {snap.health && <><Td><Level level={h ? (h.reachable === false ? "down" : h.level) : "na"} /></Td>
                      <Td><ResCell h={h} what="cpu" /></Td><Td><ResCell h={h} what="mem" /></Td><Td><DiskCell h={h} /></Td><Td><SystemdCell h={h} /></Td><Td><UpdatesCell h={h} /></Td></>}
                    {admin && <Td>{followBtn(m)}</Td>}
                  </tr>
                  {shown && <tr className={`bg-bg2/40 ${isOff(m) ? "opacity-50" : ""}`}><td colSpan={cols} className="p-0"><Detail m={m} mac={macOf(m)} from={originsOf(m, snap, h, !!scanOs[m.ip]?.os, seen.has(m.ip))} /></td></tr>}
                </Fragment>
              );
            })}
          </Table>}
          <Cards always={view === "cards"}>
            {sort.sorted.map((m) => (
              <div key={m.ip} className={`rounded-2xl border border-line bg-card p-3.5 ${isOff(m) ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2"><span className="flex items-start gap-2"><MachineIcon m={m} scan={scanOs[m.ip]} reserve />{name(m)}</span>{st(m)}</div>
                <div className="mt-2 flex flex-col gap-2 text-sm">
                  {m.info?.os ? <span className="text-muted">{m.info.os} {tx("· up")} {dur(m.info.uptime_s)}</span>
                    : m.agent && <span className="text-muted">{m.agent.os}{m.agent.uptime_s ? ` ${tx("· up")} ${dur(m.agent.uptime_s)}` : ""} <Dim>({tx("par l'agent")})</Dim></span>}
                  <Servers m={m} snap={snap} />
                  <div className="flex items-start justify-between gap-3">{svc(m)}{snap.health && <HealthCell h={hb.get(m.ip)} />}</div>
                  {admin && <div>{followBtn(m)}</div>}
                </div>
              </div>
            ))}
          </Cards>
        </>
      )}
    </div>
  );
}
