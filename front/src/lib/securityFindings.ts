// The security page's findings, worked out from the snapshot: one list of what needs a look, worst first, each with where it comes from and what to do.
import type { Snapshot } from "../api";
import type { Host } from "../types";
import { tx } from "./i18n";
import { risky } from "./ssh";
import { splitHostName } from "./format";
import { certIssue } from "./status";

export type Severity = "bad" | "warn";
export type Area = "fail2ban" | "sites" | "certs" | "ssh" | "ports";
export interface Finding { sev: Severity; area: Area; title: string; detail: string; fix: string }

/** Ports that should not be open on a home network without a reason (clear-text or remote-control protocols, databases, Docker API) */
export const SENSITIVE: Record<number, string> = {
  21: "FTP", 23: "Telnet", 445: "SMB", 139: "NetBIOS", 3389: tx("Bureau à distance (RDP)"), 5900: "VNC", 2375: tx("API Docker sans TLS"),
  3306: "MySQL", 5432: "PostgreSQL", 6379: "Redis", 27017: "MongoDB", 9200: "Elasticsearch", 11211: "Memcached", 1883: tx("MQTT sans TLS"),
};

/** What is missing on a public site (certificates are reported apart) */
export function siteIssues(r: Host): string[] {
  const out: string[] = [];
  if (r.ssl && !r.ssl_forced) out.push(tx("HTTPS non forcé"));
  if (!r.ssl) out.push(tx("pas de HTTPS"));
  if (r.webcheck && r.webcheck.hsts === false) out.push(tx("pas de HSTS"));
  if (!r.block_exploits) out.push(tx("« Block exploits » coupé"));
  if (r.webcheck?.headers_total && (r.webcheck.headers_ok ?? 0) < r.webcheck.headers_total / 2) out.push(tx("en-têtes de sécurité faibles"));
  return out;
}

export const exposedSites = (hosts: Host[]): Host[] => hosts.filter((r) => r.type === "proxy" && r.enabled && !r.acl && !r.acl_adv);

function threatFindings(snap: Snapshot): Finding[] {
  return (snap.data.security ?? []).flatMap((c) => (c.threats ?? []).map((t): Finding => ({
    sev: "bad", area: "fail2ban", title: t.kind === "ip_escalation" ? tx("Une IP attaque plusieurs services") : tx("Campagne d'attaque {0}", t.asn ?? ""),
    detail: `${t.ips.slice(0, 3).join(", ")}${t.ip_count > 3 ? ` +${t.ip_count - 3}` : ""} · ${t.jails.join(", ")}`,
    fix: tx("Vérifier ces adresses dans Fail2ban et les bloquer au pare-feu si elles reviennent."),
  })));
}

function siteFindings(snap: Snapshot): Finding[] {
  return exposedSites(snap.data.hosts).map((r) => ({ r, issues: siteIssues(r) })).filter((x) => x.issues.length).map(({ r, issues }): Finding => ({
    sev: "warn", area: "sites", title: r.domains[0] ?? tx("site sans nom"), detail: issues.join(" · "),
    fix: tx("Dans Nginx Proxy Manager : forcer HTTPS, activer HSTS et « Block exploits », ou protéger par une liste d'accès."),
  }));
}

function certFindings(snap: Snapshot): Finding[] {
  return snap.data.hosts.filter((r) => r.enabled && !r.paused).map((r) => ({ r, why: certIssue(r) })).filter((x) => x.why).map(({ r, why }): Finding => ({
    sev: why.includes("invalide") ? "bad" : "warn", area: "certs", title: r.domains[0] ?? tx("site sans nom"), detail: why,
    fix: tx("Renouveler le certificat (Let's Encrypt, ou celui du proxy) avant qu'il n'expire."),
  }));
}

function sshFindings(snap: Snapshot): Finding[] {
  const health = new Map((snap.health?.hosts ?? []).map((h) => [splitHostName(h.name)[1], h]));
  return snap.data.machine_list.filter((m) => !m.disabled).flatMap((m): Finding[] => {
    const d = m.info?.sshd, fails = health.get(m.ip)?.ssh_auth;
    const weak = [d && risky(d.permitrootlogin) ? tx("root autorisé") : "", d?.passwordauthentication?.startsWith("yes") ? tx("mot de passe autorisé") : ""].filter(Boolean);
    const out: Finding[] = [];
    if (weak.length) out.push({ sev: "warn", area: "ssh", title: m.name, detail: weak.join(" · "), fix: tx("Dans sshd_config : PermitRootLogin no et PasswordAuthentication no, avec des clés SSH.") });
    if (fails?.available && fails.failed_24h > 50) out.push({ sev: "bad", area: "ssh", title: m.name, detail: tx("{0} connexions refusées en 24 h", fails.failed_24h), fix: tx("Quelqu'un essaie des mots de passe : installer Fail2ban ou limiter l'accès SSH au réseau local.") });
    return out;
  });
}

function portFindings(snap: Snapshot): Finding[] {
  return (snap.data.network ?? []).flatMap((c) => c.devices ?? []).map((d) => ({ d, hit: d.ports.filter((p) => SENSITIVE[p]) })).filter((x) => x.hit.length)
    .map(({ d, hit }): Finding => ({ sev: "warn", area: "ports", title: d.hostname || d.vendor || d.ip, detail: hit.map((p) => `${p} ${SENSITIVE[p]}`).join(" · "), fix: tx("Fermer le port s'il ne sert pas, ou le limiter à un réseau de confiance.") }));
}

const AREAS: Area[] = ["fail2ban", "certs", "sites", "ssh", "ports"];

/** Everything that needs a look, red first, then by area */
export function securityFindings(snap: Snapshot): Finding[] {
  return [...threatFindings(snap), ...certFindings(snap), ...siteFindings(snap), ...sshFindings(snap), ...portFindings(snap)]
    .sort((a, b) => Number(b.sev === "bad") - Number(a.sev === "bad") || AREAS.indexOf(a.area) - AREAS.indexOf(b.area));
}
