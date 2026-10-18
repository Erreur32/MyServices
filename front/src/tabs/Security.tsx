// Sécurité : une vue d'ensemble de ce qu'il faut traiter, puis un sous-onglet par catégorie (Fail2ban, sites exposés, accès SSH,
// ports du réseau, certificats). Lecture seule.
import { Ban, FileBadge, Globe, KeyRound, LayoutDashboard, Radar, ShieldAlert, ShieldCheck, UserCog, Wrench, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { Snapshot } from "../api";
import { Certificates } from "../components/Certificates";
import { Fail2banCard } from "../components/Fail2banCard";
import { Fail2banStats } from "../components/Fail2banStats";
import { FoldPanel } from "../components/FoldPanel";
import { InfoNote } from "../components/InfoNote";
import { Badge, Count, Dim, Empty } from "../components/ui";
import { splitHostName } from "../lib/format";
import { tx } from "../lib/i18n";
import { exposedSites, securityFindings, SENSITIVE, siteIssues, type Area, type Finding } from "../lib/securityFindings";
import { risky } from "../lib/ssh";
import { accessFindings } from "../lib/accessFindings";
import { SecurityAccess, useAccessData } from "../components/SecurityAccess";

type Sub = "overview" | "fail2ban" | "sites" | "access" | "members" | "network" | "certs";
const SUBS: { id: Sub; label: string; icon: LucideIcon; area?: Area }[] = [
  { id: "overview", label: tx("Vue d'ensemble"), icon: LayoutDashboard },
  { id: "fail2ban", label: tx("Fail2ban"), icon: Ban, area: "fail2ban" },
  { id: "sites", label: tx("Sites exposés"), icon: Globe, area: "sites" },
  { id: "access", label: tx("Accès SSH"), icon: KeyRound, area: "ssh" },
  { id: "members", label: tx("Accès à MyServices"), icon: UserCog, area: "access" },
  { id: "network", label: tx("Ports du réseau"), icon: Radar, area: "ports" },
  { id: "certs", label: tx("Certificats"), icon: FileBadge, area: "certs" },
];
const SUB_KEY = "ms.security.sub";
const AREA_LABEL: Record<Area, string> = { fail2ban: tx("Fail2ban"), sites: tx("Site"), certs: tx("Certificat"), ssh: tx("SSH"), access: tx("Accès"), ports: tx("Port") };
const AREA_SUB: Record<Area, Sub> = { fail2ban: "fail2ban", sites: "sites", certs: "certs", ssh: "access", access: "members", ports: "network" };

const savedSub = (): Sub => { try { const v = localStorage.getItem(SUB_KEY); return SUBS.some((s) => s.id === v) ? (v as Sub) : "overview"; } catch { return "overview"; } };

function Posture({ findings }: Readonly<{ findings: Finding[] }>) {
  const bad = findings.filter((f) => f.sev === "bad").length;
  let tone: "ok" | "warn" | "bad" = "warn";
  if (findings.length === 0) tone = "ok";
  else if (bad) tone = "bad";
  const frame = { ok: "border-ok/40 bg-ok/10", warn: "border-warn/50 bg-warn/10", bad: "border-bad/50 bg-bad/10" }[tone];
  const Icon = tone === "ok" ? ShieldCheck : ShieldAlert;
  return (
    <div className={`flex items-center gap-3 rounded-2xl border px-5 py-4 ${frame}`}>
      <Icon size={26} className={{ ok: "text-ok", warn: "text-warn", bad: "text-bad" }[tone]} aria-hidden />
      <div>
        <h2 className="text-lg font-bold">{findings.length ? tx("{0} point(s) de sécurité à traiter", findings.length) : tx("Rien à signaler")}</h2>
        <p className="text-sm text-muted">{findings.length ? tx("dont {0} urgent(s) : les plus graves sont en tête de liste.", bad) : tx("Aucune exposition ni réglage faible détecté par vos outils.")}</p>
      </div>
    </div>
  );
}

/** One point to handle as a card: severity on the left edge, what it is, what to do, and a button to the sub-tab that holds it */
function FindingCard({ f, open }: Readonly<{ f: Finding; open: (s: Sub) => void }>) {
  const bad = f.sev === "bad";
  return (
    <li className={`flex flex-col gap-2 rounded-xl border border-l-4 bg-card px-4 py-3 ${bad ? "border-bad/40 border-l-bad" : "border-warn/40 border-l-warn"}`}>
      <div className="flex flex-wrap items-center gap-2"><Badge tone={bad ? "bad" : "warn"}>{AREA_LABEL[f.area]}</Badge><b className="min-w-0 flex-1 truncate" title={f.title}>{f.title}</b></div>
      <p className="text-sm text-muted">{f.detail}</p>
      <p className="flex items-start gap-1.5 text-xs text-dim"><Wrench size={12} className="mt-0.5 shrink-0" aria-hidden />{f.fix}</p>
      <button type="button" onClick={() => open(AREA_SUB[f.area])} className="mt-auto self-start rounded-full border border-line bg-bg2/60 px-2.5 py-1 text-xs font-semibold text-muted hover:border-link hover:text-link">{tx("Voir")}</button>
    </li>
  );
}

/** One tile per area: its icon, how many points it holds (green when none) and a fact read from the tools; a click opens the sub-tab */
function AreaTiles({ snap, findings, admin, open }: Readonly<{ snap: Snapshot; findings: Finding[]; admin: boolean; open: (s: Sub) => void }>) {
  const bans24 = (snap.data.security ?? []).reduce((n, c) => n + (c.stats?.hours ?? []).reduce((a, v) => a + v, 0), 0);
  const facts: Record<Area, string> = {
    fail2ban: (snap.data.security ?? []).length ? tx("{0} bannissement(s) en 24 h", bans24) : tx("non relié"),
    sites: tx("{0} site(s) exposé(s)", exposedSites(snap.data.hosts).length),
    ssh: tx("{0} machine(s) lue(s)", snap.data.machine_list.filter((m) => !m.disabled && m.info?.sshd).length),
    access: tx("comptes, jetons, agents"),
    ports: tx("{0} port(s) sensible(s)", (snap.data.network ?? []).flatMap((c) => c.devices ?? []).reduce((n, d) => n + d.ports.filter((p) => SENSITIVE[p]).length, 0)),
    certs: tx("expirations"),
  };
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {SUBS.filter((x): x is typeof x & { area: Area } => !!x.area && (admin || x.id !== "members")).map(({ id, label, icon: Icon, area }) => {
        const mine = findings.filter((f) => f.area === area);
        const tone = mine.some((f) => f.sev === "bad") ? "bad" : mine.length ? "warn" : "ok";
        const color = { ok: "text-ok", warn: "text-warn", bad: "text-bad" }[tone];
        const frame = { ok: "border-line", warn: "border-warn/50", bad: "border-bad/50" }[tone];
        return (
          <button key={id} type="button" onClick={() => open(id)} className={`flex flex-col gap-1 rounded-xl border bg-card px-3 py-3 text-left hover:border-link ${frame}`}>
            <span className="flex items-center gap-2 text-sm font-semibold"><Icon size={16} className={color} aria-hidden />{label}</span>
            <span className={`font-mono text-2xl font-bold leading-none ${color}`}>{mine.length || "OK"}</span>
            <span className="truncate text-xs text-dim">{facts[area]}</span>
          </button>
        );
      })}
    </div>
  );
}

