// État d'accès d'une machine (ping, SSH) : badge et ordre (hors composants, voir lib/forms.ts).
import type { Tone } from "./level";
import type { Machine } from "../types";
import { tx } from "./i18n";

export type MState = "ssh" | "agent" | "api" | "network" | "box" | "manual" | "refused" | "nossh" | "off" | "down" | "disabled";
export const MSTATE: Record<MState, [Tone, string, string]> = {
  ssh: ["ok", tx("SSH OK"), tx("Connexion SSH par clé réussie depuis le collecteur")],
  agent: ["ok", tx("Agent actif"), tx("Lue par l'agent MyServices : son dernier relevé est récent (pas de SSH nécessaire)")],
  api: ["ok", tx("API"), tx("Lue par l'API d'un connecteur (Home Assistant, Proxmox…) : pas de SSH nécessaire")],
  network: ["ok", tx("Via un connecteur"), tx("Vue par un de vos outils (MynetworK, UniFi, Beszel, Proxmox…) : en ligne et identifiée, sans SSH")],
  box: ["ok", tx("Équipement réseau"), tx("Box ou passerelle : pas de SSH possible, elle est lue par son API ou par vos outils réseau ; ce n'est pas un manque")],
  manual: ["info", tx("SSH manuel"), tx("Accès déclaré sans clé (mot de passe) : non testé automatiquement")],
  refused: ["warn", tx("SSH refusé"), tx("Accès SSH configuré, mais la connexion par clé échoue")],
  nossh: ["off", tx("en ligne, sans accès"), tx("Répond au ping, ni agent ni SSH")],
  off: ["off", tx("éteinte (voulu)"), tx("Éteinte volontairement, aucune alerte")],
  down: ["bad", tx("injoignable"), tx("Ne répond ni au ping ni en SSH")],
  disabled: ["off", tx("non suivie"), tx("Désactivée dans Réglages → Machines : ni ping, ni SSH, ni santé, aucune alerte")],
};
export const ORDER: MState[] = ["ssh", "agent", "api", "network", "box", "manual", "refused", "nossh", "off", "down", "disabled"];

/** A box or a gateway (Freebox, router): it has no SSH to offer, so « without SSH » is never a warning for it */
export function isAppliance(m: Machine): boolean {
  return !!m.gateway || /\bfreebox\b/i.test(m.name) || (m.links?.sources ?? []).some((x) => /freebox/i.test(`${x.source} ${x.label}`));
}

/** The first of the user's tools that sees a machine and answers (MynetworK, UniFi, Beszel, Proxmox, Dockhand…): its label */
export function networkTool(m: Machine): string | undefined {
  return m.links?.sources.find((x) => x.ok !== false)?.label;
}

/** Badge of a machine's state: [tone, label, tooltip]; « seen by a tool » names the tool (« via MynetworK ») */
export function stateBadge(m: Machine): [Tone, string, string] {
  const st = mState(m), [tone, label, tip] = MSTATE[st];
  return st === "network" ? [tone, tx("Via {0}", networkTool(m) ?? "?"), tip] : [tone, label, tip];
}

/** Une session SSH réussie prime sur le ping (certains pare-feu bloquent l'ICMP). */
export function mState(m: Machine): MState {
  if (m.disabled) return "disabled";
  if (m.info) return "ssh";
  if (m.agent) return "agent";   // PC lu par son agent (relevé frais) : pas besoin de SSH, ce n'est pas « sans SSH »
  if (!m.ssh && m.api?.some((a) => a.ok || a.stale)) return "api";   // lue par l'API d'un connecteur (Home Assistant, Proxmox…)
  if (m.off && !m.ping) return "off";
  if (!m.ssh && m.ping !== false && networkTool(m)) return "network";   // seen by one of the user's tools (a gateway in MynetworK…): that is how it is followed
  if (m.ping !== false && isAppliance(m)) return "box";   // a box has no SSH to offer: neither a missing nor a refused SSH is a problem for it
  if (m.ssh && !m.ssh.identity) return "manual";
  if (m.ssh) return "refused";
  return m.ping ? "nossh" : "down";
}

/** Un PC Windows (l'agent est un script PowerShell) : réglage « windows » ou système probable (relevé, TTL du ping). Machine inconnue
 *  (liste pas encore chargée, machine retirée) : on se fie à `hasAgent` : seul un PC Windows envoie un relevé d'agent. */
export function isWindowsMachine(conf: { os?: string } | undefined, live?: { info?: { os?: string | null } | null; ttl?: number | null }, hasAgent = false): boolean {
  if (!conf) return hasAgent;
  return conf.os === "windows" || osOfMachine({ os: conf.os, info: live?.info, ttl: live?.ttl })?.kind === "windows";
}

export type OsKind = "linux" | "windows" | "macos" | "ios" | "network" | "pi";

/** Système d'une machine d'après ce que l'on sait d'elle : réglage « windows », relevé SSH (PRETTY_NAME), sinon le dernier scan
 *  du réseau (suggestion). null = inconnu : pas d'icône plutôt qu'une icône fausse. */
export function osOfMachine(m: { os?: string; info?: { os?: string | null } | null; name?: string; ttl?: number | null }, scan?: string | null, sshSeen = false): { kind: OsKind; label: string } | null {
  const raw = (m.info?.os || "").toLowerCase();
  if (m.os === "windows" || scan === "windows" || /windows/.test(raw)) return { kind: "windows", label: "Windows" };
  if (/raspbian|raspberry/.test(raw)) return { kind: "pi", label: "Raspberry Pi OS" };
  if (/mac ?os|darwin|os x/.test(raw) || scan === "macos") return { kind: "macos", label: "macOS" };
  if (scan === "ios") return { kind: "ios", label: "iOS" };
  if (scan === "network") return { kind: "network", label: tx("Matériel réseau") };
  if (raw) return { kind: "linux", label: m.info!.os! };
  if (scan === "linux") return { kind: "linux", label: "Linux" };
  // Ni SSH ni scan : le TTL du ping suggère Windows (65 à 128) ou un équipement réseau (au-delà) ; 64 ne sépare pas Linux de macOS
  if (m.ttl && m.ttl > 128) return { kind: "network", label: tx("Matériel réseau (probable)") };
  if (m.ttl && m.ttl > 64) return { kind: "windows", label: tx("Windows (probable)") };
  // TTL 64 + SSH ouvert (vu par le scan) : Linux probable (macOS le fait aussi, mais bien plus rarement)
  if (m.ttl && m.ttl <= 64 && sshSeen) return { kind: "linux", label: tx("Linux (probable)") };
  return null;
}

/** Familles de systèmes pour les filtres : libellé et ordre d'affichage */
export const OS_LABEL: Record<OsKind, string> = { linux: "Linux", windows: "Windows", macos: "macOS", pi: "Raspberry Pi", network: tx("Matériel réseau"), ios: "iOS / Android" };
export const OS_ORDER: OsKind[] = ["linux", "windows", "macos", "pi", "network", "ios"];
