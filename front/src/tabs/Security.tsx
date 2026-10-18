// Sécurité (remplace l'onglet Fail2ban) : ce que vos outils disent de l'exposition et des attaques, en une page, lecture seule.
//   Résumé · Fail2ban et menaces actives (LogviewR) · Sites exposés à Internet (NPM, Web-Check) · Certificats · Accès SSH des machines
//   (sshd, échecs) · Ports sensibles vus sur le réseau (MynetworK). Pas de score d'exposition (décision de l'auteur) : des faits.
import { Ban, Globe, KeyRound, Radar, ShieldAlert, Siren } from "lucide-react";
import { useMemo } from "react";
import type { Snapshot } from "../api";
import { dateTime, splitHostName } from "../lib/format";
import { risky } from "../lib/ssh";
import { tx } from "../lib/i18n";
import type { HealthHost, Host, SecurityConnector } from "../types";
import { Badge, Card, Count, Dim, Empty } from "../components/ui";
import { Certificates, CERT_SOON } from "../components/Certificates";
import { InfoNote } from "../components/InfoNote";

/** Ports that should not be open on a home network without a reason (clear-text or remote-control protocols, databases, Docker API) */
const SENSITIVE: Record<number, string> = {
  21: "FTP", 23: "Telnet", 445: "SMB", 139: "NetBIOS", 3389: tx("Bureau à distance (RDP)"), 5900: "VNC", 2375: tx("API Docker sans TLS"),
  3306: "MySQL", 5432: "PostgreSQL", 6379: "Redis", 27017: "MongoDB", 9200: "Elasticsearch", 11211: "Memcached", 1883: tx("MQTT sans TLS"),
};

function Tile({ value, label, tone, icon: Icon }: { value: number | string; label: string; tone: "ok" | "warn" | "bad" | "off"; icon: typeof Ban }) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-muted";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3">
      <Icon size={20} className={color} aria-hidden />
      <div><div className={`font-mono text-xl font-bold leading-tight ${color}`}>{value}</div><div className="text-xs text-dim">{label}</div></div>
    </div>
  );
}

/** A public site (NPM proxy without access list): what protects it, what is missing */
function siteIssues(r: Host): string[] {
  const out = [];
  if (r.ssl && !r.ssl_forced) out.push(tx("HTTPS non forcé"));
  if (!r.ssl) out.push(tx("pas de HTTPS"));
  if (r.webcheck && r.webcheck.hsts === false) out.push(tx("pas de HSTS"));
  if (!r.block_exploits) out.push(tx("« Block exploits » coupé"));
  const d = r.webcheck?.cert_days ?? (r.uptime ?? []).find((u) => u.cert_days != null)?.cert_days;
  if (d != null && d <= CERT_SOON) out.push(d < 0 ? tx("certificat expiré") : tx("certificat dans {0} j", d));
  if (r.webcheck?.headers_total && (r.webcheck.headers_ok ?? 0) < r.webcheck.headers_total / 2) out.push(tx("en-têtes de sécurité faibles"));
  return out;
}

const BAN_COLS = "grid items-center gap-x-6 md:grid-cols-[minmax(0,12rem)_10rem_7rem_minmax(0,1fr)]";
const BANS_SHOWN = 15;

function BanRow({ b }: Readonly<{ b: NonNullable<SecurityConnector["bans"]>[number] }>) {
  return (
    <li className={`${BAN_COLS} gap-y-1 px-2 py-1.5`}>
      <code className="truncate font-mono text-xs">{b.ip}</code>
      <span><Badge outline tone="off">{b.jail}</Badge></span>
      <span className="text-xs text-muted">{b.failures ? `${b.failures} ${tx("échecs")}` : <Dim>-</Dim>}</span>
      <span className="text-xs text-dim md:text-right">{b.time ? dateTime(b.time * 1000) : ""}</span>
    </li>
  );
}

/** The latest bans, newest first, on aligned columns: the first ones in view, the others folded */
function LastBans({ bans }: Readonly<{ bans: NonNullable<SecurityConnector["bans"]> }>) {
  const sorted = [...bans].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 50);
  return (
    <div className="mt-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">{tx("Derniers bannissements")} <Count n={bans.length} tone="off" /></h3>
      <div className={`${BAN_COLS} border-b border-line px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim max-md:hidden`} aria-hidden>
        <span>{tx("Adresse")}</span><span>{tx("Jail")}</span><span>{tx("Échecs")}</span><span className="text-right">{tx("Quand")}</span>
      </div>
      <ul className="flex flex-col divide-y divide-line/50 text-sm [&>li:nth-child(even)]:bg-bg/50">{sorted.slice(0, BANS_SHOWN).map((b, i) => <BanRow key={i} b={b} />)}</ul>
      {sorted.length > BANS_SHOWN && (
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer px-1 py-1 text-xs font-semibold text-muted hover:text-txt">{tx("Voir les {0} suivants", sorted.length - BANS_SHOWN)}</summary>
          <ul className="flex flex-col divide-y divide-line/50 text-sm [&>li:nth-child(even)]:bg-bg/50">{sorted.slice(BANS_SHOWN).map((b, i) => <BanRow key={i} b={b} />)}</ul>
        </details>
      )}
    </div>
  );
}