function Overview({ snap, findings, admin, open }: Readonly<{ snap: Snapshot; findings: Finding[]; admin: boolean; open: (s: Sub) => void }>) {
  return (
    <div className="flex flex-col gap-4">
      <Posture findings={findings} />
      <AreaTiles snap={snap} findings={findings} admin={admin} open={open} />
      {findings.length > 0 && (
        <section aria-label={tx("À traiter d'abord")}>
          <h2 className="mb-2 font-bold">{tx("À traiter d'abord")} <Count n={findings.length} tone="warn" /></h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{findings.map((f) => <FindingCard key={`${f.area}/${f.title}/${f.detail}`} f={f} open={open} />)}</ul>
        </section>
      )}
      <InfoNote>{tx("Cette page lit ce que vos outils savent (Fail2ban par LogviewR, Nginx Proxy Manager, SSH, MynetworK). Elle ne change rien et ne donne pas de note : des faits, du plus grave au moins grave.")}</InfoNote>
      {(snap.data.security ?? []).length === 0 && <InfoNote tone="warn">{tx("Aucun Fail2ban n'est relié : reliez LogviewR (Réglages, Connecteurs) pour voir les bannissements et les menaces.")}</InfoNote>}
    </div>
  );
}

function SitesList({ snap }: Readonly<{ snap: Snapshot }>) {
  const rows = useMemo(() => exposedSites(snap.data.hosts).map((r) => ({ r, issues: siteIssues(r) })).sort((a, b) => b.issues.length - a.issues.length), [snap.data.hosts]);
  if (!rows.length) return <Empty>{tx("Aucun site public : tous les hôtes de Nginx Proxy Manager sont derrière une liste d'accès.")}</Empty>;
  return (
    <FoldPanel id="security.sites" icon={Globe} title={tx("Sites exposés à Internet")} count={rows.length}>
      <InfoNote className="mb-2">{tx("Hôtes de Nginx Proxy Manager actifs et sans liste d'accès : joignables de partout. Ce qui manque est en orange.")}</InfoNote>
      <ul className="flex flex-col divide-y divide-line/60 text-sm [&>li:nth-child(even)]:bg-bg/50">
        {rows.map(({ r, issues }) => (
          <li key={`${r.npm}-${r.id}`} className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-2 py-2 md:grid-cols-[minmax(0,16rem)_minmax(0,9rem)_minmax(0,1fr)]">
            <span className="truncate font-semibold">{r.domains[0]}</span>
            <span className="flex items-center gap-1.5 truncate text-dim">{r.machine ?? ""}{r.public_ok && <Badge tone="info" title={tx("Marqué « site public voulu » dans Services")}>{tx("public voulu")}</Badge>}</span>
            <span className="flex flex-wrap gap-1">{issues.length ? issues.map((x) => <Badge key={x} tone="warn">{x}</Badge>) : <Badge tone="ok">{tx("rien à signaler")}</Badge>}</span>
          </li>
        ))}
      </ul>
    </FoldPanel>
  );
}

