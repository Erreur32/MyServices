// État d'un service et points à vérifier : même logique que la page actuelle (web/index.html, status() et
// checks()), pour que les deux pages comptent pareil pendant la transition.
import type { Dns, Host } from "../types";
import { tx } from "./i18n";

export type StatusClass = "ok" | "warn" | "bad" | "off";

const KIND_LABEL: Record<string, string> = {
  apache: "Apache", docker: "Docker", process: "process", web: "web", manuel: tx("manuel"), npm: "NPM", inconnu: tx("non identifié"),
};

export function hostName(r: Host): string {
  return r.domains.length ? r.domains[0] : r.name || `${r.ip}:${r.port}`;
}

function httpLabel(c: number): string {
  return c < 300 ? "OK" : c < 400 ? tx("OK · redirige") : c === 401 || c === 403 ? tx("OK · protégé") : c === 404 ? "OK · 404" : tx("OK · {0}", c);
}

/** [classe, libellé court, explication] */
export function status(r: Host): [StatusClass, string, string] {
  const p = r.public || {}, b = r.backend || {};
  if (r.paused) return ["off", tx("en pause"), r.paused];
  if (r.machine_off) return ["off", tx("machine éteinte"), tx("{0} coupée volontairement · non testé", r.machine || r.ip)];
  if (!r.enabled) return ["off", tx("désactivé"), r.type === "redirect" ? tx("redirection désactivée dans NPM")
    : r.type === "dead" ? tx("host 404 désactivé dans NPM") : tx("désactivé dans NPM · backend {0}", b.up ? tx("toujours joignable") : tx("éteint"))];
  if (r.type === "dead") return p.code === 404 ? ["ok", tx("OK · 404 voulu"), tx("NPM répond 404 comme prévu")]
    : ["warn", p.code ? `HTTP ${p.code}` : "erreur", p.err || tx("404 attendu")];
  if (r.type === "stream") return b.up ? ["ok", tx("en ligne"), tx("stream :{0} → backend {1} ms", r.incoming_port, b.ms)]
    : ["bad", tx("backend down"), tx("{0}:{1} injoignable", r.ip, r.port)];
  if (r.type === "redirect") {
    const f = r.follow || {}, svc = r.service ? tx(" · {0} actif", KIND_LABEL[r.service.kind] || r.service.kind) : "";
    if (!p.code) return ["bad", tx("erreur"), p.err || "?"];
    if ((f.code ?? 0) >= 500) return ["warn", `cible ${f.code}`, tx("HTTP {0} → {1} · page finale en erreur {2}", p.code, r.target, f.code)];
    return ["ok", tx("redirige"), tx("HTTP {0} → {1}{2}{3}", p.code, r.target, f.code ? tx(" · page finale {0}", f.code) : "", svc)];
  }
  if (r.type === "local" && b.internal && b.up) return ["ok", tx("en ligne"), tx("apache2 actif · écoute seulement sur {0}:{1}", r.listen_addr || "?", r.port)];
  if (r.type === "local" && b.internal) return ["off", tx("interne"), tx("écoute seulement sur {0}:{1} · non testable", r.listen_addr || "?", r.port)];
  if (r.type === "local") return b.up ? ["ok", tx("en ligne"), tx("TCP {0} ms · accès LAN direct", b.ms)]
    : ["bad", "down", tx("{0}:{1} injoignable ({2})", r.ip, r.port, b.err || "?")];
  if (b.internal) return p.code && p.code < 500 ? ["ok", httpLabel(p.code), tx("HTTP {0} · backend interne docker, testé via NPM", p.code)]
    : ["bad", p.code ? `HTTP ${p.code}` : "erreur", tx("backend interne docker (joignable seulement par NPM)")];
  if (b.up === false) return ["bad", tx("backend down"), tx("{0}:{1} injoignable ({2})", r.ip, r.port, b.err || "?")];
  if ((p.code ?? 0) >= 500) return ["bad", `erreur ${p.code}`, p.code === 502 ? tx("HTTP 502 : NPM ne joint pas le backend") : tx("HTTP {0} : erreur serveur", p.code)];
  if (p.err === "gaierror") return ["warn", tx("DNS absent"), tx("le domaine ne résout pas (aucun enregistrement DNS)")];
  if (p.err === "RemoteDisconnected") return r.closes_root ? ["ok", tx("OK · fermé"), tx("NPM ferme / sans répondre (return 444 voulu)")]
    : ["warn", tx("connexion coupée"), tx("certificat valide, mais NPM ferme la connexion sans réponse HTTP")];
  if (p.err) return ["warn", tx("certificat"), tx("HTTPS refusé par NPM pour ce nom ({0}) : certificat absent ou invalide", p.err)];
  if (p.cert_ok === false) return ["ok", httpLabel(p.code ?? 0), tx("HTTP {0} · certificat ≠ nom (wildcard LAN ?)", p.code)];
  return ["ok", httpLabel(p.code ?? 0), `HTTP ${p.code}`];
}

