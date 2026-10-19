// Security in « state » mode: a title line naming the tools read, six figures, then « To watch » (one row per problem, worst first, the
// detail unfolding in the row) and, under it, one sub-tab per area (Fail2ban, public sites, SSH access, access to MyServices, network
// ports, certificates). Read only.
import { Ban, ChevronDown, ChevronUp, FileBadge, Globe, KeyRound, Radar, ShieldCheck, UserCog, Wrench, type LucideIcon } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { Snapshot } from "../api";
import { Certificates } from "../components/Certificates";
import { Fail2banCard } from "../components/Fail2banCard";
import { Fail2banStats } from "../components/Fail2banStats";
import { FoldPanel } from "../components/FoldPanel";
import { InfoNote } from "../components/InfoNote";
import { Badge, Dim, Empty } from "../components/ui";
import { StatTile } from "../components/StatTile";
import { dateTime, splitHostName } from "../lib/format";
import { quiet, WATCH_FRAME, worstTone } from "../lib/forms";
import { watchRows, type WatchRow } from "../lib/securityWatch";
import { CERT_SOON } from "../components/Certificates";
import { tx } from "../lib/i18n";
import { exposedSites, securityFindings, SENSITIVE, siteIssues, type Area, type Finding } from "../lib/securityFindings";
import { risky } from "../lib/ssh";
import { accessFindings } from "../lib/accessFindings";
import { SecurityAccess, useAccessData } from "../components/SecurityAccess";

type Sub = "fail2ban" | "sites" | "access" | "members" | "network" | "certs";
const SUBS: { id: Sub; label: string; icon: LucideIcon; area: Area }[] = [
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

const savedSub = (): Sub => { try { const v = localStorage.getItem(SUB_KEY); return SUBS.some((s) => s.id === v) ? (v as Sub) : "fail2ban"; } catch { return "fail2ban"; } };

/** The six figures: one per area, the number in the colour of its findings, a fact read from the tools under it */
function Figures({ snap, findings, admin }: Readonly<{ snap: Snapshot; findings: Finding[]; admin: boolean }>) {
  const sources = snap.data.security ?? [];
  const bans24 = sources.reduce((n, c) => n + (c.stats?.hours ?? []).reduce((a, v) => a + v, 0), 0);
  const jails = new Set(sources.flatMap((c) => c.jails ?? [])).size, threats = sources.reduce((n, c) => n + (c.threats?.length ?? 0), 0);
  const sites = exposedSites(snap.data.hosts), gaps = sites.filter((r) => siteIssues(r).length).length, wanted = sites.filter((r) => r.public_ok).length;
  const ssh = snap.data.machine_list.filter((m) => !m.disabled && m.info?.sshd), weakSsh = new Set(findings.filter((f) => f.area === "ssh").map((f) => f.title)).size;
  const certs = snap.data.hosts.filter((r) => r.enabled && !r.paused && r.webcheck?.cert_days != null).map((r) => ({ name: r.domains[0] ?? "", days: r.webcheck!.cert_days as number })).sort((a, b) => a.days - b.days);
  const soon = certs.filter((c) => c.days <= CERT_SOON).length;
  const ports = findings.filter((f) => f.area === "ports").length, access = findings.filter((f) => f.area === "access");
  const n = (area: Area) => findings.filter((f) => f.area === area).length;
  const tone = (area: Area) => worstTone(findings.some((f) => f.area === area && f.sev === "bad"), n(area) > 0);
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1">
      <StatTile n={sites.length} label={tx("Sites exposés")} tone={tone("sites")} sub={sites.length ? tx("{0} avec un manque · {1} « public voulu »", gaps, wanted) : tx("tous derrière une liste d'accès")} />
      <StatTile n={sources.length ? bans24 : "-"} label={tx("Fail2ban, 24 h")} tone={sources.length ? tone("fail2ban") : undefined}
        sub={sources.length ? tx("bannissements · {0} prison(s) · {1} menace(s)", jails, threats) : tx("non relié")} />
      <StatTile n={ssh.length ? weakSsh : "-"} label={tx("Accès SSH")} tone={ssh.length ? tone("ssh") : undefined} sub={ssh.length ? tx("sur {0} machine(s), un réglage faible", ssh.length) : tx("aucune machine lue par SSH")} />
      <StatTile n={soon} label={tx("Certificats")} tone={tone("certs")} sub={certs[0] ? tx("le plus proche : {0}, {1} j", certs[0].name, certs[0].days) : tx("aucun certificat lu")} />
      <StatTile n={ports} label={tx("Ports sensibles")} tone={tone("ports")} sub={ports ? tx("appareil(s) avec un port à fermer") : tx("rien vu par le scanner")} />
      {admin && <StatTile n={access.length} label={tx("Accès à MyServices")} tone={tone("access")} sub={access[0]?.detail ?? tx("comptes, jetons, agents : rien à signaler")} />}
    </div>
  );
}