/** One Fail2ban / LogviewR connector: jails, active threats and the latest bans (shared with the new security page) */
export function Fail2banCard({ c }: Readonly<{ c: SecurityConnector }>) {
  const byJail = new Map<string, number>();
  (c.bans ?? []).forEach((b) => byJail.set(b.jail, (byJail.get(b.jail) ?? 0) + 1));
  return (
    <Card className={c.ok ? "" : "border-bad/40"}>
      <h2 className="flex flex-wrap items-center gap-2 font-bold"><Ban size={16} aria-hidden />{tx("Fail2ban")} <Dim>· {c.label} {c.name}</Dim>
        <Badge tone={c.ok ? "ok" : "bad"}>{c.ok ? tx("en ligne") : tx("illisible")}</Badge>{c.stale && <Badge tone="warn">{tx("relevé périmé")}</Badge>}</h2>
      {!c.ok && !c.stale ? <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{c.message}</p> : <>
        {(c.jails ?? []).length > 0 && <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">{c.jails!.map((j) => <Badge key={j} tone={byJail.has(j) ? "warn" : "off"}>{j}{byJail.has(j) && ` · ${byJail.get(j)}`}</Badge>)}</p>}
        {(c.threats ?? []).length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-bad"><ShieldAlert size={14} aria-hidden />{tx("Menaces actives")} <Count n={c.threats!.length} tone="bad" /></h3>
            <ul className="flex flex-col gap-1 text-sm">
              {c.threats!.map((t) => (
                <li key={t.key} className="flex flex-wrap items-baseline gap-2 rounded-lg bg-bad/5 px-3 py-1.5">
                  <Badge tone="bad">{t.kind === "ip_escalation" ? tx("IP sur plusieurs jails") : tx("campagne {0}", t.asn ?? "")}</Badge>
                  <code className="font-mono text-xs">{t.ips.slice(0, 5).join(", ")}{t.ip_count > 5 ? ` +${t.ip_count - 5}` : ""}</code>
                  <Dim>{t.jails.join(", ")}{t.bans != null ? ` · ${t.bans} ${tx("bannissement(s)")}` : ""}{t.last ? ` · ${tx("dernier")} ${dateTime(t.last * 1000)}` : ""}</Dim>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(c.bans ?? []).length > 0 && <LastBans bans={c.bans!} />}
      </>}
    </Card>
  );

}

export function Security({ snap }: { snap: Snapshot }) {
  const lv = snap.data.security ?? [];
  const exposed = useMemo(() => snap.data.hosts.filter((r) => r.type === "proxy" && r.enabled && !r.acl && !r.acl_adv)
    .map((r) => ({ r, issues: siteIssues(r) })).sort((a, b) => b.issues.length - a.issues.length || (a.r.domains[0] ?? "").localeCompare(b.r.domains[0] ?? "")), [snap.data.hosts]);
  const health = useMemo(() => new Map((snap.health?.hosts ?? []).map((h): [string, HealthHost] => [splitHostName(h.name)[1], h])), [snap.health]);
  const ssh = snap.data.machine_list.filter((m) => !m.disabled && (m.info?.sshd || health.get(m.ip)?.ssh_auth?.available)).map((m) => {
    const d = m.info?.sshd, fails = health.get(m.ip)?.ssh_auth;
    return { m, root: risky(d?.permitrootlogin), pwd: !!d?.passwordauthentication?.startsWith("yes"), fails: fails?.available ? fails.failed_24h : null, d };
  }).sort((a, b) => Number(b.root) + Number(b.pwd) - Number(a.root) - Number(a.pwd) || (b.fails ?? 0) - (a.fails ?? 0));
  const ports = useMemo(() => (snap.data.network ?? []).flatMap((c) => c.devices ?? []).map((d) => ({ d, hit: d.ports.filter((p) => SENSITIVE[p]) }))
    .filter((x) => x.hit.length).sort((a, b) => b.hit.length - a.hit.length), [snap.data.network]);
  const bans = lv.reduce((s, c) => s + (c.bans_24h ?? 0), 0), threats = lv.reduce((s, c) => s + (c.threat_count ?? 0), 0);
  const weakSites = exposed.filter((x) => x.issues.length).length, weakSsh = ssh.filter((x) => x.root || x.pwd).length;
  if (!lv.length && !exposed.length && !ssh.length && !ports.length) return <Empty>{tx("Rien à montrer : reliez LogviewR, Nginx Proxy Manager ou MynetworK, ou lisez une machine par SSH.")}</Empty>;

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {lv.length > 0 && <Tile icon={Ban} value={bans} label={tx("bannissements en 24 h")} tone={bans ? "warn" : "ok"} />}
        {lv.length > 0 && <Tile icon={Siren} value={threats} label={tx("menaces actives")} tone={threats ? "bad" : "ok"} />}
        <Tile icon={Globe} value={`${weakSites} / ${exposed.length}`} label={tx("sites publics à renforcer")} tone={weakSites ? "warn" : "ok"} />
        <Tile icon={KeyRound} value={`${weakSsh} / ${ssh.length}`} label={tx("machines : SSH root ou mot de passe")} tone={weakSsh ? "warn" : "ok"} />
        {(snap.data.network ?? []).length > 0 && <Tile icon={Radar} value={ports.length} label={tx("appareils avec un port sensible")} tone={ports.length ? "warn" : "ok"} />}
      </div>

      {lv.map((c) => <Fail2banCard key={`${c.connector}/${c.name}`} c={c} />)}

      {exposed.length > 0 && (
        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-bold"><Globe size={16} aria-hidden />{tx("Sites exposés à Internet")} <Count n={exposed.length} tone="off" /></h2>
          <InfoNote className="mb-2">{tx("Hôtes de Nginx Proxy Manager actifs et sans liste d'accès : joignables de partout. Ce qui manque est en orange.")}</InfoNote>
          <ul className="flex flex-col divide-y divide-line/60 text-sm">
            {exposed.map(({ r, issues }) => (
              <li key={`${r.npm}-${r.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
                <span className="min-w-[14rem] truncate font-semibold">{r.domains[0]}</span>
                {r.public_ok && <Badge tone="info" title={tx("Marqué « site public voulu » dans Services")}>{tx("public voulu")}</Badge>}
                {r.machine && <Dim>{r.machine}</Dim>}
                <span className="flex flex-wrap gap-1">{issues.length ? issues.map((x) => <Badge key={x} tone="warn">{x}</Badge>) : <Badge tone="ok">{tx("rien à signaler")}</Badge>}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Certificates snap={snap} />

      {ssh.length > 0 && (
        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-bold"><KeyRound size={16} aria-hidden />{tx("Accès SSH des machines")} <Count n={ssh.length} tone="off" /></h2>
          <InfoNote className="mb-2">{tx("Réglages du serveur SSH lus sur chaque machine, et connexions refusées sur 24 h (santé).")}</InfoNote>
          <ul className="flex flex-col divide-y divide-line/60 text-sm">
            {ssh.map(({ m, root, pwd, fails, d }) => (
              <li key={m.ip} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
                <span className="min-w-[12rem] font-semibold">{m.name} <Dim>{m.ip}</Dim></span>
                {d && <Badge tone={root ? "warn" : "ok"}>{tx("root")} : {d.permitrootlogin || "?"}</Badge>}
                {d && <Badge tone={pwd ? "warn" : "ok"}>{tx("mot de passe")} : {d.passwordauthentication || "?"}</Badge>}
                {fails != null && <Badge tone={fails > 50 ? "bad" : fails ? "warn" : "ok"}>{tx("{0} échec(s) en 24 h", fails)}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {ports.length > 0 && (
        <Card>
          <h2 className="mb-1 flex items-center gap-2 font-bold"><Radar size={16} aria-hidden />{tx("Ports sensibles ouverts sur le réseau")} <Count n={ports.length} tone="warn" /></h2>
          <InfoNote className="mb-2">{tx("Vus par le scanner de MynetworK : protocoles en clair, prise de main à distance, bases de données. À fermer s'ils ne servent pas.")}</InfoNote>
          <ul className="flex flex-col divide-y divide-line/60 text-sm">
            {ports.map(({ d, hit }) => (
              <li key={d.ip} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
                <span className="min-w-[12rem] font-semibold">{d.hostname || d.vendor || d.ip} <Dim>{d.ip}</Dim></span>
                <span className="flex flex-wrap gap-1">{hit.map((p) => <Badge key={p} tone="warn">{p} · {SENSITIVE[p]}</Badge>)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
