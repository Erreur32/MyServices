// Machines : accès (ping, SSH), système, serveurs (NPM, Apache, Docker), services et santé de chaque machine.
import { ArrowUpCircle, Boxes, Bug, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Container, Cpu, Eye, EyeOff, Gauge, Globe, HardDrive, HeartPulse, IdCard, Info, KeyRound, MemoryStick, Plug, RotateCw, ScanSearch, ServerCrash, ShieldAlert, Thermometer, Unplug, WifiOff, type LucideIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { read, type Snapshot } from "../api";
import { useFilter, useSort, type Facet } from "../lib/filter";
import { dur, ipNum, splitHostName } from "../lib/format";
import { status } from "../lib/status";
import type { HealthHost, Machine, NetScan } from "../types";
import { MSTATE, ORDER, OS_LABEL, OS_ORDER, mState, osOfMachine, type MState, type OsKind } from "../lib/machines";
import { OsGlyph } from "../components/OsGlyph";
import { shortOs } from "../lib/osName";
import { ViewToggle, useStoredView } from "../components/ViewToggle";
import { Dot } from "../components/marks";
import { LEVEL } from "../lib/level";
import { rolesOf } from "../lib/ssh";
import { watchItems, worst, type WatchItem, type WatchKind, type WatchTone } from "../lib/machineWatch";
import { MachineIcon } from "../components/MachineIcon";
import { Badge, Cards, Dim, Empty, Fill, FilterBar, Level, Table, Td, Th } from "../components/ui";
import { tx } from "../lib/i18n";
import { hardwareRows } from "../lib/hardware";


function healthByIp(hosts: HealthHost[] = []): Map<string, HealthHost> {
  return new Map(hosts.map((h) => [splitHostName(h.name)[1], h]));
}

function topDisk(h?: HealthHost) {
  return (h?.disks || []).reduce<NonNullable<HealthHost["disks"]>[number] | null>((a, d) => (!a || d.used_pct > a.used_pct ? d : a), null);
}

/** Logiciels de service détectés sur la machine, en icônes ; les nombres (conteneurs, vhosts) sont dans l'info-bulle */
function Servers({ m, snap }: { m: Machine; snap: Snapshot }) {
  const rows = snap.data.hosts.filter((r) => (r.host_ip || r.ip || r.target_ip) === m.ip && r.service);
  const npm = rows.some((r) => /nginx-proxy-manager/.test(r.service!.image || ""));
  const apDown = rows.filter((r) => r.enabled && r.service!.kind === "apache" && status(r)[0] === "bad").length;
  const i = m.info || {}, vh = (i.vhosts || []).length, unread = (i.vhosts_unreadable || []).length;
  const chips: { key: string; icon: string; tip: string; bad?: boolean }[] = [
    ...(npm ? [{ key: "npm", icon: "nginx-proxy-manager", tip: tx("Nginx Proxy Manager : la machine héberge un NPM") }] : []),
    ...(i.apache ? [{ key: "apache", icon: "apache", bad: apDown > 0,
      tip: tx("Apache : {0} vhost(s)", vh) + (unread ? `\n${tx("Vhosts actifs dont la config n'est pas lisible par le compte SSH : {0}. Leurs domaines et ports restent inconnus.", (i.vhosts_unreadable || []).join(", "))}` : "") + (apDown ? `\n${tx("{0} en panne", apDown)}` : "") }] : []),
    ...(i.nginx ? [{ key: "nginx", icon: "nginx", tip: tx("nginx installé et actif sur la machine (hors conteneur)") }] : []),
    ...(i.docker ? [{ key: "docker", icon: "docker", tip: tx("Docker : {0} conteneur(s) en cours", i.docker) }] : []),
  ];
  return chips.length ? (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((c) => (
        <span key={c.key} title={c.tip} tabIndex={0} className={`grid h-7 w-7 place-items-center rounded-md border ${c.bad ? "border-bad/60 bg-bad/10" : "border-line bg-bg2"}`}>
          <img src={`${import.meta.env.BASE_URL}icons/${c.icon}.svg`} alt="" className="h-4 w-4" />
        </span>
      ))}
    </div>
  ) : <Dim>—</Dim>;
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

const WATCH_ICON: Record<WatchKind, LucideIcon> = {
  down: WifiOff, ssh: KeyRound, disk: HardDrive, systemd: ServerCrash, docker: Container, kernel: Bug, smart: ScanSearch, load: Gauge, ssh_auth: ShieldAlert,
  mem: MemoryStick, temp: Thermometer, reboot: RotateCw, updates: ArrowUpCircle, services: Globe, connector: Plug, access: Unplug,
};
const WATCH_STYLE: Record<WatchTone, string> = { bad: "border-bad/60 bg-bad/15 text-bad", warn: "border-warn/60 bg-warn/15 text-warn", info: "border-link/50 bg-link/10 text-link" };

/** « À surveiller » : une pastille-icône par sujet, rouge (grave), orange (à regarder) ou bleue (à savoir) ; le détail est dans l'info-bulle. Rien : une coche discrète. */
function WatchList({ items, wrap = false }: { items: WatchItem[]; wrap?: boolean }) {   // wrap : libellé « Rien à surveiller » écrit en toutes lettres (fiches)
  if (!items.length) return <span className="inline-flex items-center gap-1 text-xs text-ok" title={tx("Rien à surveiller")}><Check size={14} aria-hidden />{wrap && tx("Rien à surveiller")}</span>;
  return (
    <div className="flex flex-wrap items-center gap-1" role="list" aria-label={tx("À surveiller")}>   {/* tout est montré, jamais caché : les pastilles passent à la ligne */}
      {items.map((it, i) => {
        const Icon = WATCH_ICON[it.kind];
        return <span key={i} role="listitem" tabIndex={0} title={it.text} className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border ${WATCH_STYLE[it.tone]}`}><Icon size={14} aria-hidden /></span>;
      })}
    </div>
  );
}

/** Synthèse de « À surveiller », dépliable : une ligne par sujet avec son icône, sa couleur et sa phrase complète (repliée : le nombre par gravité) */
function WatchSummary({ items }: { items: WatchItem[] }) {
  const count = (t: WatchTone) => items.filter((i) => i.tone === t).length;
  return (
    <details open={worst(items) >= 2} className="group rounded-lg border border-line/60 bg-card/60 p-3 text-xs sm:col-span-2 xl:col-span-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-dim [&::-webkit-details-marker]:hidden">
        <ChevronRight size={13} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden /><Eye size={13} aria-hidden />{tx("À surveiller")}
        <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal">
          {items.length === 0 ? <Badge tone="ok">{tx("rien")}</Badge> : (["bad", "warn", "info"] as WatchTone[]).filter(count).map((t) => <Badge key={t} tone={t === "info" ? "info" : t}>{count(t)}</Badge>)}
        </span>
      </summary>
      {items.length === 0 ? <p className="mt-2 text-ok">{tx("Rien à surveiller sur cette machine.")}</p> : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((it, i) => {
            const Icon = WATCH_ICON[it.kind];
            return <li key={i} className="flex items-start gap-2"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${WATCH_STYLE[it.tone]}`}><Icon size={13} aria-hidden /></span><span className="min-w-0 flex-1 pt-0.5 text-muted">{it.text}</span></li>;
          })}
        </ul>
      )}
    </details>
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
  return <span className="inline-flex max-w-[11rem] items-center gap-1.5" title={os || (kind ? OS_LABEL[kind] : "")}>{kind && <OsGlyph kind={kind} name={os} />}<span className="truncate">{shortOs(os) || (kind ? OS_LABEL[kind] : "")}</span></span>;
}