/** « To watch »: one row per problem, the detail unfolding in the row with the things it covers and the way to the sub-tab or the machine */
function Watch({ rows, open }: Readonly<{ rows: WatchRow[]; open: (s: Sub) => void }>) {
  const [on, setOn] = useState<string | null>(null);
  const worst = worstTone(rows.some((r) => r.sev === "bad"), rows.length > 0);
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${WATCH_FRAME[worst]}`} aria-label={tx("À surveiller")}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line/60 bg-bg px-4 py-3">
        <h2 className="font-bold">{tx("À surveiller")}</h2>
        <Badge tone={worst}>{rows.length}</Badge>
        <span className="ml-auto text-xs text-dim">{tx("le plus grave en haut · un site n'apparaît qu'une fois par manque")}</span>
      </div>
      {rows.length === 0 ? <p className="px-4 py-3 text-sm text-ok">{tx("Aucune exposition ni réglage faible détecté par vos outils.")}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
              <th className="px-3 py-2">{tx("Domaine")}</th><th className="px-3 py-2">{tx("Quoi")}</th><th className="px-3 py-2">{tx("Détail")}</th><th className="w-1/3 px-3 py-2">{tx("Quoi faire")}</th><th className="w-24 px-3 py-2" />
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const bad = r.sev === "bad", isOn = on === r.key;
                return (
                  <Fragment key={r.key}>
                    <tr className={`border-t border-line/60 ${isOn ? "bg-bg2/40" : "even:bg-bg/50 hover:bg-bg2/40"}`}>
                      <td className="px-3 py-2"><Badge tone={bad ? "bad" : "warn"}>{AREA_LABEL[r.area]}</Badge></td>
                      <td className="px-3 py-2"><b className="font-semibold">{r.title}</b>{r.sub && <span className="block truncate font-mono text-[11px] text-dim" title={r.sub}>{r.sub}</span>}</td>
                      <td className="px-3 py-2 text-muted">{r.detail}</td>
                      <td className="px-3 py-2 text-xs text-muted"><span className="flex items-start gap-1.5"><Wrench size={12} className="mt-0.5 shrink-0" aria-hidden />{r.fix}</span></td>
                      <td className="px-3 py-2 text-right"><button type="button" onClick={() => setOn(isOn ? null : r.key)} aria-expanded={isOn} className={`${quiet} py-1`}>{isOn ? tx("Replier") : tx("Détail")}{isOn ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}</button></td>
                    </tr>
                    {isOn && (
                      <tr><td colSpan={5} className="bg-link/5 px-4 py-3 shadow-[inset_3px_0_0_rgb(var(--link))]">
                        <ul className="mb-2 flex flex-col gap-1 text-sm">
                          {r.items.map((f) => (
                            <li key={`${f.title}/${f.detail}`} className="flex flex-wrap items-baseline gap-x-2">
                              {f.href ? <a href={f.href} className="font-semibold text-link hover:underline">{f.title}</a> : <b className="font-semibold">{f.title}</b>}
                              {f.sub && <span className="font-mono text-xs text-dim">{f.sub}</span>}<span className="text-muted">{f.detail}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className={`${quiet} py-1`} onClick={() => open(AREA_SUB[r.area])}>{tx("Voir dans {0}", SUBS.find((s) => s.id === AREA_SUB[r.area])?.label ?? "")}</button>
                          {r.items.length === 1 && r.items[0].href && <a href={r.items[0].href} className={`${quiet} py-1`}>{tx("Ouvrir {0}", r.items[0].title)}</a>}
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
          <Icon size={14} aria-hidden />{label}{(counts[area] ?? 0) > 0 && <Badge tone="warn">{counts[area]}</Badge>}
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
  const rows = useMemo(() => watchRows(findings), [findings]);
  const counts = useMemo(() => findings.reduce<Partial<Record<Area, number>>>((n, f) => ({ ...n, [f.area]: (n[f.area] ?? 0) + 1 }), {}), [findings]);
  const sources = snap.data.security ?? [];
  const tools = [sources.length ? tx("Fail2ban par {0}", [...new Set(sources.map((c) => c.name))].join(", ")) : "", Object.keys(snap.data.npm_instances ?? {}).length ? tx("Nginx Proxy Manager ({0})", Object.keys(snap.data.npm_instances).length) : "",
    tx("{0} machine(s) lue(s) par SSH", snap.data.machine_list.filter((m) => !m.disabled && m.info?.sshd).length), (snap.data.network ?? []).length ? "MynetworK" : ""].filter(Boolean);
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck size={18} aria-hidden />{tx("Sécurité")}</h1>
        <span className="text-sm text-muted">{tools.join(" · ")} · {tx("relevé du {0}, en lecture seule", dateTime(snap.data.generated))}</span>
        {admin && <a href="#settings/connectors" className="ml-auto text-sm text-link hover:underline">{tx("Connecteurs")} ›</a>}
      </div>
      <Figures snap={snap} findings={findings} admin={admin} />
      <Watch rows={rows} open={pick} />
      <Menu sub={sub} pick={pick} counts={counts} admin={admin} />
      {sub === "fail2ban" && (sources.length ? <><Fail2banStats sources={sources} />{sources.map((c) => <Fail2banCard key={`${c.connector}/${c.name}`} c={c} />)}</> : <Empty>{tx("Aucun Fail2ban n'est relié : reliez LogviewR dans Réglages, Connecteurs.")}</Empty>)}
      {sub === "sites" && <SitesList snap={snap} />}
      {sub === "access" && <AccessList snap={snap} />}
      {sub === "members" && admin && <SecurityAccess data={access} now={now} />}
      {sub === "network" && <PortsList snap={snap} />}
      {sub === "certs" && <Certificates snap={snap} />}
      <InfoNote>{tx("Cette page lit ce que vos outils savent (Fail2ban par LogviewR, Nginx Proxy Manager, SSH, MynetworK). Elle ne change rien et ne donne pas de note : des faits, du plus grave au moins grave.")}</InfoNote>
      {sources.length === 0 && <InfoNote tone="warn">{tx("Aucun Fail2ban n'est relié : reliez LogviewR (Réglages, Connecteurs) pour voir les bannissements et les menaces.")}</InfoNote>}
    </div>
  );
}