function AccessList({ snap }: Readonly<{ snap: Snapshot }>) {
  const health = useMemo(() => new Map((snap.health?.hosts ?? []).map((h) => [splitHostName(h.name)[1], h])), [snap.health]);
  const rows = snap.data.machine_list.filter((m) => !m.disabled && (m.info?.sshd || health.get(m.ip)?.ssh_auth?.available)).map((m) => {
    const d = m.info?.sshd, a = health.get(m.ip)?.ssh_auth;
    return { m, d, root: risky(d?.permitrootlogin), pwd: !!d?.passwordauthentication?.startsWith("yes"), fails: a?.available ? a.failed_24h : null };
  }).sort((a, b) => Number(b.root) + Number(b.pwd) - Number(a.root) - Number(a.pwd) || (b.fails ?? 0) - (a.fails ?? 0));
  if (!rows.length) return <Empty>{tx("Aucune machine lue par SSH : l'accès SSH n'a rien à montrer.")}</Empty>;
  return (
    <FoldPanel id="security.ssh" icon={KeyRound} title={tx("Accès SSH des machines")} count={rows.length}>
      <InfoNote className="mb-3">{tx("Réglages du serveur SSH lus sur chaque machine, et connexions refusées sur 24 h (santé).")}</InfoNote>
      <div className={`${SSH_COLS} mb-1 hidden border-b border-line px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-dim md:grid`} aria-hidden>
        <span>{tx("Machine")}</span><span>{tx("Connexion root")}</span><span>{tx("Mot de passe")}</span><span>{tx("Échecs sur 24 h")}</span>
      </div>
      <ul className="flex flex-col divide-y divide-line/60 text-sm [&>li:nth-child(even)]:bg-bg/50">
        {rows.map(({ m, d, root, pwd, fails }) => (
          <li key={m.ip} className={`${SSH_COLS} items-center px-2 py-2`}>
            <span className="truncate font-semibold">{m.name} <Dim>{m.ip}</Dim></span>
            <SshCell label={tx("Connexion root")} value={d?.permitrootlogin} warn={root} known={!!d} />
            <SshCell label={tx("Mot de passe")} value={d?.passwordauthentication} warn={pwd} known={!!d} />
            <span className="flex items-center gap-2 md:block"><span className="text-xs text-dim md:hidden">{tx("Échecs sur 24 h")}</span>
              {fails == null ? <Dim>-</Dim> : <Badge outline tone={failTone(fails)}>{fails}</Badge>}</span>
          </li>
        ))}
      </ul>
    </FoldPanel>
  );
}

/** Refused SSH logins in 24 h: none is fine, a few is a note, many means someone is trying */
function failTone(n: number): "ok" | "warn" | "bad" {
  if (n > 50) return "bad";
  return n ? "warn" : "ok";
}

const SSH_COLS = "grid gap-x-6 gap-y-1 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]";   // the machine gets the most room, the three settings share the rest evenly