/** Origine d'une donnée : le connecteur ou la source qui l'a lue (rouge si en panne) */
export interface Origin { label: string; ok?: boolean; tip?: string; href?: string }  // href : où régler cette source (Réglages)

/** D'où viennent les données de la machine : SSH, agent, recherche réseau, MynetworK, Beszel et connecteurs visant son IP */
function originsOf(m: Machine, snap: Snapshot, h: HealthHost | undefined, scanned: boolean, seen: boolean) {
  const linked = (types: string[]): Origin[] => (snap.data.connectors ?? []).filter((c) => c.ip === m.ip && types.includes(c.type))
    .map((c) => ({ label: c.type === "docker" ? "Docker (SSH)" : c.type === "process" ? tx("Ports (SSH)") : "AdGuard Home", ok: c.ok, tip: `${c.name} : ${c.message}`, href: `#settings/machines/${m.ip}` }));
  const here = `#settings/machines/${m.ip}`, connectors = "#settings/connectors";
  const health: Origin[] = (h?.sources ?? []).map((x) => ({ label: x === "ssh" ? "SSH" : x === "agent" ? tx("agent MyServices") : x === "beszel" ? "Beszel" : x === "ha" ? "Home Assistant" : x,
    href: x === "agent" ? `#settings/agents/${m.ip}` : x === "beszel" || x === "ha" ? connectors : here }));
  return {
    role: [{ label: tx("Réglages → Machines"), href: here }] as Origin[],
    mac: seen ? [{ label: "MynetworK", href: connectors }] : [],
    ssh: m.ssh ? [{ label: tx("alias SSH de MyServices"), href: here }] : [],
    os: m.info?.os ? [{ label: "SSH", href: here }] : m.agent ? [{ label: tx("agent MyServices"), href: `#settings/agents/${m.ip}` }] : scanned ? [{ label: tx("recherche réseau"), href: "#settings/network" }] : [],
    services: [...(m.npm ? [{ label: "NPM", href: connectors }] : []), ...linked(["docker", "process", "adguard"]),
               ...(m.api ?? []).map((a) => ({ label: a.label, ok: a.ok || !!a.stale, tip: `${a.name} : ${a.message ?? ""}`, href: connectors }))],
    health,
  };
}