/** Certificat Web-Check à signaler (invalide, ou expire dans moins de 21 jours) ; "" sinon. */
export function certIssue(r: Host): string {
  const w = r.webcheck;
  if (!w) return "";
  if (w.cert_valid === false) return tx("certificat invalide");
  if (w.cert_days != null && w.cert_days < 21) return tx("certificat : {0} j", w.cert_days);
  return "";
}

function exposure(r: Host): "prive" | "public" | "ouvert" | null {
  if (r.type !== "proxy" || !r.enabled || r.paused) return null;
  return r.acl || r.acl_adv ? "prive" : r.public_ok ? "public" : "ouvert";
}

export type Check = "down" | "cert" | "kuma" | "dns" | "tls" | "closed" | "dnsname" | "dnsdiff" | "dnslan" | "dnsblock"
  | "http" | "nginx" | "open" | "ssl" | "ip" | "unident" | "pause" | "obsolete";

/** Points à vérifier d'une entrée NPM. « à nettoyer » = obsolete et pause ; le reste : « à corriger ». */
export function checks(r: Host): Check[] {
  if (r.type === "local") return [];
  const p = r.public || {}, b = r.backend || {}, c: Check[] = [];
  if (!r.enabled) return r.type === "proxy" && b.up === false ? ["obsolete"] : [];
  if (r.paused) return ["pause"];
  if (r.machine_off) return [];
  if (status(r)[0] === "bad") c.push("down");
  if (p.err === "gaierror") c.push("dns");
  else if (p.err === "RemoteDisconnected") { if (!r.closes_root) c.push("closed"); }
  else if (p.err) c.push("tls");
  const di = (r.dns?.issues || []).map((x) => x[0]);
  if (di.includes("absent") && !c.includes("dns")) c.push("dns");
  for (const [k, v] of [["nom", "dnsname"], ["ecart", "dnsdiff"], ["hors_lan", "dnslan"], ["bloque", "dnsblock"]] as const)
    if (di.includes(k)) c.push(v);
  if (r.type === "dead" && p.code && p.code !== 404) c.push("http");
  if (r.nginx_online === false) c.push("nginx");
  if (exposure(r) === "ouvert") c.push("open");
  if (r.type === "proxy" && (!r.ssl || !r.ssl_forced)) c.push("ssl");
  if (certIssue(r)) c.push("cert");
  if ((r.uptime || []).some((u) => u.status === "down")) c.push("kuma");
  if (r.ip && (r.type === "proxy" || r.type === "stream") && !r.machine && !r.host_ip) c.push("ip");
  if (r.type === "proxy" && !r.service && !r.app && b.up && !b.internal) c.push("unident");  // une appli devinée (en-têtes, port) n'est plus « non identifiée »
  return c;
}

/** Pourquoi une ligne sans service n'a rien à identifier (désactivée, en pause, machine éteinte, backend muet) ; null = elle devrait l'être */
export function noIdentity(r: Host): string | null {
  if (r.type === "redirect" || r.type === "dead") return "-";
  if (!r.enabled) return tx("désactivé");
  if (r.paused) return tx("en pause");
  if (r.machine_off) return tx("machine éteinte");
  if (status(r)[0] === "bad") return tx("backend injoignable");
  return null;
}

export const CLEANUP: Check[] = ["obsolete", "pause"];