/** One setting of a machine's SSH server: the label on a phone, the value as an outlined badge (no filled background) */
function SshCell({ label, value, warn, known }: Readonly<{ label: string; value?: string; warn: boolean; known: boolean }>) {
  return (
    <span className="flex items-center gap-2 md:block">
      <span className="text-xs text-dim md:hidden">{label}</span>
      {known ? <Badge outline tone={warn ? "warn" : "ok"}>{value || "?"}</Badge> : <Dim>-</Dim>}
    </span>
  );
}

function PortsList({ snap }: Readonly<{ snap: Snapshot }>) {
  const rows = (snap.data.network ?? []).flatMap((c) => c.devices ?? []).map((d) => ({ d, hit: d.ports.filter((p) => SENSITIVE[p]) })).filter((x) => x.hit.length).sort((a, b) => b.hit.length - a.hit.length);
  if (!rows.length) return <Empty>{tx("Aucun port sensible ouvert vu sur le réseau.")}</Empty>;
  return (
    <FoldPanel id="security.ports" icon={Radar} title={tx("Ports sensibles ouverts sur le réseau")} count={rows.length} tone="warn">
      <InfoNote className="mb-2">{tx("Vus par le scanner de MynetworK : protocoles en clair, prise de main à distance, bases de données. À fermer s'ils ne servent pas.")}</InfoNote>
      <ul className="flex flex-col divide-y divide-line/60 text-sm [&>li:nth-child(even)]:bg-bg/50">
        {rows.map(({ d, hit }) => (
          <li key={d.ip} className="grid items-center gap-x-4 gap-y-1 px-2 py-2 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <span className="truncate font-semibold">{d.hostname || d.vendor || d.ip} <Dim>{d.ip}</Dim></span>
            <span className="flex flex-wrap gap-1">{hit.map((p) => <Badge key={p} tone="warn">{p} · {SENSITIVE[p]}</Badge>)}</span>
          </li>
        ))}
      </ul>
    </FoldPanel>
  );
}

function Menu({ sub, pick, counts, admin }: Readonly<{ sub: Sub; pick: (s: Sub) => void; counts: Partial<Record<Area, number>>; admin: boolean }>) {
  return (
    <fieldset className="m-0 flex min-w-0 max-w-full flex-wrap self-start rounded-lg border border-line bg-card p-0.5" aria-label={tx("Sous-menu de la sécurité")}>
      {SUBS.filter((x) => admin || x.id !== "members").map(({ id, label, icon: Icon, area }) => (
        <button key={id} type="button" aria-pressed={sub === id} onClick={() => pick(id)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold ${sub === id ? "border-link bg-link/15 text-txt ring-1 ring-link/50" : "border-transparent text-muted hover:text-txt"}`}>
          <Icon size={14} aria-hidden />{label}{area && (counts[area] ?? 0) > 0 && <Badge tone="warn">{counts[area]}</Badge>}
        </button>
      ))}
    </fieldset>
  );
}

export function Security({ snap }: Readonly<{ snap: Snapshot }>) {
  const [sub, setSub] = useState<Sub>(savedSub);
  const pick = (s: Sub) => { setSub(s); try { localStorage.setItem(SUB_KEY, s); } catch { /* storage refused: the choice lasts this visit */ } };
  const admin = snap.me.role === "admin", access = useAccessData(admin), now = Math.floor(Date.now() / 1000);
  const findings = useMemo(() => securityFindings(snap, access ? accessFindings(access, now) : []), [snap, access, now]);
  const counts = useMemo(() => findings.reduce<Partial<Record<Area, number>>>((n, f) => ({ ...n, [f.area]: (n[f.area] ?? 0) + 1 }), {}), [findings]);
  const sources = snap.data.security ?? [];
  return (
    <div className="flex flex-col gap-4 py-4">
      <Menu sub={sub} pick={pick} counts={counts} admin={admin} />
      {sub === "overview" && <Overview snap={snap} findings={findings} admin={admin} open={pick} />}
      {sub === "fail2ban" && (sources.length ? <><Fail2banStats sources={sources} />{sources.map((c) => <Fail2banCard key={`${c.connector}/${c.name}`} c={c} />)}</> : <Empty>{tx("Aucun Fail2ban n'est relié : reliez LogviewR dans Réglages, Connecteurs.")}</Empty>)}
      {sub === "sites" && <SitesList snap={snap} />}
      {sub === "access" && <AccessList snap={snap} />}
      {sub === "members" && admin && <SecurityAccess data={access} now={now} />}
      {sub === "network" && <PortsList snap={snap} />}
      {sub === "certs" && <Certificates snap={snap} />}
    </div>
  );
}