function From({ list }: { list: Origin[] }) {
  if (!list.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1 text-[11px] font-normal normal-case tracking-normal text-dim">
      {tx("source")} : {list.map((o) => {
        const badge = <Badge tone={o.ok === false ? "bad" : "info"} title={o.tip ?? (o.href ? tx("Ouvrir les réglages de cette source") : undefined)}>{o.label}</Badge>;
        return o.href ? <a key={o.label} href={o.href} className="rounded-md outline-offset-2 hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-link">{badge}</a> : <span key={o.label}>{badge}</span>;
      })}
    </span>
  );
}

/** Rubrique du détail : titre avec icône, lignes « libellé / valeur », puis d'où viennent les données */
function Section({ icon: Icon, title, from, children }: { icon: typeof Info; title: string; from?: Origin[]; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 rounded-lg border border-line/60 bg-card/60 p-3 text-xs">
      <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim"><Icon size={13} aria-hidden />{title}</h4>
      <dl className="flex flex-col gap-1">{children}</dl>
      {!!from?.length && <From list={from} />}
    </section>
  );
}

function Row({ k, children }: { k: string; children?: React.ReactNode }) {
  if (children === undefined || children === null || children === false || children === "") return null;
  return <div className="flex gap-2"><dt className="w-20 shrink-0 text-dim">{k}</dt><dd className="min-w-0 flex-1 break-words">{children}</dd></div>;
}

/** Disques, processeur et mémoire de la dernière santé, en barres */
function HealthRows({ h }: { h: HealthHost }) {
  const bar = (label: string, pct: number | undefined, tone: "ok" | "warn" | "bad", extra?: string) => pct == null ? null : (
    <div key={label} className="flex items-center gap-2"><span className="w-20 shrink-0 truncate text-dim" title={label}>{label}</span><Fill pct={pct} tone={tone} /><span className="tabular-nums">{Math.round(pct)} %</span>{extra && <Dim>{extra}</Dim>}</div>
  );
  return (
    <>
      {h.res?.available && bar(tx("CPU"), h.res.cpu_pct, (h.res.cpu_pct ?? 0) >= 90 ? "warn" : "ok")}
      {h.res?.available && bar(tx("Mémoire"), h.res.mem_pct, (h.res.mem_pct ?? 0) >= 97 ? "bad" : (h.res.mem_pct ?? 0) >= 90 ? "warn" : "ok",
        h.res.mem_total_mb ? `${((h.res.mem_used_mb ?? 0) / 1024).toFixed(1)} / ${(h.res.mem_total_mb / 1024).toFixed(1)} ${tx("Go")}` : undefined)}
      {(h.disks || []).filter((d) => (d.size_gb ?? 1) >= 1).map((d) => bar(d.mount, d.used_pct, d.critical ? "bad" : d.warning ? "warn" : "ok", d.avail_gb != null ? `${d.avail_gb.toFixed(0)} ${tx("Go libres")}` : undefined))}
    </>
  );
}