/** [libellé court, explication] de chaque point à vérifier (page actuelle : CHECK) */
export const CHECK: Record<Check, [string, string]> = {
  down: [tx("en panne"), tx("backend injoignable ou erreur 5xx alors que le host est actif")],
  cert: [tx("certificat"), tx("Web-Check : certificat invalide ou qui expire dans moins de 21 jours")],
  kuma: [tx("Uptime Kuma"), tx("une sonde Uptime Kuma de ce service est en panne")],
  dns: [tx("DNS absent"), tx("le domaine ne résout pas : enregistrement DNS manquant ou nom obsolète")],
  tls: [tx("HTTPS refusé"), tx("NPM refuse le HTTPS pour ce nom : certificat absent ou invalide")],
  closed: [tx("connexion coupée"), tx("certificat valide, mais NPM ferme la connexion sans réponse HTTP")],
  dnsname: [tx("nom DNS invalide"), tx("nom impossible à résoudre (caractère interdit, ex. « _ »)")],
  dnsdiff: [tx("DNS : écart entre AdGuard"), tx("les AdGuard ne donnent pas la même réponse")],
  dnslan: [tx("DNS hors LAN"), tx("host à garde LAN dont le nom ne résout pas vers NPM sur les AdGuard")],
  dnsblock: [tx("bloqué par AdGuard"), tx("AdGuard bloque ce nom (règle perso ou liste de filtrage)")],
  http: [tx("404 inattendu"), tx("host 404 qui ne répond pas 404")],
  nginx: [tx("config nginx"), tx("NPM signale une erreur dans la config nginx de ce host")],
  open: [tx("sans ACL"), tx("ni access list ni garde LAN ni déclaration publique : ouvert sur Internet ?")],
  ssl: ["SSL", tx("sans certificat, ou HTTPS non forcé")],
  ip: [tx("cible inconnue"), tx("IP cible hors inventaire des machines : host obsolète ?")],
  unident: [tx("non identifié"), tx("backend joignable mais aucun conteneur, process, page web ni en-tête HTTP reconnu")],
  pause: [tx("en pause"), tx("sondes suspendues (« à revoir »)")],
  obsolete: [tx("désactivé, backend mort"), tx("host désactivé dans NPM dont le backend ne répond plus : à supprimer ?")],
};

export const KIND_NAME: Record<string, string> = {
  apache: "Apache", docker: "Docker", process: "process", web: "web", manuel: tx("manuel"), npm: "NPM", inconnu: tx("non identifié"),
};

/** Exposition d'un proxy NPM actif : privé (ACL ou garde LAN), public voulu, ou ouvert sans restriction. */
export { exposure };

/** État de la synchro AdGuard (même règle que l'encadré DNS de la page actuelle). */
/** Sync state of AdGuard. `at` is the moment of the reading (the data's generation time): the last sync is compared with it, not with the clock, because the page
 *  only learns the sync log at each collection (every 15 min) while the sync itself runs every few minutes. */
export function dnsSync(g: Dns, at = Date.now()): { cls: "ok" | "warn" | "bad"; label: string } {
  const srv = Object.keys(g.servers), diff = g.rewrites_diff.length + g.user_rules_diff.length;
  const sync = Object.values(g.sync || {})[0];
  const last = sync?.last_done ? Object.values(sync.last_done).map((t) => new Date(t).getTime()) : [];
  const age = last.length ? Math.min(...last.map((t) => (at - t) / 60000)) : null;
  const every = sync?.interval_min, single = srv.length < 2 && !sync;
  const late = !!sync && (!!sync.unreadable || age == null || (!!every && age > every * 1.25 + 5));
  const errs = sync?.errors_open ?? sync?.errors_24h ?? 0;   // only the errors no later sync has closed (older servers send errors_24h alone)
  const cls = !diff && !late && !errs ? "ok" : diff && !late && !errs ? "warn" : "bad";
  const label = single ? tx("instance unique") : !sync ? (diff ? tx("{0} écart(s)", diff) : "identiques")
    : cls === "ok" ? tx("synchro à jour") : errs ? tx("synchro en erreur") : late ? tx("synchro en retard") : tx("{0} à synchroniser", diff);
  return { cls, label };
}

export function dnsDown(g: Dns): string[] {
  return Object.values(g.servers).filter((s) => !s.readable || s.silent).map((s) => s.name);
}