/** Ligne dépliée à la demande : cinq rubriques (identité, système, accès, logiciels, santé), chacune avec l'origine de ses données */
function Detail({ m, h, mac, from, watch }: { m: Machine; h?: HealthHost; mac?: string; from: ReturnType<typeof originsOf>; watch: WatchItem[] }) {
  const roles = rolesOf(m.role), i = m.info, hw = hardwareRows(m.agent?.hardware), s = m.ssh;
  const [stTone, stLabel, stTip] = MSTATE[mState(m)];
  const vhosts = (i?.vhosts ?? []) as { port?: number; names?: string[] }[];
  const failed = h?.systemd?.failed.length || 0, apt = h?.apt?.upgradable || 0;
  return (
    <div className="grid gap-3 px-3 py-3 sm:grid-cols-2 xl:grid-cols-3">
      <WatchSummary items={watch} />
      <Section icon={IdCard} title={tx("Identité")} from={[...from.role, ...from.mac]}>
        <Row k={tx("Nom")}><b>{m.name}</b></Row>
        <Row k="IP"><span className="font-mono">{m.ip}</span></Row>
        <Row k={tx("État")}><Badge tone={stTone} title={stTip}>{stLabel}</Badge></Row>
        <Row k={tx("Rôle")}>{roles.length ? <span className="flex flex-wrap gap-1">{roles.map((t) => <Badge key={t} tone="off">{t}</Badge>)}</span> : undefined}</Row>
        <Row k="MAC">{mac && <span className="font-mono">{mac}</span>}</Row>
        <Row k="TTL">{m.ttl ? <span title={tx("Durée de vie des paquets du ping : 64 Linux, 128 Windows")}>{m.ttl}</span> : undefined}</Row>
      </Section>

      <Section icon={Cpu} title={tx("Système")} from={from.os}>
        <Row k={tx("Système")}>{i?.os || m.agent?.os || undefined}</Row>
        <Row k={tx("Noyau")}>{i?.kernel || m.agent?.kernel || undefined}</Row>
        <Row k={tx("En marche")}>{(i?.uptime_s ?? m.agent?.uptime_s) ? dur(i?.uptime_s ?? m.agent?.uptime_s) : undefined}</Row>
        {hw.map(([k, v]) => <Row key={k} k={k}>{v}</Row>)}
        {!i && !m.agent && <Dim>—</Dim>}
      </Section>

      <Section icon={KeyRound} title={tx("Accès")} from={from.ssh}>
        {s ? <>
          <Row k={tx("Connexion")}><span className="font-mono">{s.user || "?"}@{m.ip}:{s.port}</span>{s.port !== 22 && <Badge tone="warn">{tx("port non standard")}</Badge>}</Row>
          <Row k={tx("Alias")}>{s.alias}{s.identity ? "" : tx(" · sans clé")}</Row>
          <Row k={tx("Clé")}><KeyCell m={m} /></Row>
          <Row k={tx("Note")}>{s.note ?? undefined}</Row>
          <Row k={tx("Sécurité")}>
            <span className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1"><HostKey m={m} />{tx("clé d'hôte")}</span>
              <span className="inline-flex items-center gap-1"><Sshd m={m} what="root" />root</span>
              <span className="inline-flex items-center gap-1"><Sshd m={m} what="pwd" />{tx("mot de passe")}</span>
            </span>
          </Row>
        </> : <Row k={tx("SSH")}>{m.local ? tx("local") : <Dim>{tx("pas d'accès SSH configuré")}</Dim>}</Row>}
        {m.agent && <Row k={tx("Agent")}>{tx("relevé par l'agent MyServices")}</Row>}
      </Section>

      <Section icon={Boxes} title={tx("Logiciels et services")} from={from.services}>
        <Row k={tx("Services")}>{m.services}{m.npm > 0 && <Dim> · {m.npm} NPM</Dim>}{m.down > 0 && <span className="text-bad"> · {m.down} {tx("en panne")}</span>}</Row>
        <Row k="Docker">{i?.docker ? tx("{0} conteneur(s) en cours", i.docker) : m.agent?.docker != null ? (m.agent.docker ? tx("{0} conteneur(s) (lus par l'agent)", m.agent.docker) : <Dim>{tx("aucun conteneur")}</Dim>) : i?.docker_installed === false ? <Dim>{tx("absent")}</Dim> : undefined}</Row>
        <Row k="API">{m.api?.length ? <span className="flex flex-wrap gap-1">{m.api.map((a) => <Badge key={`${a.type}/${a.name}`} tone={a.ok ? "ok" : a.stale ? "warn" : "bad"} title={`${a.name} : ${a.message ?? ""}`}>{a.label}{a.version ? ` ${a.version}` : ""}</Badge>)}</span> : undefined}</Row>
        <Row k={tx("Applis")}>{m.agent?.apps?.length ? <span className="flex flex-wrap gap-1">{m.agent.apps.map((a) => <Badge key={a.key} tone="info" title={tx("Vue par les services Windows du PC")}>{a.label}</Badge>)}</span> : undefined}</Row>
        <Row k="Apache">{i?.apache ? <>{tx("{0} vhost(s)", vhosts.length)}{!!i.vhosts_unreadable?.length && <span className="text-warn"> · {i.vhosts_unreadable.length} {tx("illisible(s)")}</span>}</> : undefined}</Row>
        {i?.apache && vhosts.slice(0, 6).map((v, n) => <Row key={n} k=""><span className="font-mono text-[11px] text-muted">:{v.port} {(v.names ?? []).join(", ") || "—"}</span></Row>)}
        <Row k="nginx">{i?.nginx ? tx("actif sur la machine (hors conteneur)") : undefined}</Row>
        {!m.services && !i?.docker && !i?.apache && !i?.nginx && !m.agent?.docker && !m.agent?.apps?.length && !m.api?.length && <Dim>—</Dim>}
      </Section>

      <Section icon={HeartPulse} title={tx("Santé")} from={from.health}>
        {h ? <>
          <Row k={tx("Niveau")}><Level level={h.reachable === false ? "down" : h.level} /></Row>
          <HealthRows h={h} />
          <Row k="Systemd">{failed ? <span className="text-bad">{tx("{0} service(s) en échec", failed)}</span> : undefined}</Row>
          <Row k={tx("Mises à jour")}>{apt ? tx("{0} paquet(s) à mettre à jour", apt) : undefined}{h.reboot_required && <span className="text-warn"> · {tx("redémarrage requis")}</span>}</Row>
        </> : <Dim>{tx("non suivie")}</Dim>}
      </Section>
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
  // « Ne plus suivre » se règle uniquement dans Réglages → Machines (interrupteur « Machine suivie ») ; ici, les machines non suivies restent masquées d'office.
  const isOff = (m: Machine) => !!m.disabled;
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
      case "watch": { const it = watchItems(m, hb.get(m.ip), snap.data.connectors ?? []); return -(worst(it) * 100 + it.length); }   // le plus grave d'abord
      default: return ipNum(m.ip);
    }
  }, [hb, snap.data.connectors]);
  const sort = useSort(f.shown, keyOf, "ip");
  const watchOf = (m: Machine) => watchItems(m, hb.get(m.ip), snap.data.connectors ?? []);
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
            <th className="w-8 px-1" aria-label={tx("Détails")} /><th className="w-10 px-2" aria-label={tx("Icône")} /><Th k="ip" sort={sort}>{tx("Machine")}</Th><Th k="state" sort={sort}>{tx("État")}</Th><Th k="watch" sort={sort}>{tx("À surveiller")}</Th><Th>{tx("SSH")}</Th><Th k="os" sort={sort}>{tx("Système")}</Th>
            <Th>{tx("Serveurs")}</Th><Th k="svc" sort={sort}>{tx("Services")}</Th>{snap.health && <><Th k="health" sort={sort}>{tx("Santé")}</Th><Th>{tx("CPU")}</Th><Th>{tx("Mémoire")}</Th><Th>{tx("Disque")}</Th><Th>{tx("Systemd")}</Th><Th>{tx("Mises à jour")}</Th></>}
          </>}>
            {sort.sorted.map((m) => {
              const shown = open.has(m.ip), h = hb.get(m.ip), cols = 9 + (snap.health ? 6 : 0);
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
                    <Td>{st(m)}</Td><Td><WatchList items={watchOf(m)} /></Td><Td><SshShort m={m} /></Td>
                    <Td><OsShort m={m} kind={osOf(m)} /></Td><Td><Servers m={m} snap={snap} /></Td>
                    <Td><b>{m.services}</b>{m.down > 0 && <span className="text-xs text-bad"> · {m.down} {tx("en panne")}</span>}</Td>
                    {snap.health && <><Td><Level level={h ? (h.reachable === false ? "down" : h.level) : "na"} /></Td>
                      <Td><ResCell h={h} what="cpu" /></Td><Td><ResCell h={h} what="mem" /></Td><Td><DiskCell h={h} /></Td><Td><SystemdCell h={h} /></Td><Td><UpdatesCell h={h} /></Td></>}
                    
                  </tr>
                  {shown && <tr className={`bg-bg2/40 ${isOff(m) ? "opacity-50" : ""}`}><td colSpan={cols} className="p-0"><Detail m={m} h={h} watch={watchOf(m)} mac={macOf(m)} from={originsOf(m, snap, h, !!scanOs[m.ip]?.os, seen.has(m.ip))} /></td></tr>}
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
                  <WatchList items={watchOf(m)} wrap />
                </div>
              </div>
            ))}
          </Cards>
        </>
      )}
    </div>
  );
}
